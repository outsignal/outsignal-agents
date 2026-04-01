import { task, tasks, runs } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { classifyReply } from "@/lib/classification/classify-reply";
import { notifyReply } from "@/lib/notifications";
import { extractOooDetails } from "@/lib/ooo/extract-ooo";
import { lookupOutboundCopy } from "@/lib/outbound-copy-lookup";
import { anthropicQueue } from "./queues";

export interface ProcessReplyPayload {
  workspaceSlug: string;
  ebReplyId: number;
  eventType: string;
  leadEmail: string;
  leadName: string | null;
  senderEmail: string | null;
  subject: string | null;
  textBody: string | null;
  interested: boolean;
  campaignId: string | null;
  webhookEventId: string;
  replyFromEmail: string;
  replyFromName: string | null;
  replyBodyText: string;
  replyHtmlBody: string | null;
  replyReceivedAt: string; // ISO string (dates don't serialize over JSON)
  replyParentId: number | null;
  replySenderEmailId: number | null;
  direction: "inbound" | "outbound";
  sequenceStep: number | null;
}

export const processReply = task({
  id: "process-reply",
  queue: anthropicQueue,
  maxDuration: 60, // 1 min — classification + notify only (AI suggestion runs in separate task)
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
  },

  run: async (payload: ProcessReplyPayload) => {
    const {
      workspaceSlug,
      ebReplyId,
      eventType,
      leadEmail,
      leadName,
      senderEmail,
      subject,
      textBody,
      interested,
      campaignId,
      webhookEventId,
      replyFromEmail,
      replyFromName,
      replyBodyText,
      replyHtmlBody,
      replyReceivedAt,
      replyParentId,
      replySenderEmailId,
      direction,
      sequenceStep,
    } = payload;

    // ----------------------------------------------------------------
    // Step 1: Upsert Reply record (dedup by emailBisonReplyId)
    // ----------------------------------------------------------------

    // Look up outbound email snapshot from Outsignal campaign
    let outboundSubject: string | null = null;
    let outboundBody: string | null = null;
    let outsignalCampaignId: string | null = null;
    let outsignalCampaignName: string | null = null;

    if (campaignId) {
      try {
        const campaign = await prisma.campaign.findFirst({
          where: { emailBisonCampaignId: parseInt(campaignId) },
          select: { id: true, name: true, emailSequence: true },
        });
        if (campaign) {
          outsignalCampaignId = campaign.id;
          outsignalCampaignName = campaign.name;
          if (campaign.emailSequence && sequenceStep != null) {
            try {
              const steps = JSON.parse(campaign.emailSequence) as {
                position: number;
                subjectLine?: string;
                body?: string;
              }[];
              const matchedStep = steps.find((s) => s.position === sequenceStep);
              if (matchedStep) {
                outboundSubject = matchedStep.subjectLine ?? null;
                outboundBody = matchedStep.body ?? null;
              }
            } catch {
              // JSON parse failure — skip outbound snapshot
            }
          }

          // EB API fallback when local emailSequence is missing or didn't match
          if (outboundSubject == null && campaign.id) {
            try {
              const result = await lookupOutboundCopy(campaign.id, sequenceStep);
              if (result.subject || result.body) {
                outboundSubject = result.subject;
                outboundBody = result.body;
                console.log(
                  `[process-reply] Outbound copy resolved via EB API for campaign ${campaignId}`,
                );
              }
            } catch {
              // EB API fallback failure — non-blocking
            }
          }
        }
      } catch {
        // Campaign lookup failure — non-blocking
      }
    }

    // Look up personId by replyFromEmail
    let personId: string | null = null;
    try {
      const person = await prisma.person.findUnique({
        where: { email: replyFromEmail },
        select: { id: true },
      });
      personId = person?.id ?? null;
    } catch {
      // Person lookup failure — non-blocking
    }

    // Upsert Reply record
    const reply = await prisma.reply.upsert({
      where: { emailBisonReplyId: ebReplyId },
      create: {
        workspaceSlug,
        senderEmail: replyFromEmail,
        senderName: replyFromName,
        subject,
        bodyText: replyBodyText,
        receivedAt: new Date(replyReceivedAt),
        emailBisonReplyId: ebReplyId,
        campaignId: outsignalCampaignId,
        campaignName: outsignalCampaignName,
        sequenceStep,
        outboundSubject,
        outboundBody,
        source: "webhook",
        webhookEventId,
        personId,
        emailBisonParentId: replyParentId,
        leadEmail: replyFromEmail.toLowerCase() || null,
        htmlBody: replyHtmlBody,
        ebSenderEmailId: replySenderEmailId,
        interested,
        direction,
      },
      update: {
        bodyText: replyBodyText,
        subject,
        senderName: replyFromName,
        htmlBody: replyHtmlBody ?? undefined,
        interested,
        emailBisonParentId: replyParentId ?? undefined,
        ebSenderEmailId: replySenderEmailId ?? undefined,
      },
    });

    const replyId = reply.id;

    // ----------------------------------------------------------------
    // Step 2: Classify reply
    // ----------------------------------------------------------------

    let classificationIntent: string | null = null;
    let classificationSentiment: string | null = null;

    try {
      const classification = await classifyReply({
        subject,
        bodyText: reply.bodyText,
        senderName: reply.senderName,
        outboundSubject: reply.outboundSubject,
        outboundBody: reply.outboundBody,
      });

      await prisma.reply.update({
        where: { id: replyId },
        data: {
          intent: classification.intent,
          sentiment: classification.sentiment,
          objectionSubtype: classification.objectionSubtype,
          classificationSummary: classification.summary,
          classifiedAt: new Date(),
        },
      });

      classificationIntent = classification.intent;
      classificationSentiment = classification.sentiment;

      console.log(
        `[process-reply] Classified ${replyFromEmail}: intent=${classification.intent} sentiment=${classification.sentiment}`,
      );
    } catch (err) {
      console.error("[process-reply] Classification failed, retry cron will pick it up:", err);
      // Non-blocking — reply saved with intent=null, retry-classification cron picks it up
    }

    // ----------------------------------------------------------------
    // Step 2b: OOO extraction + delayed task scheduling
    // Non-blocking — classification already saved, OOO is additive
    // ----------------------------------------------------------------

    let oooScheduled = false;

    if (classificationIntent === "out_of_office") {
      try {
        const extraction = await extractOooDetails({
          bodyText: replyBodyText,
          receivedAt: new Date(replyReceivedAt),
        });

        // Cap return date at 90 days from detection
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 90);
        const returnDate =
          extraction.oooUntil > maxDate ? maxDate : extraction.oooUntil;

        // Send the day after the return date (give lead time to settle in)
        const sendDate = new Date(returnDate);
        sendDate.setDate(sendDate.getDate() + 1);

        const oooDetectedAt = new Date();

        // Check for existing pending OooReengagement record for dedup
        const existing = await prisma.oooReengagement.findFirst({
          where: {
            personEmail: replyFromEmail,
            workspaceSlug,
            status: "pending",
          },
        });

        if (existing && existing.triggerRunId) {
          // Reschedule existing delayed task + update record
          await runs.reschedule(existing.triggerRunId, { delay: sendDate });
          await prisma.oooReengagement.update({
            where: { id: existing.id },
            data: {
              oooUntil: returnDate,
              oooReason: extraction.oooReason,
              oooDetectedAt,
              eventName: extraction.eventName,
              needsManualReview: extraction.confidence === "defaulted",
              updatedAt: new Date(),
            },
          });
          console.log(
            `[process-reply] Rescheduled existing OOO reengagement ${existing.id} for ${sendDate.toISOString()}`,
          );
        } else {
          // Schedule new delayed task
          const handle = await tasks.trigger(
            "ooo-reengage",
            {
              personEmail: replyFromEmail,
              workspaceSlug,
              oooReason: extraction.oooReason,
              eventName: extraction.eventName,
              originalCampaignId: outsignalCampaignId,
              ebLeadId: null, // Plan 02 ooo-reengage task will look this up via EB API
              reengagementId: "", // Will be updated after record creation below
            },
            {
              delay: sendDate,
              tags: [workspaceSlug, replyFromEmail],
            },
          );

          const reengagement = await prisma.oooReengagement.create({
            data: {
              personEmail: replyFromEmail,
              workspaceSlug,
              oooUntil: returnDate,
              oooReason: extraction.oooReason,
              oooDetectedAt,
              eventName: extraction.eventName,
              triggerRunId: handle.id,
              needsManualReview: extraction.confidence === "defaulted",
              originalCampaignId: outsignalCampaignId,
              ebLeadId: null,
              status: "pending",
            },
          });

          // Trigger a separate task with the now-known reengagementId is not possible
          // after the fact — reengagementId is passed as part of payload for Plan 02 to use.
          // The ooo-reengage task will look up the OooReengagement record by personEmail+workspaceSlug+status=pending.
          console.log(
            `[process-reply] Scheduled OOO reengagement ${reengagement.id} for ${sendDate.toISOString()} (triggerRunId=${handle.id})`,
          );
        }

        // Update Person OOO fields
        await prisma.person.updateMany({
          where: { email: replyFromEmail },
          data: {
            oooUntil: returnDate,
            oooReason: extraction.oooReason,
            oooDetectedAt,
          },
        });

        oooScheduled = true;
      } catch (err) {
        console.error("[process-reply] OOO extraction/scheduling failed:", err);
        // Non-blocking — continue to notification
      }
    }

    // ----------------------------------------------------------------
    // Step 3: Notify (notifyReply has notifiedAt guard — safe for retries)
    // ----------------------------------------------------------------

    // Append classification info to body preview if available
    let bodyPreview = textBody;
    if (bodyPreview && classificationIntent && classificationSentiment) {
      bodyPreview = `${bodyPreview} [Intent: ${classificationIntent}, Sentiment: ${classificationSentiment}]`;
    }

    try {
      await notifyReply({
        workspaceSlug,
        leadName,
        leadEmail: leadEmail ?? "unknown",
        senderEmail: senderEmail ?? "unknown",
        subject,
        bodyPreview,
        interested,
        suggestedResponse: null,
        replyId,
      });
    } catch (err) {
      console.error("[process-reply] Notification error:", err);
      // Non-blocking — continue to AI suggestion
    }

    // ----------------------------------------------------------------
    // Step 4: Trigger AI reply suggestion (async — runs as separate task)
    // ----------------------------------------------------------------

    const skipSuggestionIntents = ["out_of_office", "auto_reply", "unsubscribe", "not_relevant"];
    const replyTriggerEvents = ["LEAD_REPLIED", "LEAD_INTERESTED"];
    if (
      replyTriggerEvents.includes(eventType) &&
      textBody &&
      !(classificationIntent && skipSuggestionIntents.includes(classificationIntent))
    ) {
      try {
        await tasks.trigger("generate-suggestion", {
          replyId,
          workspaceSlug,
        });
        console.log(`[process-reply] Triggered generate-suggestion for reply ${replyId}`);
      } catch (err) {
        console.error("[process-reply] Failed to trigger generate-suggestion:", err);
        // Non-blocking — notification already fired, suggestion will be missing but reply is processed
      }
    } else if (classificationIntent && skipSuggestionIntents.includes(classificationIntent)) {
      console.log(
        `[process-reply] Skipped generate-suggestion for reply ${replyId} — non-actionable intent: ${classificationIntent}`,
      );
    }

    return {
      replyId,
      classified: classificationIntent !== null,
      intent: classificationIntent,
      sentiment: classificationSentiment,
      oooScheduled,
    };
  },
});
