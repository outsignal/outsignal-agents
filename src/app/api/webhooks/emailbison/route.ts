import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyReply } from "@/lib/notifications";

/**
 * EmailBison webhook handler.
 *
 * Configure the webhook URL in EmailBison with a workspace query param:
 *   https://your-app.vercel.app/api/webhooks/emailbison?workspace=rise
 *
 * EmailBison event types handled:
 *   LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    // EmailBison sends event as an object: { type, name, workspace_id, workspace_name }
    const eventObj = payload.event ?? {};
    const eventType =
      typeof eventObj === "string" ? eventObj : eventObj.type ?? "UNKNOWN";
    const data = payload.data ?? {};

    // Workspace slug from query param (preferred) or fall back to event workspace_name
    const workspaceSlug =
      request.nextUrl.searchParams.get("workspace") ??
      eventObj.workspace_name ??
      "unknown";

    // Extract fields from EmailBison's nested structure
    const leadEmail =
      data.lead?.email ??
      data.reply?.from_email_address ??
      null;
    const senderEmail =
      data.sender_email?.email ??
      data.reply?.primary_to_email_address ??
      null;
    const subject = data.reply?.email_subject ?? null;
    const textBody = data.reply?.text_body ?? null;
    const automatedReply = data.reply?.automated_reply ?? false;
    const campaignId = data.campaign?.id?.toString() ?? null;
    const interested = data.reply?.interested ?? false;
    const leadName = [data.lead?.first_name, data.lead?.last_name]
      .filter(Boolean)
      .join(" ") || null;

    // Store the raw webhook event
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

    // Update lead status based on event type
    if (leadEmail) {
      const statusMap: Record<string, string> = {
        LEAD_REPLIED: "replied",
        LEAD_INTERESTED: "interested",
        UNTRACKED_REPLY_RECEIVED: "replied",
      };
      const newStatus = statusMap[eventType];
      if (newStatus) {
        await prisma.lead.updateMany({
          where: { email: leadEmail },
          data: { status: newStatus },
        });
      }
    }

    // Send notifications for replies (not automated)
    const notifyEvents = [
      "LEAD_REPLIED",
      "LEAD_INTERESTED",
      "UNTRACKED_REPLY_RECEIVED",
    ];
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
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
