import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { tasks } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { notifyReply } from "@/lib/notifications";
import { notify } from "@/lib/notify";
import { cancelActionsForPerson, enqueueAction } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";
import { evaluateSequenceRules } from "@/lib/linkedin/sequencing";
import { rateLimit } from "@/lib/rate-limit";
import { classifyReply } from "@/lib/classification/classify-reply";
import { stripHtml } from "@/lib/classification/strip-html";
import type { processReply } from "../../../../../trigger/process-reply";
import type { linkedinFastTrack } from "../../../../../trigger/linkedin-fast-track";

export const maxDuration = 10;

const webhookLimiter = rateLimit({ windowMs: 60_000, max: 60 });

/**
 * Verify HMAC-SHA256 signature from EmailBison webhook.
 * Returns { valid: true } if signature matches.
 * Returns { valid: false, response } with a 401 response if verification fails.
 */
function verifyWebhookSignature(
  rawBody: string,
  request: NextRequest,
): { valid: true } | { valid: false; response: NextResponse } {
  const secret = process.env.EMAILBISON_WEBHOOK_SECRET;
  const signature =
    request.headers.get("x-emailbison-signature") ??
    request.headers.get("x-webhook-signature");

  if (!secret) {
    console.error(
      "[EmailBison Webhook] EMAILBISON_WEBHOOK_SECRET not configured — rejecting unsigned request",
    );
    return {
      valid: false,
      response: NextResponse.json(
        { error: "Webhook signature verification not configured" },
        { status: 401 },
      ),
    };
  }

  if (!signature) {
    console.warn(
      "[EmailBison Webhook] No signature header present — rejecting unsigned request",
    );
    return {
      valid: false,
      response: NextResponse.json(
        { error: "Missing webhook signature header" },
        { status: 401 },
      ),
    };
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return {
      valid: false,
      response: NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 },
      ),
    };
  }

  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const { success: rateLimitOk } = webhookLimiter(ip);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // Read raw body for signature verification, then parse
    const rawBody = await request.text();
    const sigCheck = verifyWebhookSignature(rawBody, request);
    if (!sigCheck.valid) {
      return sigCheck.response;
    }

    const payload = JSON.parse(rawBody);
    const eventObj = payload.event ?? {};
    const eventType = typeof eventObj === "string" ? eventObj : eventObj.type ?? "UNKNOWN";
    const data = payload.data ?? {};
    const workspaceSlug = request.nextUrl.searchParams.get("workspace") ?? eventObj.workspace_name ?? "unknown";
    const leadEmail = data.lead?.email ?? data.reply?.from_email_address ?? null;
    const senderEmail = data.sender_email?.email ?? data.reply?.primary_to_email_address ?? null;
    const subject = data.reply?.email_subject ?? null;
    const textBody = data.reply?.text_body ?? null;
    const automatedReply = data.reply?.automated_reply ?? false;
    const campaignId = data.campaign?.id?.toString() ?? null;
    const interested = data.reply?.interested ?? false;
    const leadName = [data.lead?.first_name, data.lead?.last_name].filter(Boolean).join(" ") || null;

    // Detect OOO / non-real replies early so we can persist the flag
    const fromEmail = (data.reply?.from_email_address ?? "").toLowerCase();
    const emailSubject = (subject ?? "").toLowerCase();
    const isNonRealReply =
      fromEmail.includes("mailer-daemon") ||
      fromEmail.includes("postmaster") ||
      fromEmail.includes("noreply") ||
      fromEmail.includes("no-reply") ||
      fromEmail.includes("@microsoft.com") ||
      (fromEmail.includes("@google.com") && (fromEmail.includes("noreply") || fromEmail.includes("no-reply"))) ||
      emailSubject.includes("delivery status notification") ||
      /out of office|automatic reply|auto-reply|autoreply/i.test(subject ?? "") ||
      emailSubject.includes("connection test") ||
      emailSubject.includes("test email") ||
      emailSubject.includes("weekly digest") ||
      emailSubject.includes("service update") ||
      emailSubject.includes("retention settings");
    const isAutomatedFlag = automatedReply || isNonRealReply;

    // Idempotency: skip if we already processed this exact event recently
    const replyId = data.reply?.id;
    if (replyId != null) {
      const existing = await prisma.webhookEvent.findFirst({
        where: {
          workspace: workspaceSlug,
          eventType,
          leadEmail,
          payload: { contains: `"id":${replyId}` },
        },
        select: { id: true },
      });
      if (existing) {
        console.log(`[EmailBison Webhook] Idempotent skip — duplicate reply event (replyId=${replyId}, existing=${existing.id})`);
        return NextResponse.json({ received: true, deduplicated: true });
      }
    }

    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        workspace: workspaceSlug,
        eventType,
        campaignId,
        leadEmail,
        senderEmail,
        payload: JSON.stringify(payload),
        isAutomated: isAutomatedFlag,
      },
    });

    // Handle EMAIL_SENT — update person status to "contacted"
    if (eventType === "EMAIL_SENT" && leadEmail) {
      await prisma.$transaction(async (tx) => {
        await tx.person.updateMany({
          where: { email: leadEmail, status: "new" },
          data: { status: "contacted" },
        });

        await tx.personWorkspace.updateMany({
          where: {
            workspace: workspaceSlug,
            person: { email: leadEmail },
            status: "new",
          },
          data: { status: "contacted" },
        });
      });
    }

    // Handle EMAIL_SENT — trigger LinkedIn sequence rules
    if (eventType === "EMAIL_SENT" && leadEmail && campaignId) {
      try {
        // Look up the Outsignal campaign by emailBisonCampaignId
        const outsignalCampaign = await prisma.campaign.findFirst({
          where: { emailBisonCampaignId: parseInt(campaignId) },
          select: { name: true, workspaceSlug: true, channels: true },
        });

        if (outsignalCampaign) {
          const channels = JSON.parse(outsignalCampaign.channels || '["email"]') as string[];

          // Only evaluate rules if campaign includes LinkedIn channel
          if (channels.includes("linkedin")) {
            const person = await prisma.person.findUnique({
              where: { email: leadEmail },
              select: {
                id: true, firstName: true, lastName: true,
                company: true, jobTitle: true, linkedinUrl: true, email: true,
              },
            });

            if (person?.linkedinUrl) {
              // Determine which email step this is (from EB webhook data)
              // EB sends data.sequence_step or data.step_number — extract position
              const stepNumber = data.sequence_step?.position ?? data.step_number ?? null;
              const triggerStepRef = stepNumber ? `email_${stepNumber}` : undefined;

              const actions = await evaluateSequenceRules({
                workspaceSlug: outsignalCampaign.workspaceSlug,
                campaignName: outsignalCampaign.name,
                triggerEvent: "email_sent",
                triggerStepRef,
                personId: person.id,
                person: {
                  firstName: person.firstName,
                  lastName: person.lastName,
                  company: person.company,
                  jobTitle: person.jobTitle,
                  linkedinUrl: person.linkedinUrl,
                  email: person.email,
                },
                emailContext: {
                  stepRef: triggerStepRef,
                  subject: subject ?? undefined,
                },
                senderEmail: senderEmail ?? undefined,
              });

              // Enqueue each action returned by the rules
              for (const action of actions) {
                // Dedup: skip connect if already pending or connected in this workspace
                if (action.actionType === "connect") {
                  const existingConn = await prisma.linkedInConnection.findFirst({
                    where: {
                      personId: person.id,
                      status: { in: ["pending", "connected"] },
                      sender: { workspaceSlug },
                    },
                  });
                  if (existingConn) {
                    console.log(`[webhook] Skipping connect for ${leadEmail} — already ${existingConn.status}`);
                    continue;
                  }
                }

                const sender = await assignSenderForPerson(
                  outsignalCampaign.workspaceSlug,
                  {
                    emailSenderAddress: senderEmail ?? undefined,
                    mode: "email_linkedin",
                  },
                );

                if (sender) {
                  await enqueueAction({
                    senderId: sender.id,
                    personId: person.id,
                    workspaceSlug: outsignalCampaign.workspaceSlug,
                    actionType: action.actionType as "connect" | "message" | "profile_view",
                    messageBody: action.messageBody ?? undefined,
                    priority: 5,
                    scheduledFor: new Date(Date.now() + action.delayMinutes * 60 * 1000),
                    campaignName: outsignalCampaign.name,
                    sequenceStepRef: action.sequenceStepRef,
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("LinkedIn sequence rule trigger error:", err);
        // Non-blocking — webhook still returns 200
      }
    }

    if (leadEmail) {
      const statusMap: Record<string, string> = {
        LEAD_REPLIED: "replied",
        LEAD_INTERESTED: "interested",
        UNTRACKED_REPLY_RECEIVED: "replied",
      };
      const newStatus = statusMap[eventType];
      if (newStatus) {
        await prisma.$transaction(async (tx) => {
          await tx.person.updateMany({
            where: { email: leadEmail },
            data: { status: newStatus },
          });

          // Update workspace-specific status
          await tx.personWorkspace.updateMany({
            where: {
              workspace: workspaceSlug,
              person: { email: leadEmail },
            },
            data: { status: newStatus },
          });
        });
      }
    }

    // --- Trigger process-reply task ---
    const replyEvents = ["LEAD_REPLIED", "LEAD_INTERESTED", "UNTRACKED_REPLY_RECEIVED"];
    const ebReplyId = data.reply?.id ?? null;

    if (replyEvents.includes(eventType) && !isAutomatedFlag && ebReplyId != null) {
      try {
        await tasks.trigger<typeof processReply>("process-reply", {
          workspaceSlug,
          ebReplyId,
          eventType,
          leadEmail: leadEmail ?? "unknown",
          leadName,
          senderEmail,
          subject,
          textBody,
          interested,
          campaignId,
          webhookEventId: webhookEvent.id,
          replyFromEmail: data.reply?.from_email_address ?? leadEmail ?? "unknown",
          replyFromName: data.reply?.from_name ?? leadName,
          replyBodyText: data.reply?.text_body ?? stripHtml(data.reply?.html_body ?? ""),
          replyHtmlBody: data.reply?.html_body ?? null,
          replyReceivedAt: new Date(data.reply?.date_received ?? Date.now()).toISOString(),
          replyParentId: data.reply?.parent_id ?? null,
          replySenderEmailId: data.reply?.sender_email_id ?? null,
          direction: (data.reply?.folder === "Sent" || data.reply?.type === "Outgoing Email") ? "outbound" : "inbound",
          sequenceStep: data.scheduled_email?.sequence_step_order ?? null,
        }, {
          idempotencyKey: `reply-${ebReplyId}`,
          tags: [workspaceSlug],
        });
      } catch (err) {
        console.error("[webhook] Trigger.dev unavailable, falling back to inline processing", err);
        // FALLBACK: Run critical path inline — all awaited, no fire-and-forget
        try {
          // 1. Upsert Reply (minimal — just save the record)
          const replySenderEmail = data.reply?.from_email_address ?? leadEmail ?? "unknown";
          const replyBodyText = data.reply?.text_body ?? stripHtml(data.reply?.html_body ?? "");
          const replyReceivedAt = new Date(data.reply?.date_received ?? Date.now());
          const sequenceStep: number | null = data.scheduled_email?.sequence_step_order ?? null;

          let personId: string | null = null;
          try {
            const person = await prisma.person.findUnique({
              where: { email: replySenderEmail },
              select: { id: true },
            });
            personId = person?.id ?? null;
          } catch { /* non-blocking */ }

          const reply = await prisma.reply.upsert({
            where: { emailBisonReplyId: ebReplyId },
            create: {
              workspaceSlug,
              senderEmail: replySenderEmail,
              senderName: data.reply?.from_name ?? leadName,
              subject,
              bodyText: replyBodyText,
              receivedAt: replyReceivedAt,
              emailBisonReplyId: ebReplyId,
              sequenceStep,
              source: "webhook",
              webhookEventId: webhookEvent.id,
              personId,
              emailBisonParentId: data.reply?.parent_id ?? null,
              leadEmail: (data.reply?.from_email_address ?? leadEmail ?? "").toLowerCase() || null,
              htmlBody: data.reply?.html_body ?? null,
              ebSenderEmailId: data.reply?.sender_email_id ?? null,
              interested: data.reply?.interested ?? false,
              direction: (data.reply?.folder === "Sent" || data.reply?.type === "Outgoing Email") ? "outbound" : "inbound",
            },
            update: {
              bodyText: replyBodyText,
              subject,
              senderName: data.reply?.from_name ?? leadName,
              htmlBody: data.reply?.html_body ?? undefined,
              interested: data.reply?.interested ?? undefined,
              emailBisonParentId: data.reply?.parent_id ?? undefined,
              ebSenderEmailId: data.reply?.sender_email_id ?? undefined,
            },
          });

          // 2. Classify inline, then notify only if classification succeeds
          let fallbackIntent: string | null = null;
          let fallbackSentiment: string | null = null;
          try {
            const classification = await classifyReply({
              subject,
              bodyText: reply.bodyText,
              senderName: reply.senderName,
              outboundSubject: reply.outboundSubject,
              outboundBody: reply.outboundBody,
            });
            fallbackIntent = classification.intent;
            fallbackSentiment = classification.sentiment;
            await prisma.reply.update({
              where: { id: reply.id },
              data: {
                intent: classification.intent,
                sentiment: classification.sentiment,
                objectionSubtype: classification.objectionSubtype,
                classificationSummary: classification.summary,
                classifiedAt: new Date(),
              },
            });
          } catch (classErr) {
            console.error("[webhook] Fallback classification failed — skipping notification (retry-classification cron will handle):", classErr);
          }

          // 3. Notify inline — only if classification populated intent + sentiment
          if (fallbackIntent && fallbackSentiment) {
            try {
              await notifyReply({
                workspaceSlug,
                leadName,
                leadEmail: leadEmail ?? "unknown",
                senderEmail: senderEmail ?? "unknown",
                subject,
                bodyPreview: `[${fallbackIntent}/${fallbackSentiment}] ${textBody}`,
                interested,
                suggestedResponse: null,
                replyId: reply.id,
              });
            } catch (notifyErr) {
              console.error("[webhook] Fallback notification failed:", notifyErr);
            }
          }
        } catch (fallbackErr) {
          console.error("[webhook] Fallback processing failed:", fallbackErr);
        }
      }
    } else if (replyEvents.includes(eventType) && !isAutomatedFlag && ebReplyId == null) {
      // No EB reply ID — just notify (same as today for edge cases)
      try {
        await notifyReply({
          workspaceSlug,
          leadName,
          leadEmail: leadEmail ?? "unknown",
          senderEmail: senderEmail ?? "unknown",
          subject,
          bodyPreview: textBody,
          interested,
          suggestedResponse: null,
          replyId: null,
        });
      } catch (err) {
        console.error("Notification error:", err);
      }
    }

    // --- Trigger linkedin-fast-track task ---
    const linkedInTriggerEvents = ["LEAD_REPLIED", "LEAD_INTERESTED"];
    if (linkedInTriggerEvents.includes(eventType) && leadEmail) {
      try {
        await tasks.trigger<typeof linkedinFastTrack>("linkedin-fast-track", {
          personEmail: leadEmail,
          workspaceSlug,
          senderEmail,
          campaignName: data.campaign?.name ?? null,
        }, {
          tags: [workspaceSlug],
        });
      } catch (err) {
        console.warn("[webhook] linkedin-fast-track trigger failed, skipping:", err);
      }
    }

    // Handle BOUNCE — mark person as bounced
    if (eventType === "BOUNCE" && leadEmail) {
      await prisma.person.updateMany({
        where: { email: leadEmail },
        data: { status: "bounced" },
      });

      // Cancel pending LinkedIn actions for bounced person
      const bouncedPerson = await prisma.person.findUnique({ where: { email: leadEmail }, select: { id: true } });
      if (bouncedPerson) {
        const cancelled = await cancelActionsForPerson(bouncedPerson.id, workspaceSlug);
        if (cancelled > 0) {
          console.log(`[webhook] Cancelled ${cancelled} LinkedIn actions for bounced ${leadEmail}`);
        }
      }

      try {
        await notify({
          type: "system",
          severity: "warning",
          title: `Email bounced: ${leadEmail}`,
          workspaceSlug,
          metadata: { event: "BOUNCE", leadEmail, senderEmail: data.sender_email },
        });
      } catch (err) {
        console.error("[webhook] System notification failed:", err);
      }
    }

    // Handle UNSUBSCRIBED — mark person as unsubscribed
    if (eventType === "UNSUBSCRIBED" && leadEmail) {
      await prisma.person.updateMany({
        where: { email: leadEmail },
        data: { status: "unsubscribed" },
      });

      // Cancel pending LinkedIn actions for unsubscribed person
      const unsubPerson = await prisma.person.findUnique({ where: { email: leadEmail }, select: { id: true } });
      if (unsubPerson) {
        const cancelled = await cancelActionsForPerson(unsubPerson.id, workspaceSlug);
        if (cancelled > 0) {
          console.log(`[webhook] Cancelled ${cancelled} LinkedIn actions for unsubscribed ${leadEmail}`);
        }
      }

      try {
        await notify({
          type: "system",
          severity: "info",
          title: `Lead unsubscribed: ${leadEmail}`,
          workspaceSlug,
          metadata: { event: "UNSUBSCRIBED", leadEmail },
        });
      } catch (err) {
        console.error("[webhook] System notification failed:", err);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
