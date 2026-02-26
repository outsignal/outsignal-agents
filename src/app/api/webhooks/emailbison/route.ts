import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyReply } from "@/lib/notifications";
import { enqueueAction, bumpPriority } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";

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
      try {
        await notifyReply({
          workspaceSlug,
          leadName,
          leadEmail: leadEmail ?? "unknown",
          senderEmail: senderEmail ?? "unknown",
          subject,
          bodyPreview: textBody,
          interested,
        });
      } catch (err) {
        console.error("Notification error:", err);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
