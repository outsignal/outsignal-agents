import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

interface ReplyPayload {
  from_name?: string;
  from_email?: string;
  subject?: string;
  text_body?: string;
  body_preview?: string;
  lead_name?: string;
  lead_email?: string;
}

// GET /api/portal/replies — returns recent replies for the authenticated portal user's workspace
export async function GET() {
  try {
    const { workspaceSlug } = await getPortalSession();

    const events = await prisma.webhookEvent.findMany({
      where: {
        workspace: workspaceSlug,
        eventType: { in: ["LEAD_REPLIED", "LEAD_INTERESTED", "POLLED_REPLY"] },
        isAutomated: false,
      },
      orderBy: { receivedAt: "desc" },
      take: 50,
    });

    const replies = events.map((event) => {
      let parsed: ReplyPayload = {};
      try {
        parsed = JSON.parse(event.payload) as ReplyPayload;
      } catch {
        // payload may not be valid JSON
      }

      const fromName = parsed.from_name || parsed.lead_name || null;
      const fromEmail = parsed.from_email || parsed.lead_email || event.leadEmail || null;
      const subject = parsed.subject || null;

      // Get body preview — strip HTML tags and truncate
      let bodyPreview: string | null = null;
      const rawBody = parsed.text_body || parsed.body_preview || null;
      if (rawBody) {
        bodyPreview = rawBody
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
      }

      return {
        id: event.id,
        fromName,
        fromEmail,
        subject,
        bodyPreview,
        receivedAt: event.receivedAt.toISOString(),
        isInterested: event.eventType === "LEAD_INTERESTED",
      };
    });

    return NextResponse.json({ replies, total: replies.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/portal/replies] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch replies" },
      { status: 500 },
    );
  }
}
