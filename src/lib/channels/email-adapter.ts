/**
 * Email channel adapter — wraps EmailBisonClient behind the ChannelAdapter
 * interface.
 *
 * Stateless pattern: resolves workspace apiToken fresh inside each method.
 * Zero new business logic — only wraps existing client methods.
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { getCampaign } from "@/lib/campaigns/operations";
import { withRetry } from "@/lib/utils/retry";
import { CHANNEL_TYPES } from "./constants";
import type {
  ChannelAdapter,
  CampaignChannelRef,
  DeployParams,
  DeployResult,
  UnifiedMetrics,
  UnifiedLead,
  UnifiedAction,
  UnifiedStep,
} from "./types";

// ---------------------------------------------------------------------------
// Local types for email deploy
// ---------------------------------------------------------------------------

interface EmailSequenceStep {
  position: number;
  subjectLine?: string;
  subjectVariantB?: string;
  body?: string;
  bodyText?: string;
  delayDays?: number;
  notes?: string;
}

export class EmailAdapter implements ChannelAdapter {
  readonly channel = CHANNEL_TYPES.EMAIL;

  // ---------------------------------------------------------------------------
  // Private helper — resolve a fresh client per call (no caching)
  // ---------------------------------------------------------------------------

  private async getClient(workspaceSlug: string): Promise<EmailBisonClient> {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: workspaceSlug },
      select: { apiToken: true },
    });
    if (!ws.apiToken)
      throw new Error(`Workspace '${workspaceSlug}' has no API token`);
    return new EmailBisonClient(ws.apiToken);
  }

  // ---------------------------------------------------------------------------
  // deploy — full email channel deploy (moved from deploy.ts in Phase 73)
  // ---------------------------------------------------------------------------

  async deploy(params: DeployParams): Promise<void> {
    const { deployId, campaignId, campaignName, workspaceSlug } = params;

    // Mark email channel as running
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: { emailStatus: "running" },
    });

    const ebClient = await this.getClient(workspaceSlug);

    try {
      // 1. Create EmailBison campaign
      const ebCampaign = await withRetry(() =>
        ebClient.createCampaign({ name: campaignName }),
      );
      const ebCampaignId = ebCampaign.id;

      // 2. Store emailBisonCampaignId on both CampaignDeploy and Campaign records
      await Promise.all([
        prisma.campaignDeploy.update({
          where: { id: deployId },
          data: { emailBisonCampaignId: ebCampaignId },
        }),
        prisma.campaign.update({
          where: { id: campaignId },
          data: { emailBisonCampaignId: ebCampaignId },
        }),
      ]);

      // 3. Load campaign to get sequence and targetListId
      const campaign = await getCampaign(campaignId);
      if (!campaign?.targetListId) {
        throw new Error("Campaign has no target list");
      }

      const emailSequence = (campaign.emailSequence ?? []) as EmailSequenceStep[];

      // 4. Create sequence steps
      let emailStepCount = 0;
      for (const step of emailSequence) {
        await withRetry(() =>
          ebClient.createSequenceStep(ebCampaignId, {
            position: step.position,
            subject: step.subjectLine,
            body: step.body ?? step.bodyText ?? "",
            delay_days: step.delayDays ?? 1,
          }),
        );
        emailStepCount++;
      }

      // 5. Load leads from TargetList — dedup via WebhookEvent check
      const leads = await prisma.targetListPerson.findMany({
        where: { listId: campaign.targetListId },
        include: {
          person: {
            include: {
              workspaces: { where: { workspace: workspaceSlug } },
            },
          },
        },
      });

      // 6. Push leads (serial with 100ms delay between, dedup check)
      let leadCount = 0;
      for (const entry of leads) {
        const person = entry.person;

        // Outsignal-side dedup: skip if already has EMAIL_SENT event for this workspace
        const alreadyDeployed = await prisma.webhookEvent.findFirst({
          where: {
            workspace: workspaceSlug,
            eventType: "EMAIL_SENT",
            leadEmail: person.email,
          },
          select: { id: true },
        });

        if (alreadyDeployed) {
          continue;
        }

        // Skip leads without a real email — cannot deploy to EmailBison
        if (!person.email) continue;

        await withRetry(() =>
          ebClient.createLead({
            email: person.email!,
            firstName: person.firstName ?? undefined,
            lastName: person.lastName ?? undefined,
            jobTitle: person.jobTitle ?? undefined,
            company: person.company ?? undefined,
          }),
        );

        leadCount++;

        // Throttle — 100ms between leads
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 7. Update deploy record with completion
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: {
          emailStatus: "complete",
          emailStepCount,
          leadCount,
          emailError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: {
          emailStatus: "failed",
          emailError: message,
        },
      });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // pause — pause the EmailBison campaign
  // ---------------------------------------------------------------------------

  async pause(ref: CampaignChannelRef): Promise<void> {
    if (!ref.emailBisonCampaignId) {
      console.warn(
        `Cannot pause email campaign — no emailBisonCampaignId on ref for '${ref.campaignName}'`,
      );
      return;
    }
    const client = await this.getClient(ref.workspaceSlug);
    await client.pauseCampaign(ref.emailBisonCampaignId);
  }

  // ---------------------------------------------------------------------------
  // resume — resume the EmailBison campaign
  // ---------------------------------------------------------------------------

  async resume(ref: CampaignChannelRef): Promise<void> {
    if (!ref.emailBisonCampaignId) {
      console.warn(
        `Cannot resume email campaign — no emailBisonCampaignId on ref for '${ref.campaignName}'`,
      );
      return;
    }
    const client = await this.getClient(ref.workspaceSlug);
    await client.resumeCampaign(ref.emailBisonCampaignId);
  }

  // ---------------------------------------------------------------------------
  // getMetrics — map EB campaign stats to UnifiedMetrics
  // ---------------------------------------------------------------------------

  async getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics> {
    if (!ref.emailBisonCampaignId) {
      return {
        channel: CHANNEL_TYPES.EMAIL,
        sent: 0,
        replied: 0,
        replyRate: 0,
        opened: 0,
        openRate: 0,
        bounced: 0,
        bounceRate: 0,
      };
    }

    const client = await this.getClient(ref.workspaceSlug);
    const campaign = await client.getCampaignById(ref.emailBisonCampaignId);

    if (!campaign) {
      return {
        channel: CHANNEL_TYPES.EMAIL,
        sent: 0,
        replied: 0,
        replyRate: 0,
        opened: 0,
        openRate: 0,
        bounced: 0,
        bounceRate: 0,
      };
    }

    const sent = campaign.emails_sent ?? 0;
    const replied = campaign.replied ?? 0;
    const opened = campaign.opened ?? 0;
    const bounced = campaign.bounced ?? 0;

    return {
      channel: CHANNEL_TYPES.EMAIL,
      sent,
      replied,
      replyRate: sent > 0 ? Math.round((replied / sent) * 100) / 100 : 0,
      opened,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) / 100 : 0,
      bounced,
      bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) / 100 : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // getLeads — map EB campaign leads to UnifiedLead[]
  // ---------------------------------------------------------------------------

  async getLeads(ref: CampaignChannelRef): Promise<UnifiedLead[]> {
    if (!ref.emailBisonCampaignId) return [];

    const client = await this.getClient(ref.workspaceSlug);
    const response = await client.getCampaignLeads(ref.emailBisonCampaignId);
    const leads = response.data ?? [];

    return leads.map((lead) => ({
      id: String(lead.id),
      email: lead.email,
      name:
        [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
        undefined,
      company: lead.company ?? undefined,
      title: lead.title ?? undefined,
      channel: CHANNEL_TYPES.EMAIL,
      status: lead.status ?? "unknown",
    }));
  }

  // ---------------------------------------------------------------------------
  // getActions — query local Reply table for the campaign
  // ---------------------------------------------------------------------------

  async getActions(ref: CampaignChannelRef): Promise<UnifiedAction[]> {
    const replies = await prisma.reply.findMany({
      where: {
        workspaceSlug: ref.workspaceSlug,
        campaignName: ref.campaignName,
      },
      orderBy: { receivedAt: "desc" },
    });

    return replies.map((reply) => ({
      id: reply.id,
      channel: CHANNEL_TYPES.EMAIL,
      actionType: "reply",
      status: "complete",
      personEmail: reply.senderEmail,
      personName: reply.senderName ?? undefined,
      detail: reply.subject ?? undefined,
      performedAt: reply.receivedAt,
      campaignName: reply.campaignName ?? undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // getSequenceSteps — EB sequence steps with Campaign.emailSequence fallback
  // ---------------------------------------------------------------------------

  async getSequenceSteps(ref: CampaignChannelRef): Promise<UnifiedStep[]> {
    // Primary: EmailBison API
    if (ref.emailBisonCampaignId) {
      try {
        const client = await this.getClient(ref.workspaceSlug);
        const steps = await client.getSequenceSteps(ref.emailBisonCampaignId);

        return steps.map((step) => ({
          stepNumber: step.position,
          channel: CHANNEL_TYPES.EMAIL,
          type: "email",
          delayDays: step.delay_days ?? 0,
          subjectLine: step.subject || undefined,
          bodyHtml: step.body || undefined,
        }));
      } catch {
        // Fall through to Campaign.emailSequence fallback
      }
    }

    // Fallback: Campaign.emailSequence JSON field
    const campaign = await prisma.campaign.findFirst({
      where: {
        name: ref.campaignName,
        workspaceSlug: ref.workspaceSlug,
      },
      select: { emailSequence: true },
    });

    if (!campaign?.emailSequence) return [];

    try {
      const steps = JSON.parse(campaign.emailSequence) as Array<{
        position?: number;
        subjectLine?: string;
        subjectVariantB?: string;
        body?: string;
        bodyText?: string;
        bodyHtml?: string;
        delayDays?: number;
        notes?: string;
      }>;

      return steps.map((step, index) => ({
        stepNumber: step.position ?? index + 1,
        channel: CHANNEL_TYPES.EMAIL,
        type: "email",
        delayDays: step.delayDays ?? 0,
        subjectLine: step.subjectLine ?? undefined,
        bodyHtml: step.bodyHtml ?? step.body ?? step.bodyText ?? undefined,
        messageBody: step.bodyText ?? step.body ?? undefined,
      }));
    } catch {
      return [];
    }
  }
}
