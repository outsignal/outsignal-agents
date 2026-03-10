import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Reply } from "@/lib/emailbison/types";
import { prisma } from "@/lib/db";
import { notifyReply } from "@/lib/notifications";
import { bumpPriority, enqueueAction } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspace = url.searchParams.get("workspace");

  if (!workspace) {
    return NextResponse.json(
      { error: "Missing required query param: workspace" },
      { status: 400 },
    );
  }

  const config = await getWorkspaceBySlug(workspace);
  if (!config) {
    return NextResponse.json(
      { error: `Workspace not found: ${workspace}` },
      { status: 404 },
    );
  }

  const client = new EmailBisonClient(config.apiToken);

  let replies: Reply[];
  try {
    replies = await client.getRecentReplies(5);
  } catch (err) {
    console.error(`[backfill-replies] Failed to fetch replies for ${workspace}:`, err);
    return NextResponse.json(
      { error: `Failed to fetch replies for ${workspace}` },
      { status: 502 },
    );
  }

  const result = { workspace, processed: 0, skipped: 0, errors: 0, total: replies.length };

  for (const reply of replies) {
    try {
      // Filter out automated / non-real replies
      const fromEmail = reply.from_email_address.toLowerCase();
      const subj = (reply.subject ?? "").toLowerCase();
      const isNonReal =
        reply.automated_reply ||
        fromEmail.includes("mailer-daemon") ||
        fromEmail.includes("postmaster") ||
        subj.includes("delivery status notification") ||
        /out of office|automatic reply|auto-reply|autoreply/i.test(reply.subject ?? "") ||
        subj.includes("connection test") ||
        subj.includes("test email");

      if (isNonReal) {
        result.skipped++;
        continue;
      }

      // Dedup: check if we already processed this reply via webhook or a previous poll
      const replyDate = new Date(reply.date_received);
      const windowStart = new Date(replyDate.getTime() - 5 * 60 * 1000);
      const windowEnd = new Date(replyDate.getTime() + 5 * 60 * 1000);

      const existing = await prisma.webhookEvent.findFirst({
        where: {
          workspace,
          leadEmail: { equals: reply.from_email_address, mode: "insensitive" },
          eventType: {
            in: ["LEAD_REPLIED", "LEAD_INTERESTED", "UNTRACKED_REPLY_RECEIVED", "POLLED_REPLY"],
          },
          receivedAt: { gte: windowStart, lte: windowEnd },
        },
      });

      if (existing) {
        result.skipped++;
        continue;
      }

      // -- Process new reply --

      // 1. Record webhook event
      await prisma.webhookEvent.create({
        data: {
          workspace,
          eventType: "POLLED_REPLY",
          campaignId: reply.campaign_id?.toString() ?? null,
          leadEmail: reply.from_email_address,
          senderEmail: reply.primary_to_email_address,
          payload: JSON.stringify({ source: "backfill", reply }),
          isAutomated: false,
        },
      });

      // 2. Update person + workspace status
      const newStatus = reply.interested ? "interested" : "replied";
      await prisma.$transaction(async (tx) => {
        await tx.person.updateMany({
          where: { email: reply.from_email_address },
          data: { status: newStatus },
        });
        await tx.personWorkspace.updateMany({
          where: {
            workspace,
            person: { email: reply.from_email_address },
          },
          data: { status: newStatus },
        });
      });

      // 3. Look up Reply record for dedup guard
      let replyRecordId: string | null = null;
      if (reply.id != null) {
        const replyRecord = await prisma.reply.findUnique({
          where: { emailBisonReplyId: reply.id },
          select: { id: true },
        });
        replyRecordId = replyRecord?.id ?? null;
      }

      // 4. Send notification
      await notifyReply({
        workspaceSlug: workspace,
        leadName: reply.from_name,
        leadEmail: reply.from_email_address,
        senderEmail: reply.primary_to_email_address,
        subject: reply.subject,
        bodyPreview: reply.text_body,
        interested: reply.interested,
        suggestedResponse: null,
        replyId: replyRecordId,
      });

      // 5. LinkedIn fast-track for replied/interested
      try {
        const person = await prisma.person.findUnique({
          where: { email: reply.from_email_address },
        });

        if (person?.linkedinUrl) {
          const bumped = await bumpPriority(person.id, workspace);

          if (!bumped) {
            const existingConn = await prisma.linkedInConnection.findFirst({
              where: { personId: person.id, sender: { workspaceSlug: workspace } },
            });

            if (!existingConn || existingConn.status === "none") {
              const sender = await assignSenderForPerson(workspace, {
                emailSenderAddress: reply.primary_to_email_address,
                mode: "email_linkedin",
              });

              if (sender) {
                await enqueueAction({
                  senderId: sender.id,
                  personId: person.id,
                  workspaceSlug: workspace,
                  actionType: "connect",
                  priority: 1,
                  scheduledFor: new Date(),
                  campaignName: undefined,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error("[backfill-replies] LinkedIn fast-track error:", err);
      }

      result.processed++;
    } catch (err) {
      console.error("[backfill-replies] Error processing reply:", err);
      result.errors++;
    }
  }

  console.log(
    `[backfill-replies] Done for ${workspace}: ${result.processed} processed, ${result.skipped} skipped, ${result.errors} errors out of ${result.total} total replies`,
  );

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    result,
  });
}
