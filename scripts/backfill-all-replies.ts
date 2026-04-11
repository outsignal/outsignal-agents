/**
 * One-off script: backfill ALL historical Reply records from EmailBison into the local DB.
 *
 * Usage: npx tsx scripts/backfill-all-replies.ts
 *
 * What it does:
 *   - Loads all workspaces with apiTokens from DB
 *   - For each workspace, fetches ALL reply pages from EmailBison (getReplies)
 *   - Filters out automated/non-real replies (same filter as poll-replies)
 *   - Upserts each real reply into the Reply table (same field mapping as poll-replies)
 *   - Does NOT send notifications, AI suggestions, or LinkedIn actions
 *   - Prints a per-workspace summary + totals
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "../src/lib/emailbison/client";
import {
  createSequenceStepCache,
  resolveSequenceStepOrder,
} from "../src/lib/emailbison/resolve-step";

const prisma = new PrismaClient();

// Strips basic HTML tags — mirrors what poll-replies does via the imported stripHtml util
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isAutomatedReply(reply: {
  automated_reply: boolean;
  from_email_address: string;
  subject: string | null;
}): boolean {
  const fromEmail = reply.from_email_address.toLowerCase();
  const subj = (reply.subject ?? "").toLowerCase();

  return (
    reply.automated_reply ||
    fromEmail.includes("mailer-daemon") ||
    fromEmail.includes("postmaster") ||
    fromEmail.includes("noreply") ||
    fromEmail.includes("no-reply") ||
    fromEmail.includes("@microsoft.com") ||
    (fromEmail.includes("@google.com") &&
      (fromEmail.includes("noreply") || fromEmail.includes("no-reply"))) ||
    subj.includes("delivery status notification") ||
    /out of office|automatic reply|auto-reply|autoreply/i.test(
      reply.subject ?? ""
    ) ||
    subj.includes("connection test") ||
    subj.includes("test email") ||
    subj.includes("weekly digest") ||
    subj.includes("service update") ||
    subj.includes("retention settings")
  );
}

async function main() {
  console.log("[backfill-all-replies] Starting...\n");

  // Load all workspaces with API tokens
  const workspaces = await prisma.workspace.findMany({
    where: { apiToken: { not: null } },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `[backfill-all-replies] Found ${workspaces.length} workspaces with API tokens`
  );

  const summaryRows: {
    workspace: string;
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  }[] = [];

  for (const ws of workspaces) {
    const wsResult = {
      workspace: ws.slug,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };
    summaryRows.push(wsResult);

    console.log(`\n[${ws.slug}] Fetching ALL replies from EmailBison...`);

    const client = new EmailBisonClient(ws.apiToken!);
    // Per-workspace per-run cache for sequence steps. Reused across every
    // reply in this workspace's loop so we only fetch each campaign's step
    // list once, protecting the EB API from unnecessary load.
    const stepCache = createSequenceStepCache();

    let replies: Awaited<ReturnType<EmailBisonClient["getReplies"]>>;
    try {
      replies = await client.getReplies();
      wsResult.fetched = replies.length;
      console.log(`[${ws.slug}] Fetched ${replies.length} replies total`);
    } catch (err) {
      console.error(`[${ws.slug}] Failed to fetch replies:`, err);
      wsResult.errors++;
      continue;
    }

    // Build sender email set for this workspace (for cross-workspace dedup check)
    let senderEmailSet = new Set<string>();
    try {
      const senderEmails = await client.getSenderEmails();
      senderEmailSet = new Set(senderEmails.map((s) => s.email.toLowerCase()));
    } catch {
      console.warn(
        `[${ws.slug}] Could not fetch sender emails — skipping cross-workspace check`
      );
    }

    for (const reply of replies) {
      try {
        // Filter automated/non-real replies
        if (isAutomatedReply(reply)) {
          wsResult.skipped++;
          continue;
        }

        // Sender-ownership check: skip replies that don't belong to this workspace
        const toEmail = (reply.primary_to_email_address ?? "").toLowerCase();
        if (toEmail && senderEmailSet.size > 0 && !senderEmailSet.has(toEmail)) {
          wsResult.skipped++;
          continue;
        }

        const replyBodyText =
          reply.text_body ?? stripHtml(reply.html_body ?? "");

        // Campaign lookup
        let outboundSubject: string | null = null;
        let outboundBody: string | null = null;
        let outsignalCampaignId: string | null = null;
        let outsignalCampaignName: string | null = null;

        if (reply.campaign_id) {
          try {
            const campaign = await prisma.campaign.findFirst({
              where: { emailBisonCampaignId: reply.campaign_id },
              select: { id: true, name: true, emailSequence: true },
            });
            if (campaign) {
              outsignalCampaignId = campaign.id;
              outsignalCampaignName = campaign.name;
              if (campaign.emailSequence) {
                try {
                  const steps = JSON.parse(campaign.emailSequence) as {
                    position: number;
                    subjectLine?: string;
                    body?: string;
                  }[];
                  if (steps.length === 1) {
                    outboundSubject = steps[0].subjectLine ?? null;
                    outboundBody = steps[0].body ?? null;
                  }
                } catch {
                  // JSON parse failure — skip
                }
              }
            }
          } catch {
            // Campaign lookup failure — non-blocking
          }
        }

        // Person lookup
        let personId: string | null = null;
        try {
          const person = await prisma.person.findUnique({
            where: { email: reply.from_email_address },
            select: { id: true },
          });
          personId = person?.id ?? null;
        } catch {
          // Non-blocking
        }

        // Resolve sequence step order via EmailBison two-step lookup.
        // Mirrors the fix applied to trigger/poll-replies.ts: fetch the
        // scheduled email to recover its sequence_step_id, then map it
        // through the campaign's sequence-steps to get the 1-indexed
        // position. Non-throwing — failures fall back to null and the
        // reply persists without step attribution.
        const sequenceStep = await resolveSequenceStepOrder(
          client,
          reply.scheduled_email_id,
          stepCache,
        );

        // Upsert reply — same field mapping as poll-replies
        const direction =
          reply.folder === "Sent" || reply.type === "Outgoing Email"
            ? "outbound"
            : "inbound";

        const existing = await prisma.reply.findUnique({
          where: { emailBisonReplyId: reply.id },
          select: { id: true },
        });

        await prisma.reply.upsert({
          where: { emailBisonReplyId: reply.id },
          create: {
            workspaceSlug: ws.slug,
            senderEmail: reply.from_email_address,
            senderName: reply.from_name,
            subject: reply.subject,
            bodyText: replyBodyText,
            receivedAt: new Date(reply.date_received),
            emailBisonReplyId: reply.id,
            campaignId: outsignalCampaignId,
            campaignName: outsignalCampaignName,
            sequenceStep,
            outboundSubject,
            outboundBody,
            source: "backfill",
            personId,
            emailBisonParentId: reply.parent_id ?? null,
            leadEmail: reply.from_email_address.toLowerCase(),
            htmlBody: reply.html_body ?? null,
            ebSenderEmailId: reply.sender_email_id ?? null,
            interested: reply.interested ?? false,
            direction,
          },
          update: {
            bodyText: replyBodyText,
            subject: reply.subject,
            senderName: reply.from_name,
            htmlBody: reply.html_body ?? undefined,
            interested: reply.interested ?? undefined,
            emailBisonParentId: reply.parent_id ?? undefined,
            ebSenderEmailId: reply.sender_email_id ?? undefined,
            // Backfill campaign/person linkage if missing
            campaignId: outsignalCampaignId ?? undefined,
            campaignName: outsignalCampaignName ?? undefined,
            personId: personId ?? undefined,
            // Heal null sequenceStep on existing rows (upsert previously
            // only wrote this field in the create branch — see BL-028 notes).
            sequenceStep: sequenceStep ?? undefined,
          },
        });

        if (existing) {
          wsResult.updated++;
        } else {
          wsResult.created++;
        }
      } catch (err) {
        console.error(
          `[${ws.slug}] Error upserting reply ${reply.id}:`,
          err instanceof Error ? err.message : String(err)
        );
        wsResult.errors++;
      }
    }

    console.log(
      `[${ws.slug}] Done: ${wsResult.created} created, ${wsResult.updated} updated, ${wsResult.skipped} skipped, ${wsResult.errors} errors`
    );
  }

  // Final summary
  console.log("\n" + "=".repeat(70));
  console.log("BACKFILL SUMMARY");
  console.log("=".repeat(70));
  console.log(
    `${"Workspace".padEnd(25)} ${"Fetched".padStart(8)} ${"Created".padStart(8)} ${"Updated".padStart(8)} ${"Skipped".padStart(8)} ${"Errors".padStart(7)}`
  );
  console.log("-".repeat(70));

  let totalFetched = 0,
    totalCreated = 0,
    totalUpdated = 0,
    totalSkipped = 0,
    totalErrors = 0;

  for (const row of summaryRows) {
    console.log(
      `${row.workspace.padEnd(25)} ${String(row.fetched).padStart(8)} ${String(row.created).padStart(8)} ${String(row.updated).padStart(8)} ${String(row.skipped).padStart(8)} ${String(row.errors).padStart(7)}`
    );
    totalFetched += row.fetched;
    totalCreated += row.created;
    totalUpdated += row.updated;
    totalSkipped += row.skipped;
    totalErrors += row.errors;
  }

  console.log("-".repeat(70));
  console.log(
    `${"TOTAL".padEnd(25)} ${String(totalFetched).padStart(8)} ${String(totalCreated).padStart(8)} ${String(totalUpdated).padStart(8)} ${String(totalSkipped).padStart(8)} ${String(totalErrors).padStart(7)}`
  );
  console.log("=".repeat(70));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-all-replies] Fatal error:", err);
  process.exit(1);
});
