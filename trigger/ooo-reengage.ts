import { task } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { getClientForWorkspace } from "@/lib/workspaces";
import { notifyOooReengaged } from "@/lib/notifications";
import { runWriterAgent } from "@/lib/agents/writer";
import type { WriterInput } from "@/lib/agents/types";
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
    // Look up by personEmail + workspaceSlug + status=pending
    // (reengagementId is empty string in payload — immutable after scheduling)
    // ----------------------------------------------------------------

    const record = await prisma.oooReengagement.findFirst({
      where: {
        personEmail,
        workspaceSlug,
        status: "pending",
      },
    });

    if (!record) {
      console.log("[ooo-reengage] No pending record found — already processed or cancelled", {
        personEmail,
        workspaceSlug,
      });
      return { success: false, reason: "no-pending-record" };
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
    // Step 5: Generate personalised sequence via writer agent
    // ----------------------------------------------------------------

    // Load person name for campaign naming
    const person = await prisma.person.findFirst({
      where: { email: personEmail },
      select: { firstName: true, lastName: true },
    });
    const personName = [person?.firstName, person?.lastName].filter(Boolean).join(" ") || personEmail;

    let emailSteps: Array<{ position: number; subjectLine: string; body: string; delayDays: number }> = [];

    try {
      const missedStepsRef = missedSteps.length > 0
        ? `\n\nORIGINAL MISSED STEPS FOR REFERENCE:\n${missedSteps.map((s) => `Step ${s.position}: Subject: "${s.subjectLine}" | Body: ${s.body}`).join("\n")}`
        : "";

      const totalSteps = missedSteps.length + 1;
      const writerInput: WriterInput = {
        workspaceSlug,
        task: `Generate a personalised OOO re-engagement email sequence.

CONTEXT:
- Contact "${personName}" (${personEmail}) was out of office
- OOO reason: ${oooReason}${eventName ? ` (${eventName})` : ""}
- They have now returned
- Original campaign: "${originalCampaign?.name ?? "Unknown"}"
- They received step 1 before going OOO

STEP 1 - WELCOME BACK EMAIL:
Write a warm, personalised opener that:
- Acknowledges their absence naturally (NOT "I noticed you were out of office")
- References their OOO reason subtly (holiday = "hope you had a great break", illness = "hope you're feeling better", conference = "hope ${eventName || "the conference"} was great")
- Bridges into the original campaign's value proposition
- Feels like a genuine follow-up, not automated

${missedSteps.length > 0 ? `STEPS 2-${totalSteps} - MISSED FOLLOW-UPS:
Rewrite these original campaign steps to flow naturally after the welcome back email. They should:
- NOT reference the OOO or absence again
- Maintain the original campaign's messaging and value props
- Adjust delay_days: step 2 = 2 days, step 3 = 3 days, step 4+ = 4 days
- Keep the same subject line themes but make them fresh` : "Generate only a single welcome back email (step 1)."}
${missedStepsRef}`,
        channel: "email",
        campaignName: `Re-engage: ${personName}`,
        copyStrategy: "custom",
      };

      const writerOutput = await runWriterAgent(writerInput);

      if (writerOutput.emailSteps && writerOutput.emailSteps.length > 0) {
        emailSteps = writerOutput.emailSteps.map((s) => ({
          position: s.position,
          subjectLine: s.subjectLine,
          body: s.body,
          delayDays: s.delayDays,
        }));
        console.log("[ooo-reengage] Writer generated sequence", {
          personEmail,
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
        body: `${reasonOpener} I wanted to reach back out and continue our conversation. Would love to reconnect when you have a moment.`,
        delayDays: 0,
      }];
      console.log("[ooo-reengage] Using fallback single-step");
    }

    // ----------------------------------------------------------------
    // Step 6: Create EB campaign, add steps, assign inbox, enroll lead
    // ----------------------------------------------------------------

    let ebCampaignId: number;
    let localCampaignId: string;

    try {
      // Create a fresh EB campaign for this person
      const workspace = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
        select: { name: true },
      });
      const workspaceName = workspace?.name ?? workspaceSlug;

      const ebCampaign = await ebClient.createCampaign({
        name: `Re-engage: ${personName} - ${workspaceName}`,
        type: "outbound",
        maxEmailsPerDay: 1,
        maxNewLeadsPerDay: 1,
        plainText: true,
      });

      ebCampaignId = ebCampaign.id;
      console.log("[ooo-reengage] Created EB campaign", { ebCampaignId });

      // Add sequence steps
      for (const step of emailSteps) {
        await ebClient.createSequenceStep(ebCampaignId, {
          position: step.position,
          subject: step.subjectLine,
          body: step.body,
          delay_days: step.delayDays,
        });
      }

      // Assign sending inbox — prefer original campaign's inbox, fallback to EB default
      try {
        if (originalCampaign?.emailBisonCampaignId) {
          // EB may auto-assign the workspace's default inbox
          // Explicit sender assignment can be added here if needed:
          // await ebClient.addSenderToCampaign(ebCampaignId, [senderEmailId]);
        }
      } catch (err) {
        console.warn("[ooo-reengage] Could not determine original inbox, EB will use default:", err);
      }

      // Enroll the person
      await ebClient.attachLeadsToCampaign(ebCampaignId, [ebLeadId]);
      console.log("[ooo-reengage] Lead enrolled", { personEmail, ebLeadId, ebCampaignId });

      // Create local Campaign record for audit trail
      const localCampaign = await prisma.campaign.create({
        data: {
          workspaceSlug,
          name: `Re-engage: ${personName}`,
          channels: JSON.stringify(["email"]),
          type: "ooo_reengage",
          status: "deployed",
          emailBisonCampaignId: ebCampaignId,
          emailSequence: JSON.stringify(emailSteps),
          parentCampaignId: originalCampaign?.id ?? null,
          deployedAt: new Date(),
        },
      });

      localCampaignId = localCampaign.id;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[ooo-reengage] Failed to create/configure EB campaign:", err);
      await prisma.oooReengagement.update({
        where: { id: record.id },
        data: { status: "failed", failureReason: `EB campaign creation failed: ${reason}` },
      });
      throw err; // Trigger Trigger.dev retry
    }

    // ----------------------------------------------------------------
    // Step 7: Update OooReengagement status to "sent"
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
    // Step 8: Clear Person OOO fields — person is no longer OOO
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
    // Step 9: Notify workspace Slack channel
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
      stepsGenerated: emailSteps.length,
      usedWriter: emailSteps.length > 1 || emailSteps[0]?.subjectLine !== "Following up",
    };
  },
});
