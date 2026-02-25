import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyReply } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const event = payload.event as string;
    const data = payload.data ?? {};

    await prisma.webhookEvent.create({
      data: {
        workspace: data.workspace_slug ?? "unknown",
        eventType: event,
        campaignId: data.campaign_id?.toString() ?? null,
        leadEmail: data.lead_email ?? data.email ?? null,
        senderEmail: data.sender_email ?? null,
        payload: JSON.stringify(payload),
      },
    });

    // Update lead status based on event type
    const leadEmail = data.lead_email ?? data.email;
    if (leadEmail) {
      const statusMap: Record<string, string> = {
        EMAIL_SENT: "contacted",
        REPLY_RECEIVED: "replied",
        BOUNCE: "bounced",
        INTERESTED: "interested",
        UNSUBSCRIBED: "unsubscribed",
      };
      const newStatus = statusMap[event];
      if (newStatus) {
        await prisma.lead.updateMany({
          where: { email: leadEmail },
          data: { status: newStatus },
        });
      }
    }

    // Send notifications for real replies (non-automated)
    if (event === "REPLY_RECEIVED" && data.automated_reply !== true) {
      try {
        await notifyReply({
          workspaceSlug: data.workspace_slug ?? "unknown",
          leadEmail: leadEmail ?? "unknown",
          senderEmail: data.sender_email ?? "unknown",
          subject: data.subject ?? null,
          bodyPreview: data.text_body ?? null,
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
