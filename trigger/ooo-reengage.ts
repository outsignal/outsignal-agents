import { task } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { getClientForWorkspace } from "@/lib/workspaces";
import { notifyOooReengaged } from "@/lib/notifications";
import { runWriterAgent } from "@/lib/agents/writer";
import type { WriterInput } from "@/lib/agents/types";
import { buildSequenceStepsForEB } from "@/lib/channels/email-adapter";
import { emailBisonQueue } from "./queues";

// PrismaClient at module scope — not inside run() (pattern from smoke-test.ts)
const prisma = new PrismaClient();

export interface OooReengagePayload {
  personEmail: string;
  workspaceSlug: string;
  oooReason: "holiday" | "illness" | "conference" | "generic";
  eventName: string | null;
  originalCampaignId: string | null;
  ebLeadId: number | null;
  reengagementId: string;
}

// Reason-based openers — locked decision from CONTEXT.md
const OOO_OPENERS: Record<string, string> = {
  holiday: "Hope you had a great break!",
  illness: "Hope you're feeling better!",
  conference: "Hope the conference was good!",
  generic: "Hope all is well!",
};

export const oooReengage = task({
  id: "ooo-reengage",
  queue: emailBisonQueue,
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async (payload: OooReengagePayload) => {
    const { personEmail, workspaceSlug, oooReason, eventName, originalCampaignId } = payload;

    console.log("[ooo-reengage] task triggered", {
      personEmail,
      workspaceSlug,
      oooReason,
      reengagementId: payload.reengagementId,
    });

    // ----------------------------------------------------------------
    // Step 1: Load OooReengagement record
    // ----------------------------------------------------------------

    const record = await prisma.oooReengagement.findFirst({
      where: {
        id: payload.reengagementId,
        personEmail,
        workspaceSlug,
        status: { in: ["pending", "failed"] },
      },
    });

    if (!record) {
      console.log("[ooo-reengage] No retryable record found — already processed or cancelled", {
        personEmail,
        workspaceSlug,
        reengagementId: payload.reengagementId,
      });
      return { success: false, reason: "no-retryable-record" };
    }

    // ----------------------------------------------------------------
    // Step 2: Get EmailBison client for this workspace
    // ----------------------------------------------------------------

    let ebClient;
    try {
      ebClient = await getClientForWorkspace(workspaceSlug);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await prisma.oooReengagement.update({
        where: { id: record.id },
        data: { status: "failed", failureReason: `Workspace config error: ${reason}` },
      });
      return { success: false, reason: "workspace-not-found" };
    }

    // ----------------------------------------------------------------
    // Step 3: Resolve EB lead ID
    // ----------------------------------------------------------------

    let ebLeadId: number | null = record.ebLeadId ?? payload.ebLeadId ?? null;

    if (!ebLeadId) {
      console.log("[ooo-reengage] ebLeadId not in record, searching EB by email", { personEmail });
      const lead = await ebClient.findLeadByEmail(workspaceSlug, personEmail);
      if (lead) {
        ebLeadId = lead.id;
      }
    }

    if (!ebLeadId) {
      const reason = "Lead not found in EmailBison";
      console.error("[ooo-reengage] Lead not found in EB", { personEmail, workspaceSlug });
      await prisma.oooReengagement.update({
        where: { id: record.id },
        data: { status: "failed", failureReason: reason },
      });
      return { success: false, reason: "lead-not-found" };
    }

    // ----------------------------------------------------------------
    // Step 4: Load original campaign + determine missed steps
    // ----------------------------------------------------------------

    const reasonOpener = eventName && oooReason === "conference"
      ? `Hope ${eventName} was good!`
      : (OOO_OPENERS[oooReason] ?? OOO_OPENERS.generic);

    const campaignId = originalCampaignId ?? record.originalCampaignId;
    let originalCampaign: {
      id: string;
      emailSequence: string | null;
      name: string;
      emailBisonCampaignId: number | null;
      workspaceSlug: string;
    } | null = null;
    let missedSteps: Array<{ position: number; subjectLine: string; body: string; delayDays: number }> = [];

    if (campaignId) {
      originalCampaign = await prisma.campaign.findFirst({
        where: { id: campaignId },
        select: { id: true, emailSequence: true, name: true, emailBisonCampaignId: true, workspaceSlug: true },
      });

      if (originalCampaign?.emailSequence) {
        try {
          const allSteps = JSON.parse(originalCampaign.emailSequence) as Array<{
            position?: number; subjectLine?: string; body?: string; delayDays?: number;
          }>;
          const sorted = [...allSteps].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          // Person received step 1 (triggered the OOO reply). Missed steps = position > 1
          missedSteps = sorted
            .filter((s) => (s.position ?? 0) > 1 && s.body)
            .map((s) => ({
              position: s.position ?? 0,
              subjectLine: s.subjectLine ?? "",
              body: s.body ?? "",
              delayDays: s.delayDays ?? 3,
            }));
        } catch {
          console.warn("[ooo-reengage] Failed to parse emailSequence JSON");
        }
      }
    }

    // ----------------------------------------------------------------
    // Step 5: Find or create re-engagement campaign (one per original campaign)
    // ----------------------------------------------------------------

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { name: true },
    });
    const workspaceName = workspace?.name ?? workspaceSlug;

    let ebCampaignId: number;
    let localCampaignId: string;

    // Check if a re-engagement campaign already exists for this original campaign
    const existingReengageCampaign = await prisma.campaign.findFirst({
      where: {
        parentCampaignId: originalCampaign?.id ?? undefined,
        type: "ooo_reengage",
        workspaceSlug,
        ...(originalCampaign?.id ? {} : { parentCampaignId: null }),
      },
    });

    // If no original campaign, look for a generic workspace-level re-engagement campaign
    const reengageCampaign = originalCampaign?.id
      ? existingReengageCampaign
      : await prisma.campaign.findFirst({
          where: {
            workspaceSlug,
            type: "ooo_reengage",
            parentCampaignId: null,
          },
        });

    if (reengageCampaign?.emailBisonCampaignId) {
      // Reuse existing re-engagement campaign
      ebCampaignId = reengageCampaign.emailBisonCampaignId;
      localCampaignId = reengageCampaign.id;
      console.log("[ooo-reengage] Reusing existing re-engagement campaign", {
        localCampaignId,
        ebCampaignId,
        personEmail,
      });
    } else {
      // Create a new re-engagement campaign
      try {
        const emailSteps = await generateReengageSequence({
          workspaceSlug,
          personEmail,
          oooReason,
          eventName,
          originalCampaignName: originalCampaign?.name ?? null,
          missedSteps,
          reasonOpener,
        });

        const campaignName = originalCampaign?.name
          ? `Re-engage: ${originalCampaign.name}`
          : `Re-engage: ${workspaceName} OOO Returns`;

        const ebCampaign = await ebClient.createCampaign({
          name: campaignName,
          type: "outbound",
          maxEmailsPerDay: 15,
          maxNewLeadsPerDay: 10,
          plainText: true,
        });

        ebCampaignId = ebCampaign.id;
        console.log("[ooo-reengage] Created EB campaign", { ebCampaignId, campaignName });

        // Add sequence steps via the shared adapter helper so this path uses
        // the same absolute-day -> EB gap semantics as normal campaign deploys.
        // Without this, OOO re-engagement would still leak raw absolute delays
        // straight into createSequenceSteps and diverge from the main adapter.
        await ebClient.createSequenceSteps(
          ebCampaignId,
          campaignName,
          buildSequenceStepsForEB(emailSteps, `OOO re-engage ${campaignName}`),
        );

        // Assign sending inbox — prefer original campaign's inboxes
        try {
          if (originalCampaign?.emailBisonCampaignId) {
            // EB may auto-assign the workspace's default inbox
            // Explicit inbox assignment can be added here if needed:
            // await ebClient.addSenderToCampaign(ebCampaignId, [inboxEmailId]);
          }
        } catch (err) {
          console.warn("[ooo-reengage] Could not determine original inbox, EB will use default:", err);
        }

        // Create local Campaign record
        const localCampaign = await prisma.campaign.create({
          data: {
            workspaceSlug,
            name: campaignName,
            channels: JSON.stringify(["email"]),
            type: "ooo_reengage",
            status: "deployed",
            emailBisonCampaignId: ebCampaignId,
            emailSequence: JSON.stringify(emailSteps),
            parentCampaignId: originalCampaign?.id ?? null,
            copyStrategy: "custom",
            deployedAt: new Date(),
          },
        });

        localCampaignId = localCampaign.id;
        console.log("[ooo-reengage] Created local campaign record", { localCampaignId });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error("[ooo-reengage] Failed to create/configure EB campaign:", err);
        await prisma.oooReengagement.update({
          where: { id: record.id },
          data: { status: "failed", failureReason: `EB campaign creation failed: ${reason}` },
        });
        throw err; // Trigger Trigger.dev retry
      }
    }

    // ----------------------------------------------------------------
    // Step 6: Set ooo_greeting custom variable on the lead via createLead (upsert)
    // ----------------------------------------------------------------

    try {
      // Ensure OOO_GREETING custom variable exists in EB
      await ebClient.ensureCustomVariables(["OOO_GREETING"]);

      // Load person details for the upsert
      const person = await prisma.person.findFirst({
        where: { email: personEmail },
        select: { firstName: true, lastName: true, jobTitle: true, companyDomain: true },
      });

      // Upsert lead with custom variable — createLead upserts by email in EB
      const upsertedLead = await ebClient.createLead({
        email: personEmail,
        firstName: person?.firstName ?? undefined,
        lastName: person?.lastName ?? undefined,
        jobTitle: person?.jobTitle ?? undefined,
        customVariables: [{ name: "OOO_GREETING", value: reasonOpener }],
      });

      // Use the upserted lead ID (may differ if lead was recreated)
      ebLeadId = upsertedLead.id;
      console.log("[ooo-reengage] Set ooo_greeting custom variable", {
        personEmail,
        ebLeadId,
        greeting: reasonOpener,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[ooo-reengage] Failed to set ooo_greeting custom variable:", err);
      await prisma.oooReengagement.update({
        where: { id: record.id },
        data: {
          status: "failed",
          failureReason: `OOO greeting upsert failed: ${reason}`,
        },
      });
      throw new Error(`OOO greeting upsert failed: ${reason}`);
    }

    // ----------------------------------------------------------------
    // Step 7: Enroll lead into the re-engagement campaign
    // ----------------------------------------------------------------

    try {
      await ebClient.attachLeadsToCampaign(ebCampaignId, [ebLeadId]);
      console.log("[ooo-reengage] Lead enrolled", { personEmail, ebLeadId, ebCampaignId });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[ooo-reengage] Failed to enroll lead:", err);
      await prisma.oooReengagement.update({
        where: { id: record.id },
        data: { status: "failed", failureReason: `Lead enrollment failed: ${reason}` },
      });
      throw err; // Trigger Trigger.dev retry
    }

    // ----------------------------------------------------------------
    // Step 8: Update OooReengagement status to "sent"
    // ----------------------------------------------------------------

    await prisma.oooReengagement.update({
      where: { id: record.id },
      data: {
        status: "sent",
        sentAt: new Date(),
        welcomeBackCampaignId: ebCampaignId,
      },
    });

    // ----------------------------------------------------------------
    // Step 9: Clear Person OOO fields — person is no longer OOO
    // ----------------------------------------------------------------

    await prisma.person.updateMany({
      where: { email: personEmail },
      data: {
        oooUntil: null,
        oooReason: null,
        oooDetectedAt: null,
      },
    });

    // ----------------------------------------------------------------
    // Step 10: Notify workspace Slack channel
    // ----------------------------------------------------------------

    await notifyOooReengaged({
      workspaceSlug,
      count: 1,
      leadEmails: [personEmail],
    });

    console.log("[ooo-reengage] Re-engagement complete", { personEmail, workspaceSlug, ebCampaignId });

    return {
      success: true,
      personEmail,
      workspaceSlug,
      ebLeadId,
      ebCampaignId,
      localCampaignId,
      reusedExistingCampaign: !!reengageCampaign?.emailBisonCampaignId,
    };
  },
});

// ----------------------------------------------------------------
// Helper: Generate re-engagement email sequence via writer agent
// ----------------------------------------------------------------

async function generateReengageSequence(opts: {
  workspaceSlug: string;
  personEmail: string;
  oooReason: string;
  eventName: string | null;
  originalCampaignName: string | null;
  missedSteps: Array<{ position: number; subjectLine: string; body: string; delayDays: number }>;
  reasonOpener: string;
}): Promise<Array<{ position: number; subjectLine: string; body: string; delayDays: number }>> {
  const { workspaceSlug, personEmail, oooReason, eventName, originalCampaignName, missedSteps, reasonOpener } = opts;

  let emailSteps: Array<{ position: number; subjectLine: string; body: string; delayDays: number }> = [];

  try {
    const missedStepsRef = missedSteps.length > 0
      ? `\n\nORIGINAL MISSED STEPS FOR REFERENCE:\n${missedSteps.map((s) => `Step ${s.position}: Subject: "${s.subjectLine}" | Body: ${s.body}`).join("\n")}`
      : "";

    const totalSteps = missedSteps.length + 1;
    const writerInput: WriterInput = {
      workspaceSlug,
      task: `Generate an OOO re-engagement email sequence.

CONTEXT:
- This is a shared re-engagement campaign — multiple people will be enrolled
- Each person has a custom variable {OOO_GREETING} set to a personalised greeting
- Use {FIRSTNAME} for the person's name
- Original campaign: "${originalCampaignName ?? "Unknown"}"
- People in this campaign received step 1 before going OOO

STEP 1 - WELCOME BACK EMAIL:
Write a warm welcome-back email that:
- Start the body with {OOO_GREETING} followed by a space, then the rest of the message
- Use {FIRSTNAME} to address the person
- Bridges into the original campaign's value proposition
- Feels like a genuine follow-up, not automated
- Does NOT hardcode any specific OOO reason (the {OOO_GREETING} variable handles personalisation)

${missedSteps.length > 0 ? `STEPS 2-${totalSteps} - MISSED FOLLOW-UPS:
Rewrite these original campaign steps to flow naturally after the welcome back email. They should:
- NOT reference the OOO or absence again
- Use {FIRSTNAME} for personalisation
- Maintain the original campaign's messaging and value props
- Adjust delay_days: step 2 = 2 days, step 3 = 3 days, step 4+ = 4 days
- Keep the same subject line themes but make them fresh` : "Generate only a single welcome back email (step 1)."}
${missedStepsRef}`,
      channel: "email",
      campaignName: `Re-engage: ${originalCampaignName ?? "OOO Returns"}`,
      copyStrategy: "custom",
    };

    const writerOutput = await runWriterAgent(writerInput, { modelOverride: "claude-sonnet-4-6" });

    if (writerOutput.emailSteps && writerOutput.emailSteps.length > 0) {
      emailSteps = writerOutput.emailSteps.map((s) => ({
        position: s.position,
        subjectLine: s.subjectLine,
        body: s.body,
        delayDays: s.delayDays,
      }));
      console.log("[ooo-reengage] Writer generated sequence", {
        stepCount: emailSteps.length,
      });
    }
  } catch (err) {
    console.warn("[ooo-reengage] Writer agent failed, falling back to single-step:", err);
  }

  // Fallback: generate a simple welcome-back email if writer failed
  if (emailSteps.length === 0) {
    emailSteps = [{
      position: 1,
      subjectLine: "Following up",
      body: `{OOO_GREETING} {FIRSTNAME}, I wanted to reach back out and continue our conversation. Would love to reconnect when you have a moment.`,
      delayDays: 0,
    }];
    console.log("[ooo-reengage] Using fallback single-step");
  }

  return emailSteps;
}
