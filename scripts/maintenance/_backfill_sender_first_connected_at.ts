/**
 * Backfill Sender.firstConnectedAt using the best local evidence we have.
 *
 * Priority order:
 * 1. Earliest sending evidence already in our DB:
 *    - WebhookEvent EMAIL_SENT for senderEmail
 *    - BounceSnapshot with emailsSent > 0 for senderEmail
 * 2. Existing LinkedIn session activity:
 *    - sessionConnectedAt
 *    - lastActiveAt when sessionStatus != "not_setup"
 * 3. Sender.createdAt fallback
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_backfill_sender_first_connected_at.ts
 *   npx tsx scripts/maintenance/_backfill_sender_first_connected_at.ts --apply
 *   npx tsx scripts/maintenance/_backfill_sender_first_connected_at.ts --workspace rise
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOG_PREFIX = "[backfill-sender-first-connected-at]";
const APPLY = process.argv.includes("--apply");

type SourceKind =
  | "webhook_email_sent"
  | "bounce_snapshot"
  | "session_connected"
  | "last_active"
  | "created_at";

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function earliestDate(values: Array<Date | null>): Date | null {
  const valid = values.filter((value): value is Date => value instanceof Date);
  if (valid.length === 0) return null;
  return valid.reduce((earliest, current) =>
    current.getTime() < earliest.getTime() ? current : earliest
  );
}

async function inferFirstConnectedAt(sender: {
  id: string;
  workspaceSlug: string;
  emailAddress: string | null;
  sessionStatus: string;
  sessionConnectedAt: Date | null;
  lastActiveAt: Date | null;
  createdAt: Date;
}): Promise<{ at: Date; source: SourceKind }> {
  if (sender.emailAddress) {
    const [webhookEvent, bounceSnapshot] = await Promise.all([
      prisma.webhookEvent.findFirst({
        where: {
          workspace: sender.workspaceSlug,
          senderEmail: sender.emailAddress,
          eventType: "EMAIL_SENT",
        },
        orderBy: { receivedAt: "asc" },
        select: { receivedAt: true },
      }),
      prisma.bounceSnapshot.findFirst({
        where: {
          workspaceSlug: sender.workspaceSlug,
          senderEmail: sender.emailAddress,
          emailsSent: { gt: 0 },
        },
        orderBy: { snapshotDate: "asc" },
        select: { snapshotDate: true },
      }),
    ]);

    const sendEvidenceAt = earliestDate([
      webhookEvent?.receivedAt ?? null,
      bounceSnapshot?.snapshotDate ?? null,
    ]);
    if (sendEvidenceAt) {
      return {
        at: sendEvidenceAt,
        source:
          webhookEvent?.receivedAt &&
          sendEvidenceAt.getTime() === webhookEvent.receivedAt.getTime()
            ? "webhook_email_sent"
            : "bounce_snapshot",
      };
    }
  }

  if (sender.sessionConnectedAt) {
    return { at: sender.sessionConnectedAt, source: "session_connected" };
  }

  if (sender.sessionStatus !== "not_setup" && sender.lastActiveAt) {
    return { at: sender.lastActiveAt, source: "last_active" };
  }

  return { at: sender.createdAt, source: "created_at" };
}

async function main() {
  const workspaceFilter = readArg("--workspace");
  console.log(
    `${LOG_PREFIX} mode=${APPLY ? "apply" : "dry-run"}${workspaceFilter ? ` workspace=${workspaceFilter}` : ""}`,
  );

  const senders = await prisma.sender.findMany({
    where: {
      firstConnectedAt: null,
      ...(workspaceFilter ? { workspaceSlug: workspaceFilter } : {}),
    },
    select: {
      id: true,
      workspaceSlug: true,
      emailAddress: true,
      sessionStatus: true,
      sessionConnectedAt: true,
      lastActiveAt: true,
      createdAt: true,
    },
    orderBy: [{ workspaceSlug: "asc" }, { createdAt: "asc" }],
  });

  const inferred = await Promise.all(
    senders.map(async (sender) => ({
      sender,
      inferred: await inferFirstConnectedAt(sender),
    })),
  );

  const perWorkspace = new Map<
    string,
    { total: number; sources: Record<SourceKind, number> }
  >();

  for (const row of inferred) {
    const summary = perWorkspace.get(row.sender.workspaceSlug) ?? {
      total: 0,
      sources: {
        webhook_email_sent: 0,
        bounce_snapshot: 0,
        session_connected: 0,
        last_active: 0,
        created_at: 0,
      },
    };
    summary.total += 1;
    summary.sources[row.inferred.source] += 1;
    perWorkspace.set(row.sender.workspaceSlug, summary);
  }

  console.log(`${LOG_PREFIX} candidates=${inferred.length}`);
  if (perWorkspace.size > 0) {
    console.log(`${LOG_PREFIX} per-workspace:`);
    for (const [workspace, summary] of [...perWorkspace.entries()].sort()) {
      console.log(
        `  - ${workspace}: total=${summary.total} webhook_email_sent=${summary.sources.webhook_email_sent} bounce_snapshot=${summary.sources.bounce_snapshot} session_connected=${summary.sources.session_connected} last_active=${summary.sources.last_active} created_at=${summary.sources.created_at}`,
      );
    }
  }

  if (inferred.length > 0) {
    console.log(`${LOG_PREFIX} sample:`);
    for (const row of inferred.slice(0, 10)) {
      console.log(
        `  - ${row.sender.workspaceSlug} ${row.sender.emailAddress ?? row.sender.id} -> ${row.inferred.at.toISOString()} (${row.inferred.source})`,
      );
    }
  }

  if (!APPLY) {
    console.log(
      `${LOG_PREFIX} dry-run complete. Re-run with --apply to persist firstConnectedAt for ${inferred.length} sender(s).`,
    );
    return;
  }

  for (const row of inferred) {
    await prisma.sender.update({
      where: { id: row.sender.id },
      data: { firstConnectedAt: row.inferred.at },
    });
  }

  console.log(
    `${LOG_PREFIX} applied firstConnectedAt backfill to ${inferred.length} sender(s).`,
  );
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} fatal:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
