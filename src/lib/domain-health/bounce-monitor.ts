import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const LOG_PREFIX = "[bounce-monitor]";

// Feature flag: when true, EmailBison API is called to reduce/restore daily limits
const EMAILBISON_MGMT_ENABLED = process.env.EMAILBISON_SENDER_MGMT_ENABLED === "true";

// Step-down requires 6 consecutive healthy checks (~24h at 4-hour cron intervals)
const CONSECUTIVE_CHECKS_FOR_STEPDOWN = 6;

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmailBounceStatus = "healthy" | "elevated" | "warning" | "critical";

interface SenderSnapshot {
  id: string;
  emailAddress: string;
  workspaceSlug: string;
  emailBounceStatus: string;
  consecutiveHealthyChecks: number;
  emailBisonSenderId: number | null;
  originalDailyLimit: number | null;
  originalWarmupEnabled: boolean | null;
  removedFromCampaignIds: string | null; // JSON string
}

// ─── Core classification ──────────────────────────────────────────────────────

/**
 * Classify a bounce rate into a health status.
 * Thresholds (locked per CONTEXT.md):
 *   healthy  < 2%
 *   elevated 2%–3%
 *   warning  3%–5%
 *   critical >= 5% OR blacklisted
 *
 * Returns null when bounceRate is null (no data — skip evaluation).
 */
export function computeEmailBounceStatus(
  bounceRate: number | null,
  isBlacklisted: boolean,
): EmailBounceStatus | null {
  if (isBlacklisted) return "critical";
  if (bounceRate === null) return null;
  if (bounceRate >= 0.05) return "critical";
  if (bounceRate >= 0.03) return "warning";
  if (bounceRate >= 0.02) return "elevated";
  return "healthy";
}

// ─── Step-down helpers ────────────────────────────────────────────────────────

/**
 * The bounce rate must be BELOW this threshold for the consecutive-check
 * counter to increment. If still at/above threshold, counter resets.
 */
function stepDownThreshold(currentStatus: EmailBounceStatus): number {
  switch (currentStatus) {
    case "critical":  return 0.05;
    case "warning":   return 0.03;
    case "elevated":  return 0.02;
    case "healthy":   return 0;
  }
}

/**
 * Move one level down the severity ladder.
 */
function stepDown(status: EmailBounceStatus): EmailBounceStatus {
  switch (status) {
    case "critical":  return "warning";
    case "warning":   return "elevated";
    case "elevated":  return "healthy";
    case "healthy":   return "healthy";
  }
}

/**
 * Numeric severity — higher = worse. Used to compare current vs new status.
 */
function statusSeverity(status: EmailBounceStatus): number {
  switch (status) {
    case "healthy":  return 0;
    case "elevated": return 1;
    case "warning":  return 2;
    case "critical": return 3;
  }
}

// ─── Per-sender evaluation ────────────────────────────────────────────────────

export async function evaluateSender(params: {
  sender: SenderSnapshot;
  bounceRate: number | null;
  isBlacklisted: boolean;
}): Promise<{
  transitioned: boolean;
  from?: string;
  to?: string;
  reason?: string;
  action?: string;
}> {
  const { sender, bounceRate, isBlacklisted } = params;

  // 1. Classify
  const newStatus = computeEmailBounceStatus(bounceRate, isBlacklisted);
  if (newStatus === null) {
    console.log(`${LOG_PREFIX} Skipping ${sender.emailAddress} — no bounce data`);
    return { transitioned: false };
  }

  const currentStatus = sender.emailBounceStatus as EmailBounceStatus;
  const currentSeverity = statusSeverity(currentStatus);
  const newSeverity = statusSeverity(newStatus);

  // ── 2a. ESCALATION ────────────────────────────────────────────────────────
  if (newSeverity > currentSeverity) {
    const reason = isBlacklisted ? "blacklist" : "bounce_rate";
    const bouncePctDisplay = bounceRate !== null ? (bounceRate * 100).toFixed(1) : "n/a";
    const detail = isBlacklisted
      ? `Domain blacklisted — escalated to ${newStatus}`
      : `Bounce rate ${bouncePctDisplay}% — escalated to ${newStatus}`;

    let action: string | undefined;

    // EmailBison actions (feature-flagged)
    if (EMAILBISON_MGMT_ENABLED && sender.emailBisonSenderId !== null) {
      const ebClient = new EmailBisonClient(process.env.EMAILBISON_API_TOKEN ?? "");

      if (newStatus === "warning") {
        // Reduce daily limit by 50%
        try {
          const senderEmails = await ebClient.getSenderEmails();
          const senderEmail = senderEmails.find(s => s.id === sender.emailBisonSenderId);
          const currentLimit = senderEmail?.daily_limit ?? 100;

          // Store original limit before reducing (only if not already stored)
          const limitToStore = sender.originalDailyLimit ?? currentLimit;
          await prisma.sender.update({
            where: { id: sender.id },
            data: { originalDailyLimit: limitToStore },
          });

          const reducedLimit = Math.max(1, Math.floor(currentLimit / 2));
          await ebClient.patchSenderEmail(sender.emailBisonSenderId, { daily_limit: reducedLimit });
          action = "daily_limit_reduced";
          console.log(`${LOG_PREFIX} ${sender.emailAddress}: reduced daily limit from ${currentLimit} to ${reducedLimit}`);
        } catch (err) {
          console.error(`${LOG_PREFIX} Failed to reduce daily limit for ${sender.emailAddress}:`, err);
        }
      } else if (newStatus === "critical") {
        // Critical remediation: throttle sender to 1/day and pause/unpause campaigns
        // to trigger EB's scheduler to redistribute leads to other healthy senders.
        // Do NOT remove sender from campaign — that marks pending sequences as "stopped".
        try {
          const senderEmails = await ebClient.getSenderEmails();
          const senderEmail = senderEmails.find(s => s.id === sender.emailBisonSenderId);

          if (senderEmail) {
            // Store original state before modifying
            const currentLimit = senderEmail.daily_limit ?? 100;
            const currentWarmup = senderEmail.warmup_enabled ?? true;
            const limitToStore = sender.originalDailyLimit ?? currentLimit;

            // Store original state on Sender for recovery
            await prisma.sender.update({
              where: { id: sender.id },
              data: {
                originalDailyLimit: limitToStore,
                originalWarmupEnabled: currentWarmup,
              },
            });

            // Set daily_limit=1 and disable warmup if blacklisted
            await ebClient.patchSenderEmail(sender.emailBisonSenderId!, {
              daily_limit: 1,
              warmup_enabled: isBlacklisted ? false : currentWarmup,
            });

            // Find active campaigns this sender is in
            const activeCampaigns = (senderEmail.campaigns ?? []).filter(
              c => c.status === "active"
            );

            // Pause then unpause each campaign to trigger EB scheduler redistribution
            let redistributedCount = 0;
            for (const campaign of activeCampaigns) {
              try {
                await ebClient.pauseCampaign(campaign.id);
                await ebClient.resumeCampaign(campaign.id);
                redistributedCount++;
                console.log(`${LOG_PREFIX} ${sender.emailAddress}: pause/unpause campaign "${campaign.name}" (${campaign.id}) to trigger redistribution`);
              } catch (campaignErr) {
                console.error(`${LOG_PREFIX} Failed to pause/unpause campaign ${campaign.id} for ${sender.emailAddress}:`, campaignErr);
                // Try to resume campaign if pause succeeded but resume failed
                try { await ebClient.resumeCampaign(campaign.id); } catch { /* best effort */ }
              }
            }

            action = redistributedCount > 0
              ? "critical_remediation_complete"
              : "critical_daily_limit_reduced";
            console.log(
              `${LOG_PREFIX} ${sender.emailAddress}: CRITICAL remediation — ` +
              `daily_limit=1, pause/unpause ${redistributedCount} campaigns for redistribution` +
              (isBlacklisted ? ", warmup disabled (blacklisted)" : "")
            );
          }
        } catch (err) {
          console.error(`${LOG_PREFIX} Critical remediation failed for ${sender.emailAddress}:`, err);
          action = "critical_remediation_failed";
        }
      }
    }

    // Persist status transition
    await prisma.$transaction([
      prisma.sender.update({
        where: { id: sender.id },
        data: {
          emailBounceStatus: newStatus,
          emailBounceStatusAt: new Date(),
          consecutiveHealthyChecks: 0,
        },
      }),
      prisma.emailHealthEvent.create({
        data: {
          senderEmail: sender.emailAddress,
          senderDomain: sender.emailAddress.split("@")[1] ?? "",
          workspaceSlug: sender.workspaceSlug,
          fromStatus: currentStatus,
          toStatus: newStatus,
          reason,
          bouncePct: bounceRate,
          detail,
          senderId: sender.id,
        },
      }),
    ]);

    console.log(`${LOG_PREFIX} ${sender.emailAddress}: ${currentStatus} → ${newStatus} (${reason})`);
    return { transitioned: true, from: currentStatus, to: newStatus, reason, action };
  }

  // ── 2b. SAME SEVERITY or LOWER — check step-down eligibility ─────────────
  // (lower-severity means bounce improved but we still apply gradual recovery)

  // If currently healthy, nothing to do
  if (currentStatus === "healthy") {
    return { transitioned: false };
  }

  const threshold = stepDownThreshold(currentStatus);
  const isBelowThreshold = bounceRate !== null && bounceRate < threshold;

  if (isBelowThreshold) {
    const newCount = sender.consecutiveHealthyChecks + 1;

    if (newCount >= CONSECUTIVE_CHECKS_FOR_STEPDOWN) {
      // Ready to step down
      const stepDownStatus = stepDown(currentStatus);
      let action: string | undefined;

      // Restore daily limit if stepping down from warning
      if (currentStatus === "warning" && EMAILBISON_MGMT_ENABLED && sender.emailBisonSenderId !== null && sender.originalDailyLimit !== null) {
        try {
          const ebClient = new EmailBisonClient(process.env.EMAILBISON_API_TOKEN ?? "");
          await ebClient.patchSenderEmail(sender.emailBisonSenderId, { daily_limit: sender.originalDailyLimit });
          action = "daily_limit_restored";
          console.log(`${LOG_PREFIX} ${sender.emailAddress}: restored daily limit to ${sender.originalDailyLimit}`);
        } catch (err) {
          console.error(`${LOG_PREFIX} Failed to restore daily limit for ${sender.emailAddress}:`, err);
        }
      }

      // Restore daily limit + warmup if stepping down from critical
      if (currentStatus === "critical" && EMAILBISON_MGMT_ENABLED && sender.emailBisonSenderId !== null) {
        try {
          const ebClient = new EmailBisonClient(process.env.EMAILBISON_API_TOKEN ?? "");
          // Restore daily_limit
          const restoreLimit = sender.originalDailyLimit ?? 100;
          // Restore warmup
          const restoreWarmup = sender.originalWarmupEnabled ?? true;
          await ebClient.patchSenderEmail(sender.emailBisonSenderId, {
            daily_limit: restoreLimit,
            warmup_enabled: restoreWarmup,
          });

          action = "critical_recovery_complete";
          console.log(
            `${LOG_PREFIX} ${sender.emailAddress}: recovery from critical — ` +
            `daily_limit=${restoreLimit}, warmup=${restoreWarmup}`
          );
        } catch (err) {
          console.error(`${LOG_PREFIX} Failed to restore settings for ${sender.emailAddress}:`, err);
        }
      }

      const bouncePctDisplay = bounceRate !== null ? (bounceRate * 100).toFixed(1) : "n/a";

      await prisma.$transaction([
        prisma.sender.update({
          where: { id: sender.id },
          data: {
            emailBounceStatus: stepDownStatus,
            emailBounceStatusAt: new Date(),
            consecutiveHealthyChecks: 0,
            // Clear stored recovery fields after restoring
            ...(currentStatus === "critical" ? {
              originalDailyLimit: null,
              originalWarmupEnabled: null,
              removedFromCampaignIds: null,
            } : {}),
            ...(currentStatus === "warning" ? { originalDailyLimit: null } : {}),
          },
        }),
        prisma.emailHealthEvent.create({
          data: {
            senderEmail: sender.emailAddress,
            senderDomain: sender.emailAddress.split("@")[1] ?? "",
            workspaceSlug: sender.workspaceSlug,
            fromStatus: currentStatus,
            toStatus: stepDownStatus,
            reason: "step_down",
            bouncePct: bounceRate,
            detail: `Bounce rate ${bouncePctDisplay}% sustained below threshold for ${newCount} checks — stepped down`,
            senderId: sender.id,
          },
        }),
      ]);

      console.log(`${LOG_PREFIX} ${sender.emailAddress}: step-down ${currentStatus} → ${stepDownStatus} (${newCount} consecutive healthy checks)`);
      return { transitioned: true, from: currentStatus, to: stepDownStatus, reason: "step_down", action };
    } else {
      // Increment counter, not ready yet
      await prisma.sender.update({
        where: { id: sender.id },
        data: { consecutiveHealthyChecks: newCount },
      });
      console.log(`${LOG_PREFIX} ${sender.emailAddress}: below threshold (${newCount}/${CONSECUTIVE_CHECKS_FOR_STEPDOWN} healthy checks)`);
      return { transitioned: false };
    }
  } else {
    // At or above threshold — reset counter
    await prisma.sender.update({
      where: { id: sender.id },
      data: { consecutiveHealthyChecks: 0 },
    });
    return { transitioned: false };
  }
}

// ─── Full cron run orchestrator ───────────────────────────────────────────────

/**
 * Evaluate all active senders across all workspaces.
 * Returns transition list — caller (cron route in Plan 02) handles notifications.
 */
export async function runBounceMonitor(): Promise<{
  evaluated: number;
  transitioned: number;
  skipped: number;
  transitions: Array<{ senderEmail: string; workspaceSlug: string; from: string; to: string; reason: string; action?: string }>;
}> {
  console.log(`${LOG_PREFIX} Starting bounce monitor run`);

  // 1. Fetch all active senders with email addresses
  const senders = await prisma.sender.findMany({
    where: {
      emailAddress: { not: null },
      status: { not: "disabled" },
    },
    select: {
      id: true,
      emailAddress: true,
      workspaceSlug: true,
      emailBounceStatus: true,
      consecutiveHealthyChecks: true,
      emailBisonSenderId: true,
      originalDailyLimit: true,
      originalWarmupEnabled: true,
      removedFromCampaignIds: true,
    },
  });

  console.log(`${LOG_PREFIX} Found ${senders.length} senders to evaluate`);

  // 2. Batch-fetch latest bounce snapshots and domain health records
  const senderEmails = senders.map(s => s.emailAddress as string);
  const senderDomains = [...new Set(senders.map(s => (s.emailAddress as string).split("@")[1] ?? ""))];

  // Latest snapshot per sender
  const snapshots = await Promise.all(
    senderEmails.map(email =>
      prisma.bounceSnapshot.findFirst({
        where: { senderEmail: email },
        orderBy: { snapshotDate: "desc" },
        select: { senderEmail: true, bounceRate: true },
      }),
    ),
  );

  // Domain health records — use blacklistSeverity to determine blacklist status,
  // not overallHealth (which can be "critical" for non-blacklist reasons like SPF fail)
  const domainHealthRecords = await prisma.domainHealth.findMany({
    where: { domain: { in: senderDomains } },
    select: { domain: true, blacklistSeverity: true },
  });

  // Build lookup maps
  const bounceRateByEmail = new Map<string, number | null>();
  for (const snap of snapshots) {
    if (snap) bounceRateByEmail.set(snap.senderEmail, snap.bounceRate ?? null);
  }

  // Only treat domains with critical-tier blacklist hits as blacklisted.
  // Warning-tier hits (URIBL, SURBL) should not trigger sender CRITICAL escalation.
  const isBlacklistedByDomain = new Map<string, boolean>();
  for (const dh of domainHealthRecords) {
    isBlacklistedByDomain.set(dh.domain, dh.blacklistSeverity === "critical");
  }

  // 3. Evaluate each sender
  let evaluated = 0;
  let transitioned = 0;
  let skipped = 0;
  const transitions: Array<{ senderEmail: string; workspaceSlug: string; from: string; to: string; reason: string; action?: string }> = [];

  for (const sender of senders) {
    const email = sender.emailAddress as string;
    const domain = email.split("@")[1] ?? "";
    const bounceRate = bounceRateByEmail.get(email) ?? null;
    const isBlacklisted = isBlacklistedByDomain.get(domain) ?? false;

    try {
      const result = await evaluateSender({
        sender: { ...sender, emailAddress: email },
        bounceRate,
        isBlacklisted,
      });

      evaluated++;

      if (result.transitioned && result.from !== undefined && result.to !== undefined) {
        transitioned++;
        transitions.push({
          senderEmail: email,
          workspaceSlug: sender.workspaceSlug,
          from: result.from,
          to: result.to,
          reason: result.reason ?? "unknown",
          action: result.action,
        });
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Error evaluating sender ${email}:`, err);
      skipped++;
    }
  }

  console.log(`${LOG_PREFIX} Run complete — evaluated: ${evaluated}, transitioned: ${transitioned}, skipped: ${skipped}`);

  return { evaluated, transitioned, skipped, transitions };
}

// ─── Replacement sender finder ────────────────────────────────────────────────

/**
 * Identify the healthiest replacement sender in the same workspace.
 * Actual campaign reassignment depends on EmailBison API (TBD).
 * This function returns the candidate — cron route includes it in the notification.
 */
export async function replaceSender(params: {
  criticalSender: { id: string; emailAddress: string; workspaceSlug: string };
}): Promise<{ replacementEmail: string | null; reason: string }> {
  const { criticalSender } = params;

  // Find all healthy active senders in same workspace (excluding the critical one)
  const candidates = await prisma.sender.findMany({
    where: {
      workspaceSlug: criticalSender.workspaceSlug,
      emailBounceStatus: "healthy",
      status: "active",
      emailAddress: { not: null },
      id: { not: criticalSender.id },
    },
    select: { id: true, emailAddress: true },
  });

  if (candidates.length === 0) {
    return { replacementEmail: null, reason: "No healthy senders available in workspace" };
  }

  // Find latest bounce rate for each candidate, pick lowest
  const candidateRates = await Promise.all(
    candidates.map(async c => {
      const snap = await prisma.bounceSnapshot.findFirst({
        where: { senderEmail: c.emailAddress as string },
        orderBy: { snapshotDate: "desc" },
        select: { bounceRate: true },
      });
      return { emailAddress: c.emailAddress as string, bounceRate: snap?.bounceRate ?? null };
    }),
  );

  // Sort: null bounce rates last, lowest rate first
  candidateRates.sort((a, b) => {
    if (a.bounceRate === null && b.bounceRate === null) return 0;
    if (a.bounceRate === null) return 1;
    if (b.bounceRate === null) return -1;
    return a.bounceRate - b.bounceRate;
  });

  const best = candidateRates[0];
  return {
    replacementEmail: best.emailAddress,
    reason: "Replaced with healthiest available sender",
  };
}
