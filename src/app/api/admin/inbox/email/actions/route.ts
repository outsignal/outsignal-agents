import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";
import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";
import { auditLog } from "@/lib/audit";
import { isDestructiveEmailInboxAction } from "@/lib/email-inbox-actions";

// POST /api/admin/inbox/email/actions — proxy actions to EmailBison on behalf of a workspace
export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsedWorkspaceSlug: string | undefined;
  let parsedReplyId: number | undefined;

  try {
    const body = await request.json();
    const { action, replyId, leadId, value, workspaceSlug, leadEmail } = body as {
      action: string;
      replyId?: number;
      leadId?: number;
      value?: string;
      workspaceSlug?: string;
      leadEmail?: string;
      confirmed?: boolean;
    };
    const confirmed = (body as { confirmed?: boolean }).confirmed;
    parsedWorkspaceSlug = workspaceSlug;
    parsedReplyId = replyId;

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug is required" }, { status: 400 });
    }

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

    if (isDestructiveEmailInboxAction(action) && confirmed !== true) {
      return NextResponse.json(
        { error: "Confirmation required for destructive inbox actions" },
        { status: 400 },
      );
    }

    const ebClient = new EmailBisonClient(workspace.apiToken);
    let destructiveAudit:
      | {
          entityType: string;
          entityId: string;
          metadata: Record<string, unknown>;
        }
      | undefined;

    switch (action) {
      case "mark_unread":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required" },
            { status: 400 },
          );
        }
        await ebClient.markReplyUnread(replyId);
        break;

      case "mark_automated":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required" },
            { status: 400 },
          );
        }
        await ebClient.markReplyAutomated(replyId);
        break;

      case "mark_not_automated":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required" },
            { status: 400 },
          );
        }
        await ebClient.markReplyNotAutomated(replyId);
        break;

      case "mark_interested":
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required" },
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
            { error: "replyId is required" },
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
            { error: "leadEmail or value is required" },
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
        destructiveAudit = {
          entityType: "Lead",
          entityId: resolvedEmail.toLowerCase(),
          metadata: {
            workspaceSlug,
            leadId: blacklistLead.id,
            leadEmail: leadEmail ?? null,
            value: resolvedEmail,
            blacklistType: action === "blacklist_domain" ? "domain" : "email",
          },
        };
        break;
      }

      case "delete_reply": {
        if (!replyId) {
          return NextResponse.json(
            { error: "replyId is required" },
            { status: 400 },
          );
        }
        await ebClient.deleteReply(replyId);
        await prisma.reply.updateMany({
          where: { emailBisonReplyId: replyId, workspaceSlug },
          data: { deletedAt: new Date() },
        });
        destructiveAudit = {
          entityType: "Reply",
          entityId: String(replyId),
          metadata: {
            workspaceSlug,
            replyId,
          },
        };
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
        destructiveAudit = {
          entityType: "Lead",
          entityId: String(resolvedLeadId),
          metadata: {
            workspaceSlug,
            leadId: resolvedLeadId,
            leadEmail: leadEmail ?? null,
            value: value ?? null,
          },
        };
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    if (destructiveAudit) {
      auditLog({
        action: `admin.inbox.email.${action}`,
        entityType: destructiveAudit.entityType,
        entityId: destructiveAudit.entityId,
        adminEmail: session.email,
        metadata: destructiveAudit.metadata,
      });
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
      console.error(`[POST /api/admin/inbox/email/actions] EB API ${err.status}: ${err.body}`);

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

    console.error("[POST /api/admin/inbox/email/actions] Error:", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
