import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyReply } from "@/lib/notifications";
import { notify } from "@/lib/notify";
import { enqueueAction, bumpPriority } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";
import { evaluateSequenceRules } from "@/lib/linkedin/sequencing";

async function generateReplySuggestion(params: {
  workspaceSlug: string;
  leadName: string | null;
  leadEmail: string;
  subject: string | null;
  replyBody: string | null;
  interested: boolean;
}): Promise<string | null> {
  try {
    const { runWriterAgent } = await import("@/lib/agents/writer");
    const result = await runWriterAgent({
      workspaceSlug: params.workspaceSlug,
      task: `Suggest a reply to this incoming email from ${params.leadName ?? params.leadEmail}.

Subject: ${params.subject ?? "(no subject)"}
Their message: ${params.replyBody ?? "(no body)"}
${params.interested ? "Note: This lead is marked as INTERESTED." : ""}

Write a brief, conversational response (under 70 words). This is a reply to an existing conversation, NOT a cold outreach. Do not use spintax or PVP framework. Sound human and natural. Reference what they said and move the conversation forward.`,
      channel: "email",
    });

    // Extract the reply text from the writer output
    if (result.emailSteps && result.emailSteps.length > 0) {
      return result.emailSteps[0].body;
    }
    return result.reviewNotes || null;
  } catch (error) {
    console.error("Reply suggestion generation failed:", error);
    return null; // Non-blocking — notification still fires without suggestion
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
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

    await prisma.webhookEvent.create({
      data: {
        workspace: workspaceSlug,
        eventType,
        campaignId,
        leadEmail,
        senderEmail,
        payload: JSON.stringify(payload),
      },
    });

    // Handle EMAIL_SENT — update person status to "contacted"
    if (eventType === "EMAIL_SENT" && leadEmail) {
      await prisma.person.updateMany({
        where: { email: leadEmail, status: "new" },
        data: { status: "contacted" },
      });

      await prisma.personWorkspace.updateMany({
        where: {
          workspace: workspaceSlug,
          person: { email: leadEmail },
          status: "new",
        },
        data: { status: "contacted" },
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
        await prisma.person.updateMany({
          where: { email: leadEmail },
          data: { status: newStatus },
        });

        // Update workspace-specific status
        await prisma.personWorkspace.updateMany({
          where: {
            workspace: workspaceSlug,
            person: { email: leadEmail },
          },
          data: { status: newStatus },
        });
      }
    }

    // LinkedIn fast-track: on reply/interested, queue P1 connection request
    const linkedInTriggerEvents = ["LEAD_REPLIED", "LEAD_INTERESTED"];
    if (linkedInTriggerEvents.includes(eventType) && leadEmail) {
      try {
        const person = await prisma.person.findUnique({ where: { email: leadEmail } });
        if (person?.linkedinUrl) {
          // Try to bump existing pending connection to P1
          const bumped = await bumpPriority(person.id, workspaceSlug);

          if (!bumped) {
            // No existing action — check if already connected, if not enqueue new P1
            const existingConnection = await prisma.linkedInConnection.findFirst({
              where: { personId: person.id, sender: { workspaceSlug } },
            });

            if (!existingConnection || existingConnection.status === "none") {
              const sender = await assignSenderForPerson(workspaceSlug, {
                emailSenderAddress: senderEmail ?? undefined,
                mode: senderEmail ? "email_linkedin" : "linkedin_only",
              });

              if (sender) {
                await enqueueAction({
                  senderId: sender.id,
                  personId: person.id,
                  workspaceSlug,
                  actionType: "connect",
                  priority: 1,
                  scheduledFor: new Date(), // ASAP
                  campaignName: data.campaign?.name ?? null,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error("LinkedIn fast-track error:", err);
      }
    }

    const notifyEvents = ["LEAD_REPLIED", "LEAD_INTERESTED", "UNTRACKED_REPLY_RECEIVED"];
    if (notifyEvents.includes(eventType) && !automatedReply) {
      let suggestedResponse: string | null = null;

      // Generate reply suggestion for reply/interested events (non-blocking)
      const replyTriggerEvents = ["LEAD_REPLIED", "LEAD_INTERESTED"];
      if (replyTriggerEvents.includes(eventType) && textBody) {
        suggestedResponse = await generateReplySuggestion({
          workspaceSlug,
          leadName,
          leadEmail: leadEmail ?? "unknown",
          subject,
          replyBody: textBody,
          interested,
        });
      }

      try {
        await notifyReply({
          workspaceSlug,
          leadName,
          leadEmail: leadEmail ?? "unknown",
          senderEmail: senderEmail ?? "unknown",
          subject,
          bodyPreview: textBody,
          interested,
          suggestedResponse,
        });
      } catch (err) {
        console.error("Notification error:", err);
      }

      if (eventType === "LEAD_INTERESTED") {
        notify({
          type: "system",
          severity: "info",
          title: `Interested reply: ${leadName || leadEmail || "unknown"}`,
          workspaceSlug,
          metadata: { campaignId, eventType },
        }).catch(() => {});
      }
    }

    // Handle BOUNCE — mark person as bounced
    if (eventType === "BOUNCE" && leadEmail) {
      await prisma.person.updateMany({
        where: { email: leadEmail },
        data: { status: "bounced" },
      });

      notify({
        type: "system",
        severity: "warning",
        title: `Email bounced: ${leadEmail}`,
        workspaceSlug,
        metadata: { event: "BOUNCE", leadEmail, senderEmail: data.sender_email },
      }).catch(() => {});
    }

    // Handle UNSUBSCRIBED — mark person as unsubscribed
    if (eventType === "UNSUBSCRIBED" && leadEmail) {
      await prisma.person.updateMany({
        where: { email: leadEmail },
        data: { status: "unsubscribed" },
      });

      notify({
        type: "system",
        severity: "info",
        title: `Lead unsubscribed: ${leadEmail}`,
        workspaceSlug,
        metadata: { event: "UNSUBSCRIBED", leadEmail },
      }).catch(() => {});
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
