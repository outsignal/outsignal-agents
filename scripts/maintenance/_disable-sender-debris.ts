/**
 * Archive stale duplicate sender rows that were left behind by historical
 * provisioning / session bugs.
 *
 * The goal is to remove "active but never really usable" sender records from
 * monitoring and sender-selection paths without deleting history.
 *
 * Safety rules:
 * - DRY-RUN by default. Pass --apply to write.
 * - Candidate row must be:
 *   - status='active'
 *   - sessionStatus='not_setup'
 *   - never connected / never active / never keepalive
 *   - warmupDay=0 and pendingConnectionCount=0
 *   - no stored session / proxy / credentials / login method
 *   - zero LinkedIn actions / connections / conversations / health events
 *   - zero NON-ZERO LinkedIn daily usage
 * - AND there must be another sender in the same workspace with the same name
 *   that is genuinely live (`status='active'`, `sessionStatus='active'`)
 *
 * On apply, candidates are archived by setting:
 *   status='disabled'
 *   healthStatus='paused'
 *
 * Usage:
 *   npx tsx scripts/maintenance/_disable-sender-debris.ts
 *   npx tsx scripts/maintenance/_disable-sender-debris.ts --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOG_PREFIX = "[disable-sender-debris]";

function hasApplyFlag(argv: string[]): boolean {
  return argv.includes("--apply");
}

async function main() {
  const apply = hasApplyFlag(process.argv.slice(2));

  console.log(`${LOG_PREFIX} mode=${apply ? "APPLY" : "DRY-RUN"}`);

  const candidates = await prisma.sender.findMany({
    where: {
      status: "active",
      sessionStatus: "not_setup",
      sessionConnectedAt: null,
      lastKeepaliveAt: null,
      lastActiveAt: null,
      warmupDay: 0,
      pendingConnectionCount: 0,
      sessionData: null,
      proxyUrl: null,
      linkedinPassword: null,
      totpSecret: null,
      loginMethod: "none",
    },
    select: {
      id: true,
      workspaceSlug: true,
      name: true,
      channel: true,
      emailAddress: true,
      linkedinProfileUrl: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          actions: true,
          connections: true,
          linkedInConversations: true,
          healthEvents: true,
        },
      },
    },
    orderBy: [{ workspaceSlug: "asc" }, { name: "asc" }, { createdAt: "asc" }],
  });

  const eligible: Array<{
    id: string;
    workspaceSlug: string;
    name: string;
    channel: string;
    emailAddress: string | null;
    linkedinProfileUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    primaryId: string;
    primaryUpdatedAt: Date;
    counts: Record<string, number>;
  }> = [];

  for (const sender of candidates) {
    const counts = {
      actions: sender._count.actions,
      connections: sender._count.connections,
      conversations: sender._count.linkedInConversations,
      healthEvents: sender._count.healthEvents,
    };

    const hasLinkedInHistory = Object.values(counts).some((count) => count > 0);
    if (hasLinkedInHistory) continue;

    const nonZeroUsage = await prisma.linkedInDailyUsage.count({
      where: {
        senderId: sender.id,
        OR: [
          { connectionsSent: { gt: 0 } },
          { messagesSent: { gt: 0 } },
          { profileViews: { gt: 0 } },
          { connectionsAccepted: { gt: 0 } },
          { withdrawalsSent: { gt: 0 } },
          { p1ConnectionsSent: { gt: 0 } },
        ],
      },
    });
    if (nonZeroUsage > 0) continue;

    const primary = await prisma.sender.findFirst({
      where: {
        id: { not: sender.id },
        workspaceSlug: sender.workspaceSlug,
        name: sender.name,
        status: "active",
        sessionStatus: "active",
      },
      select: {
        id: true,
        updatedAt: true,
      },
      orderBy: [{ lastKeepaliveAt: "desc" }, { updatedAt: "desc" }],
    });

    if (!primary) continue;

    eligible.push({
      id: sender.id,
      workspaceSlug: sender.workspaceSlug,
      name: sender.name,
      channel: sender.channel,
      emailAddress: sender.emailAddress,
      linkedinProfileUrl: sender.linkedinProfileUrl,
      createdAt: sender.createdAt,
      updatedAt: sender.updatedAt,
      primaryId: primary.id,
      primaryUpdatedAt: primary.updatedAt,
      counts,
    });
  }

  console.log(
    `${LOG_PREFIX} scanned=${candidates.length} eligible=${eligible.length}`,
  );

  if (eligible.length === 0) {
    console.log(`${LOG_PREFIX} nothing to do.`);
    return;
  }

  console.table(
    eligible.map((row) => ({
      id: row.id,
      workspace: row.workspaceSlug,
      name: row.name,
      channel: row.channel,
      email: row.emailAddress ?? "",
      profile: row.linkedinProfileUrl ?? "",
      createdAt: row.createdAt.toISOString(),
      primaryId: row.primaryId,
      primaryUpdatedAt: row.primaryUpdatedAt.toISOString(),
    })),
  );

  const byWorkspace = new Map<string, number>();
  for (const row of eligible) {
    byWorkspace.set(row.workspaceSlug, (byWorkspace.get(row.workspaceSlug) ?? 0) + 1);
  }
  console.log(`${LOG_PREFIX} per-workspace:`, Object.fromEntries(byWorkspace));

  if (!apply) {
    console.log(
      `${LOG_PREFIX} DRY-RUN complete. Re-run with --apply to disable ${eligible.length} stale sender row(s).`,
    );
    return;
  }

  let updated = 0;
  for (const row of eligible) {
    const result = await prisma.sender.updateMany({
      where: {
        id: row.id,
        status: "active",
        sessionStatus: "not_setup",
        sessionConnectedAt: null,
        lastKeepaliveAt: null,
        lastActiveAt: null,
        pendingConnectionCount: 0,
        warmupDay: 0,
        sessionData: null,
        proxyUrl: null,
        linkedinPassword: null,
        totpSecret: null,
        loginMethod: "none",
      },
      data: {
        status: "disabled",
        healthStatus: "paused",
      },
    });
    updated += result.count;
  }

  console.log(`${LOG_PREFIX} APPLIED: disabled ${updated} stale sender row(s).`);
}

main()
  .catch((err) => {
    console.error(`${LOG_PREFIX} fatal:`, err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
