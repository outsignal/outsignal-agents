import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";

// POST /api/portal/inbox/email/actions — proxy actions to EmailBison
export async function POST(request: NextRequest) {
  try {
    const { workspaceSlug } = await getPortalSession();

    const body = await request.json();
    const { action, replyId, leadId, value } = body as {
      action: string;
      replyId?: number;
      leadId?: number;
      value?: string;
    };

    if (!action) {
      return NextResponse.json(
        { error: "action is required" },
        { status: 400 },
      );
    }

    // Get the workspace's EmailBison token
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { apiToken: true },
    });

    if (!workspace?.apiToken) {
      return NextResponse.json(
        { error: "Workspace has no EmailBison token configured" },
        { status: 422 },
      );
    }

    const ebClient = new EmailBisonClient(workspace.apiToken);

    switch (action) {
      case "mark_unread":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for mark_unread" },
            { status: 400 },
          );
        }
        await ebClient.markReplyUnread(replyId);
        break;

      case "blacklist_domain":
        if (!value) {
          return NextResponse.json(
            { error: "value (domain) is required for blacklist_domain" },
            { status: 400 },
          );
        }
        await ebClient.addToBlacklist("domain", value);
        break;

      case "blacklist_email":
        if (!value) {
          return NextResponse.json(
            { error: "value (email) is required for blacklist_email" },
            { status: 400 },
          );
        }
        await ebClient.addToBlacklist("email", value);
        break;

      case "delete_reply": {
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for delete_reply" },
            { status: 400 },
          );
        }
        // Delete from EB (via dedi — white-label doesn't proxy DELETE)
        await ebClient.deleteReply(replyId);
        // Soft-delete locally so it disappears from portal inbox
        await prisma.reply.updateMany({
          where: { emailBisonReplyId: replyId, workspaceSlug },
          data: { deletedAt: new Date() },
        });
        break;
      }

      case "mark_automated":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for mark_automated" },
            { status: 400 },
          );
        }
        await ebClient.markReplyAutomated(replyId);
        break;

      case "mark_interested":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for mark_interested" },
            { status: 400 },
          );
        }
        await ebClient.markReplyInterested(replyId);
        break;

      case "remove_lead": {
        // Accept either leadId directly or value (lead email) to look up
        let resolvedLeadId = leadId;
        if (!resolvedLeadId && value) {
          const lead = await ebClient.findLeadByEmail(workspaceSlug, value);
          resolvedLeadId = lead?.id;
        }
        if (!resolvedLeadId) {
          return NextResponse.json(
            { error: "Could not find lead to remove" },
            { status: 400 },
          );
        }
        await ebClient.deleteLead(resolvedLeadId);
        break;
      }

      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 },
        );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof EmailBisonError) {
      return NextResponse.json(
        { error: "Action failed via email provider" },
        { status: err.statusCode },
      );
    }

    if (err instanceof EmailBisonApiError) {
      console.error(`[POST /api/portal/inbox/email/actions] EB API ${err.status}: ${err.body}`);
      return NextResponse.json(
        { error: `Email provider error (${err.status})` },
        { status: err.status >= 400 && err.status < 500 ? err.status : 502 },
      );
    }

    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[POST /api/portal/inbox/email/actions] Error:", err);
    return NextResponse.json(
      { error: "Action failed" },
      { status: 500 },
    );
  }
}
