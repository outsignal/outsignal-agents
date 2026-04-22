/**
 * Replay missed EmailBison replies from the webhook-signature outage window.
 *
 * Default mode is dry-run. Use `--apply` to create synthetic WebhookEvent rows
 * and trigger the normal `process-reply` task for any missing replies.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_backfill-emailbison-webhook-outage-replies-2026-04-20.ts
 *   npx tsx scripts/maintenance/_backfill-emailbison-webhook-outage-replies-2026-04-20.ts --apply
 *   npx tsx scripts/maintenance/_backfill-emailbison-webhook-outage-replies-2026-04-20.ts --apply --workspace rise
 *   npx tsx scripts/maintenance/_backfill-emailbison-webhook-outage-replies-2026-04-20.ts --apply --end 2026-04-22T18:30:00Z
 */

import "dotenv/config";
import { tasks } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "../../src/lib/emailbison/client";
import {
  createSequenceStepCache,
  resolveScheduledEmail,
} from "../../src/lib/emailbison/resolve-step";
import type { Reply as EmailBisonReply } from "../../src/lib/emailbison/types";
import { getAllWorkspaces, getWorkspaceBySlug } from "../../src/lib/workspaces";
import { stripHtml } from "../../src/lib/classification/strip-html";
import type { processReply } from "../../trigger/process-reply";

const prisma = new PrismaClient();
const OUTAGE_START = new Date("2026-04-20T10:18:00Z");
const APPLY = process.argv.includes("--apply");

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function inferReplyEventType(reply: EmailBisonReply): string {
  return reply.interested ? "LEAD_INTERESTED" : "LEAD_REPLIED";
}

function isAutomatedReply(reply: Pick<EmailBisonReply, "automated_reply" | "from_email_address" | "subject">): boolean {
  const fromEmail = reply.from_email_address.toLowerCase();
  const subject = (reply.subject ?? "").toLowerCase();

  return (
    reply.automated_reply ||
    fromEmail.includes("mailer-daemon") ||
    fromEmail.includes("postmaster") ||
    fromEmail.includes("noreply") ||
    fromEmail.includes("no-reply") ||
    fromEmail.includes("@microsoft.com") ||
    (fromEmail.includes("@google.com") &&
      (fromEmail.includes("noreply") || fromEmail.includes("no-reply"))) ||
    subject.includes("delivery status notification") ||
    /out of office|automatic reply|auto-reply|autoreply/i.test(reply.subject ?? "") ||
    subject.includes("connection test") ||
    subject.includes("test email") ||
    subject.includes("weekly digest") ||
    subject.includes("service update") ||
    subject.includes("retention settings")
  );
}

async function getWindowReplies(
  client: EmailBisonClient,
  windowStart: Date,
  windowEnd: Date,
): Promise<EmailBisonReply[]> {
  const replies: EmailBisonReply[] = [];
  let page = 1;

  while (true) {
    const response = await client.getRepliesPage(page);
    const pageReplies = response.data;

    if (pageReplies.length === 0) {
      break;
    }

    for (const reply of pageReplies) {
      const receivedAt = new Date(reply.date_received);
      if (receivedAt >= windowStart && receivedAt <= windowEnd) {
        replies.push(reply);
      }
    }

    const newestOnPage = new Date(pageReplies[0].date_received);
    const oldestOnPage = new Date(pageReplies[pageReplies.length - 1].date_received);
    const pageIsEntirelyBeforeWindow = newestOnPage < windowStart && oldestOnPage < windowStart;

    if (page >= response.meta.last_page || pageIsEntirelyBeforeWindow) {
      break;
    }

    page++;
  }

  return replies;
}

async function ensureSyntheticWebhookEvent(args: {
  workspaceSlug: string;
  eventType: string;
  externalEventId: string;
  campaignId: string | null;
  leadEmail: string;
  senderEmail: string | null;
  payload: Record<string, unknown>;
}): Promise<string> {
  const existing = await prisma.webhookEvent.findFirst({
    where: {
      workspace: args.workspaceSlug,
      eventType: args.eventType,
      externalEventId: args.externalEventId,
    },
    select: { id: true },
  });

  if (existing) {
    return existing.id;
  }

  const created = await prisma.webhookEvent.create({
    data: {
      workspace: args.workspaceSlug,
      eventType: args.eventType,
      externalEventId: args.externalEventId,
      campaignId: args.campaignId,
      leadEmail: args.leadEmail,
      senderEmail: args.senderEmail,
      payload: JSON.stringify(args.payload),
      isAutomated: false,
    },
    select: { id: true },
  });

  return created.id;
}

async function main() {
  const workspaceFilter = readArg("--workspace");
  const endArg = readArg("--end");
  const windowEnd = endArg ? new Date(endArg) : new Date();

  if (Number.isNaN(windowEnd.getTime())) {
    throw new Error(`Invalid --end value: ${endArg}`);
  }

  console.log(
    `[eb-webhook-outage-backfill] mode=${APPLY ? "apply" : "dry-run"} start=${OUTAGE_START.toISOString()} end=${windowEnd.toISOString()}${workspaceFilter ? ` workspace=${workspaceFilter}` : ""}`,
  );

  const workspaces = (await getAllWorkspaces())
    .filter((ws) => ws.hasApiToken)
    .filter((ws) => (workspaceFilter ? ws.slug === workspaceFilter : true));

  if (workspaces.length === 0) {
    console.log("[eb-webhook-outage-backfill] No matching workspaces with EmailBison API tokens.");
    return;
  }

  const summary: Array<{
    workspace: string;
    fetched: number;
    missing: number;
    triggered: number;
    skippedExisting: number;
    automatedSkipped: number;
    errors: number;
  }> = [];

  for (const workspace of workspaces) {
    const config = await getWorkspaceBySlug(workspace.slug);
    if (!config) {
      continue;
    }

    const client = new EmailBisonClient(config.apiToken);
    const stepCache = createSequenceStepCache();
    const row = {
      workspace: workspace.slug,
      fetched: 0,
      missing: 0,
      triggered: 0,
      skippedExisting: 0,
      automatedSkipped: 0,
      errors: 0,
    };
    summary.push(row);

    console.log(`\n[${workspace.slug}] Fetching replies in outage window...`);

    let replies: EmailBisonReply[] = [];
    try {
      replies = await getWindowReplies(client, OUTAGE_START, windowEnd);
      row.fetched = replies.length;
      console.log(`[${workspace.slug}] Replies in window: ${replies.length}`);
    } catch (error) {
      row.errors++;
      console.error(
        `[${workspace.slug}] Failed to fetch replies from EmailBison:`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    for (const reply of replies) {
      if (isAutomatedReply(reply)) {
        row.automatedSkipped++;
        continue;
      }

      const existingReply = await prisma.reply.findUnique({
        where: { emailBisonReplyId: reply.id },
        select: { id: true },
      });

      if (existingReply) {
        row.skippedExisting++;
        continue;
      }

      row.missing++;

      if (!APPLY) {
        continue;
      }

      try {
        const resolved = await resolveScheduledEmail(
          client,
          reply.scheduled_email_id,
          stepCache,
        );
        const eventType = inferReplyEventType(reply);
        const externalEventId = `reply:${reply.id}`;
        const campaignId = (reply.campaign_id ?? resolved.ebCampaignId)?.toString() ?? null;
        const replyBodyText = reply.text_body ?? stripHtml(reply.html_body ?? "");
        const webhookEventId = await ensureSyntheticWebhookEvent({
          workspaceSlug: workspace.slug,
          eventType,
          externalEventId,
          campaignId,
          leadEmail: reply.from_email_address,
          senderEmail: reply.primary_to_email_address ?? null,
          payload: {
            source: "webhook_outage_backfill",
            originalWebhookAt: null,
            backfilledAt: new Date().toISOString(),
            outageStartedAt: OUTAGE_START.toISOString(),
            reply,
          },
        });

        await tasks.trigger<typeof processReply>(
          "process-reply",
          {
            workspaceSlug: workspace.slug,
            ebReplyId: reply.id,
            eventType,
            leadEmail: reply.from_email_address,
            leadName: reply.from_name ?? null,
            senderEmail: reply.primary_to_email_address ?? null,
            subject: reply.subject ?? null,
            textBody: replyBodyText,
            interested: reply.interested ?? false,
            campaignId,
            webhookEventId,
            replyFromEmail: reply.from_email_address,
            replyFromName: reply.from_name ?? null,
            replyBodyText,
            replyHtmlBody: reply.html_body ?? null,
            replyReceivedAt: new Date(reply.date_received).toISOString(),
            replyParentId: reply.parent_id ?? null,
            replySenderEmailId: reply.sender_email_id ?? null,
            direction:
              reply.folder === "Sent" || reply.type === "Outgoing Email"
                ? "outbound"
                : "inbound",
            sequenceStep: resolved.sequenceStep,
            replySource: "webhook_outage_backfill",
          },
          {
            idempotencyKey: `reply-${reply.id}`,
            tags: [workspace.slug, "webhook-outage-backfill"],
          },
        );

        row.triggered++;
      } catch (error) {
        row.errors++;
        console.error(
          `[${workspace.slug}] Failed to backfill reply ${reply.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  console.log("\n[eb-webhook-outage-backfill] Summary");
  for (const row of summary) {
    console.log(
      `${row.workspace}: fetched=${row.fetched} missing=${row.missing} triggered=${row.triggered} existing=${row.skippedExisting} automated=${row.automatedSkipped} errors=${row.errors}`,
    );
  }
}

main()
  .catch((error) => {
    console.error("[eb-webhook-outage-backfill] Fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
