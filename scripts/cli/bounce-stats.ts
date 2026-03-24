/**
 * bounce-stats.ts
 *
 * CLI wrapper: get bounce statistics per inbox for a workspace.
 * Usage: node dist/cli/bounce-stats.js <workspaceSlug>
 *
 * Queries the Sender table for bounce status and recent BounceSnapshots.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";

const [, , workspaceSlug] = process.argv;

runWithHarness("bounce-stats <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");

  // Fetch all senders for the workspace
  const senders = await prisma.sender.findMany({
    where: { workspaceSlug, emailAddress: { not: null } },
    select: {
      id: true,
      emailAddress: true,
      emailBounceStatus: true,
      consecutiveHealthyChecks: true,
      originalDailyLimit: true,
    },
  });

  if (senders.length === 0) {
    return { workspaceSlug, senders: [], message: "No email senders found for workspace" };
  }

  // Fetch latest 3 bounce snapshots per sender for rolling stats
  const senderEmails = senders.map(s => s.emailAddress as string);
  const snapshotsBySender = await Promise.all(
    senderEmails.map(email =>
      prisma.bounceSnapshot.findMany({
        where: { senderEmail: email },
        orderBy: { snapshotDate: "desc" },
        take: 3,
        select: {
          snapshotDate: true,
          bounceRate: true,
          deltaSent: true,
          deltaBounced: true,
          emailsSent: true,
          bounced: true,
        },
      })
    )
  );

  const results = senders.map((sender, i) => {
    const snapshots = snapshotsBySender[i];
    const latestSnapshot = snapshots[0] ?? null;
    return {
      email: sender.emailAddress,
      bounceStatus: sender.emailBounceStatus,
      consecutiveHealthyChecks: sender.consecutiveHealthyChecks,
      originalDailyLimit: sender.originalDailyLimit,
      latestBounceRate: latestSnapshot?.bounceRate ?? null,
      recentSnapshots: snapshots.map(s => ({
        date: s.snapshotDate,
        bounceRate: s.bounceRate,
        deltaSent: s.deltaSent,
        deltaBounced: s.deltaBounced,
      })),
    };
  });

  return { workspaceSlug, senders: results };
});
