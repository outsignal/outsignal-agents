import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const MIN_SENDS_FOR_RATE = 20;

/**
 * Compute daily deltas between a current snapshot and the previous one.
 * Returns nulls on first snapshot or if counter reset is detected.
 */
export function computeDeltas(
  _senderEmail: string,
  current: { emailsSent: number; bounced: number; replied: number },
  previous: { emailsSent: number; bounced: number; replied: number } | null,
): {
  deltaSent: number | null;
  deltaBounced: number | null;
  deltaReplied: number | null;
} {
  if (!previous) {
    return { deltaSent: null, deltaBounced: null, deltaReplied: null };
  }

  // Counter reset detection: if current cumulative < previous, treat as reset
  if (
    current.emailsSent < previous.emailsSent ||
    current.bounced < previous.bounced ||
    current.replied < previous.replied
  ) {
    return { deltaSent: null, deltaBounced: null, deltaReplied: null };
  }

  return {
    deltaSent: current.emailsSent - previous.emailsSent,
    deltaBounced: current.bounced - previous.bounced,
    deltaReplied: current.replied - previous.replied,
  };
}

/**
 * Compute domain-level rollup from all BounceSnapshot rows for a given domain and date.
 * Weighted bounce rate = totalBounced / totalSent (only if totalSent >= MIN_SENDS_FOR_RATE).
 */
export async function computeDomainRollup(
  domain: string,
  date: Date,
): Promise<{
  totalSent: number;
  totalBounced: number;
  weightedBounceRate: number | null;
  senderCount: number;
}> {
  const snapshots = await prisma.bounceSnapshot.findMany({
    where: {
      senderDomain: domain,
      snapshotDate: date,
    },
  });

  if (snapshots.length === 0) {
    return {
      totalSent: 0,
      totalBounced: 0,
      weightedBounceRate: null,
      senderCount: 0,
    };
  }

  const totalSent = snapshots.reduce((sum, s) => sum + s.emailsSent, 0);
  const totalBounced = snapshots.reduce((sum, s) => sum + s.bounced, 0);

  const weightedBounceRate =
    totalSent >= MIN_SENDS_FOR_RATE ? totalBounced / totalSent : null;

  return {
    totalSent,
    totalBounced,
    weightedBounceRate,
    senderCount: snapshots.length,
  };
}

/**
 * Capture daily bounce snapshots for all sender emails in a workspace.
 * Merges warmup data from EmailBison warmup API.
 */
export async function captureSnapshots(
  workspaceSlug: string,
  apiToken: string,
): Promise<{ captured: number; errors: string[] }> {
  const errors: string[] = [];
  let captured = 0;

  const client = new EmailBisonClient(apiToken);

  // Fetch all sender emails with cumulative stats
  let senderEmails;
  try {
    senderEmails = await client.getSenderEmails();
  } catch (err) {
    const msg = `[domain-health] Failed to fetch sender emails for ${workspaceSlug}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    return { captured: 0, errors: [msg] };
  }

  // Fetch warmup data (graceful — may fail if endpoint unavailable)
  let warmupMap: Map<string, { warmupEnabled: boolean; warmupData: string }> =
    new Map();
  try {
    const { fetchWarmupData } = await import("./warmup");
    const warmupItems = await fetchWarmupData(apiToken);
    for (const item of warmupItems) {
      warmupMap.set(item.email.toLowerCase(), {
        warmupEnabled: item.warmupEnabled,
        warmupData: JSON.stringify(item),
      });
    }
    console.log(
      `[domain-health] Warmup data fetched for ${workspaceSlug}: ${warmupItems.length} entries`,
    );
  } catch (err) {
    console.warn(
      `[domain-health] Warmup data unavailable for ${workspaceSlug}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Today at midnight UTC
  const now = new Date();
  const snapshotDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  for (const sender of senderEmails) {
    try {
      const senderEmail = sender.email.toLowerCase();
      const senderDomain = senderEmail.split("@")[1] ?? "unknown";

      // Query the latest previous snapshot for delta computation
      const previousSnapshot = await prisma.bounceSnapshot.findFirst({
        where: {
          senderEmail,
          snapshotDate: { lt: snapshotDate },
        },
        orderBy: { snapshotDate: "desc" },
      });

      const currentMetrics = {
        emailsSent: sender.emails_sent_count,
        bounced: sender.bounced_count,
        replied: sender.total_replied_count,
      };

      const previousMetrics = previousSnapshot
        ? {
            emailsSent: previousSnapshot.emailsSent,
            bounced: previousSnapshot.bounced,
            replied: previousSnapshot.replied,
          }
        : null;

      const { deltaSent, deltaBounced, deltaReplied } = computeDeltas(
        senderEmail,
        currentMetrics,
        previousMetrics,
      );

      // Compute bounce rate:
      // - If first snapshot or counter reset (deltas null): use cumulative if >= MIN_SENDS_FOR_RATE
      // - Otherwise: use daily delta (deltaBounced / deltaSent) if deltaSent > 0
      let bounceRate: number | null = null;
      if (deltaSent !== null && deltaSent >= MIN_SENDS_FOR_RATE) {
        bounceRate = (deltaBounced ?? 0) / deltaSent;
      } else if (deltaSent === null) {
        // First snapshot or counter reset — use cumulative
        if (sender.emails_sent_count >= MIN_SENDS_FOR_RATE) {
          bounceRate = sender.bounced_count / sender.emails_sent_count;
        }
      }
      // If deltaSent === 0, no sends today, bounceRate stays null

      const warmupEntry = warmupMap.get(senderEmail);

      await prisma.bounceSnapshot.upsert({
        where: {
          senderEmail_snapshotDate: {
            senderEmail,
            snapshotDate,
          },
        },
        create: {
          workspaceSlug,
          senderEmail,
          senderDomain,
          emailsSent: sender.emails_sent_count,
          bounced: sender.bounced_count,
          replied: sender.total_replied_count,
          opened: sender.unique_opened_count,
          deltaSent,
          deltaBounced,
          deltaReplied,
          bounceRate,
          warmupEnabled: warmupEntry?.warmupEnabled ?? sender.warmup_enabled ?? null,
          warmupData: warmupEntry?.warmupData ?? null,
          snapshotDate,
        },
        update: {
          emailsSent: sender.emails_sent_count,
          bounced: sender.bounced_count,
          replied: sender.total_replied_count,
          opened: sender.unique_opened_count,
          deltaSent,
          deltaBounced,
          deltaReplied,
          bounceRate,
          warmupEnabled: warmupEntry?.warmupEnabled ?? sender.warmup_enabled ?? null,
          warmupData: warmupEntry?.warmupData ?? null,
        },
      });

      captured++;
    } catch (err) {
      const msg = `[domain-health] Failed to upsert snapshot for ${sender.email} (${workspaceSlug}): ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `[domain-health] Snapshot capture complete for ${workspaceSlug}: ${captured} senders captured, ${errors.length} errors`,
  );

  return { captured, errors };
}

/**
 * Capture snapshots across all workspaces that have an apiToken configured.
 */
export async function captureAllWorkspaces(): Promise<{
  workspaces: number;
  senders: number;
  errors: string[];
}> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      apiToken: { not: null },
      status: { not: "onboarding" },
    },
    select: { slug: true, name: true, apiToken: true },
  });

  let totalSenders = 0;
  const allErrors: string[] = [];

  for (const workspace of workspaces) {
    if (!workspace.apiToken) continue;

    const result = await captureSnapshots(workspace.slug, workspace.apiToken);
    totalSenders += result.captured;
    allErrors.push(...result.errors);
  }

  console.log(
    `[domain-health] All workspaces snapshot complete: ${workspaces.length} workspaces, ${totalSenders} senders, ${allErrors.length} errors`,
  );

  return {
    workspaces: workspaces.length,
    senders: totalSenders,
    errors: allErrors,
  };
}
