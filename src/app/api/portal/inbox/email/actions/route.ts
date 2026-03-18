import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";

// POST /api/portal/inbox/email/actions — proxy actions to EmailBison
export async function POST(request: NextRequest) {
  let parsedWorkspaceSlug: string | undefined;
  let parsedReplyId: number | undefined;

  try {
    const { workspaceSlug } = await getPortalSession();
    parsedWorkspaceSlug = workspaceSlug;

    const body = await request.json();
    const { action, replyId, leadId, value, leadEmail } = body as {
      action: string;
      replyId?: number;
      leadId?: number;
      value?: string;
      leadEmail?: string;
    };
    parsedReplyId = replyId;

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

      case "mark_automated":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for mark_automated" },
            { status: 400 },
          );
        }
        await ebClient.markReplyAutomated(replyId);
        break;

      case "mark_not_automated":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for mark_not_automated" },
            { status: 400 },
          );
        }
        await ebClient.markReplyNotAutomated(replyId);
        break;

      case "mark_interested":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for mark_interested" },
            { status: 400 },
          );
        }
        await ebClient.markReplyInterested(replyId);
        await prisma.reply.updateMany({
          where: { emailBisonReplyId: replyId, workspaceSlug },
          data: { interested: true },
        });
        break;

      case "mark_not_interested":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required for mark_not_interested" },
            { status: 400 },
          );
        }
        await ebClient.markReplyNotInterested(replyId);
        await prisma.reply.updateMany({
          where: { emailBisonReplyId: replyId, workspaceSlug },
          data: { interested: false },
        });
        break;

      case "blacklist_email":
      case "blacklist_domain": {
        const resolvedEmail = leadEmail || value;
        if (!resolvedEmail) {
          return NextResponse.json(
            { error: "leadEmail or value is required for blacklist" },
            { status: 400 },
          );
        }
        const blacklistLead = await ebClient.findLeadByEmail(workspaceSlug, resolvedEmail);
        if (!blacklistLead?.id) {
          return NextResponse.json(
            { error: "Lead not found in email provider" },
            { status: 404 },
          );
        }
        await ebClient.addToBlacklist(
          blacklistLead.id,
          action === "blacklist_domain" ? "domain" : "email",
        );
        break;
      }

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

      case "unsubscribe": {
        const unsubEmail = leadEmail || value;
        if (!unsubEmail) {
          return NextResponse.json(
            { error: "leadEmail or value is required for unsubscribe" },
            { status: 400 },
          );
        }
        const unsubLead = await ebClient.findLeadByEmail(workspaceSlug, unsubEmail);
        if (!unsubLead?.id) {
          return NextResponse.json(
            { error: "Lead not found in email provider" },
            { status: 404 },
          );
        }
        await ebClient.unsubscribeLead(unsubLead.id);
        break;
      }

      case "remove_lead": {
        // Accept either leadId directly or value/leadEmail to look up
        let resolvedLeadId = leadId;
        if (!resolvedLeadId && (leadEmail || value)) {
          const lead = await ebClient.findLeadByEmail(workspaceSlug, leadEmail || value!);
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

      if (err.isRecordNotFound && parsedReplyId && parsedWorkspaceSlug) {
        await prisma.reply.updateMany({
          where: { emailBisonReplyId: parsedReplyId, workspaceSlug: parsedWorkspaceSlug },
          data: { deletedAt: new Date() },
        }).catch(() => {});
        return NextResponse.json(
          { error: "This reply no longer exists in the email provider. It may have been deleted." },
          { status: 404 },
        );
      }

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
