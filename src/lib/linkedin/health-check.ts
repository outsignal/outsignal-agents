/**
 * Sender health check detection engine.
 *
 * Runs daily (piggybacked on existing inbox-health cron at 6am UTC).
 * Detects: bounce rate >5% (min 10 sends), CAPTCHA/restriction signals,
 * session expiry. Applies soft/hard flags, handles auto-recovery,
 * reassigns actions on critical flags, pauses workspace if last sender down.
 */
import { prisma } from "@/lib/db";

export interface HealthCheckResult {
  senderId: string;
  senderName: string;
  workspaceSlug: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
  detail: string;
  bouncePct: number | null;
  severity: "warning" | "critical";
  reassignedCount: number;
  workspacePaused: boolean;
}

/**
 * Run the full sender health check for all active senders across all workspaces.
 *
 * Detection pipeline:
 * 1. Bounce rate >5% (min 10 sends gate) → "warning" (soft flag)
 * 2. CAPTCHA or restriction signal in yesterday's LinkedInDailyUsage → "blocked" (hard flag)
 * 3. sessionStatus === "expired" → "session_expired" (hard flag)
 * 4. Soft-flag auto-recovery: senders with "warning" + healthFlaggedAt ≥ 48h ago
 *    that now have normalized bounce rate are auto-recovered to "healthy"
 */
export async function runSenderHealthCheck(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  const now = new Date();

  // --- Step 1: Fetch all active/setup senders ---
  const senders = await prisma.sender.findMany({
    where: { status: { in: ["active", "setup"] } },
    include: { workspace: true },
  });

  if (senders.length === 0) return results;

  // --- Step 2: Compute bounce rates from WebhookEvent (last 24h) ---
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const webhookEvents = await prisma.webhookEvent.findMany({
    where: {
      eventType: { in: ["EMAIL_SENT", "BOUNCED"] },
      receivedAt: { gte: since24h },
      senderEmail: { not: null },
    },
    select: { senderEmail: true, eventType: true },
  });

  // Build map: senderEmail (lowercased) -> { sent, bounced }
  const bounceMap = new Map<string, { sent: number; bounced: number }>();
  for (const event of webhookEvents) {
    if (!event.senderEmail) continue;
    const key = event.senderEmail.toLowerCase();
    const entry = bounceMap.get(key) ?? { sent: 0, bounced: 0 };
    if (event.eventType === "EMAIL_SENT") entry.sent++;
    else if (event.eventType === "BOUNCED") entry.bounced++;
    bounceMap.set(key, entry);
  }

  // --- Step 3: Check yesterday's LinkedInDailyUsage for health signals ---
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const senderIds = senders.map((s) => s.id);
  const yesterdayUsage = await prisma.linkedInDailyUsage.findMany({
    where: {
      senderId: { in: senderIds },
      date: yesterday,
    },
    select: { senderId: true, captchaDetected: true, restrictionNotice: true },
  });

  const usageMap = new Map<string, { captchaDetected: boolean; restrictionNotice: boolean }>();
  for (const u of yesterdayUsage) {
    usageMap.set(u.senderId, {
      captchaDetected: u.captchaDetected,
      restrictionNotice: u.restrictionNotice,
    });
  }

  // --- Step 4: Check auto-recovery for soft-flagged senders ---
  const COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48 hours

  for (const sender of senders) {
    if (sender.healthStatus === "warning" && sender.healthFlaggedAt) {
      const elapsed = now.getTime() - sender.healthFlaggedAt.getTime();
      if (elapsed >= COOLDOWN_MS) {
        // Recheck current bounce rate
        const emailKey = sender.emailAddress?.toLowerCase();
        const bounceData = emailKey ? bounceMap.get(emailKey) : undefined;
        const currentBouncePct =
          bounceData && bounceData.sent >= 10
            ? bounceData.bounced / bounceData.sent
            : 0;

        if (currentBouncePct <= 0.05) {
          // Auto-recover to healthy
          await prisma.sender.update({
            where: { id: sender.id },
            data: {
              healthStatus: "healthy",
              healthFlaggedAt: null,
            },
          });

          await prisma.senderHealthEvent.create({
            data: {
              senderId: sender.id,
              status: "healthy",
              reason: "auto_recovered",
              detail: `Auto-recovered after 48h cooldown. Current bounce rate: ${(currentBouncePct * 100).toFixed(1)}%`,
              bouncePct: currentBouncePct > 0 ? currentBouncePct : null,
            },
          });

          results.push({
            senderId: sender.id,
            senderName: sender.name,
            workspaceSlug: sender.workspaceSlug,
            previousStatus: "warning",
            newStatus: "healthy",
            reason: "auto_recovered",
            detail: `Auto-recovered after 48h cooldown. Current bounce rate: ${(currentBouncePct * 100).toFixed(1)}%`,
            bouncePct: currentBouncePct > 0 ? currentBouncePct : null,
            severity: "warning",
            reassignedCount: 0,
            workspacePaused: false,
          });
        }
        // If still above threshold, don't re-flag (already in warning); let it stay flagged
      }
    }
  }

  // Re-fetch senders after auto-recovery updates to get fresh healthStatus
  const freshSenders = await prisma.sender.findMany({
    where: { status: { in: ["active", "setup"] } },
  });

  // --- Step 5: Detect and apply new flags ---
  for (const sender of freshSenders) {
    let newStatus: string | null = null;
    let reason: string | null = null;
    let detail: string | null = null;
    let bouncePct: number | null = null;
    let severity: "warning" | "critical" = "warning";

    // Check LinkedIn health signals first (highest priority)
    const usage = usageMap.get(sender.id);
    if (usage?.captchaDetected && sender.healthStatus !== "blocked") {
      newStatus = "blocked";
      reason = "captcha";
      detail = "CAPTCHA detected in yesterday's LinkedIn session. Manual review required.";
      severity = "critical";
    } else if (usage?.restrictionNotice && sender.healthStatus !== "blocked") {
      newStatus = "blocked";
      reason = "restriction";
      detail = "LinkedIn restriction notice detected in yesterday's session. Manual review required.";
      severity = "critical";
    }

    // Check session expiry
    if (!newStatus && sender.sessionStatus === "expired" && sender.healthStatus !== "session_expired") {
      newStatus = "session_expired";
      reason = "session_expired";
      detail = "LinkedIn session cookie has expired. Re-authentication required.";
      severity = "critical";
    }

    // Check bounce rate (only if no harder flag already detected)
    if (!newStatus && sender.emailAddress) {
      const emailKey = sender.emailAddress.toLowerCase();
      const bounceData = bounceMap.get(emailKey);
      if (bounceData && bounceData.sent >= 10) {
        const rate = bounceData.bounced / bounceData.sent;
        if (rate > 0.05 && sender.healthStatus !== "warning") {
          newStatus = "warning";
          reason = "bounce_rate";
          bouncePct = rate;
          detail = `Bounce rate ${(rate * 100).toFixed(1)}% (${bounceData.bounced}/${bounceData.sent} sends in last 24h). Sender flagged for monitoring.`;
          severity = "warning";
        }
      }
    }

    // Skip if no change needed
    if (!newStatus || !reason || !detail) continue;

    // --- Step 6: Apply flag and record event ---
    const isSoftFlag = severity === "warning";

    await prisma.sender.update({
      where: { id: sender.id },
      data: {
        healthStatus: newStatus,
        healthFlaggedAt: isSoftFlag ? now : sender.healthFlaggedAt, // only set for soft flags
      },
    });

    await prisma.senderHealthEvent.create({
      data: {
        senderId: sender.id,
        status: newStatus,
        reason,
        detail,
        bouncePct,
      },
    });

    let reassignedCount = 0;
    let workspacePaused = false;

    // Critical flags: reassign actions and possibly pause workspace
    if (severity === "critical") {
      const reassignResult = await reassignActions(sender.id, sender.workspaceSlug);
      reassignedCount = reassignResult.reassignedCount;

      // Check if this workspace now has no healthy senders
      const healthySendersInWorkspace = await prisma.sender.count({
        where: {
          workspaceSlug: sender.workspaceSlug,
          status: { in: ["active", "setup"] },
          healthStatus: { in: ["healthy", "warning"] },
          id: { not: sender.id }, // exclude the one we just flagged
        },
      });

      if (healthySendersInWorkspace === 0) {
        // Last healthy sender — pause all active campaigns in this workspace
        await prisma.$transaction(async (tx) => {
          await tx.campaign.updateMany({
            where: {
              workspaceSlug: sender.workspaceSlug,
              status: { in: ["active", "deployed"] },
            },
            data: { status: "paused" },
          });
        });
        workspacePaused = true;
      }
    }

    results.push({
      senderId: sender.id,
      senderName: sender.name,
      workspaceSlug: sender.workspaceSlug,
      previousStatus: sender.healthStatus,
      newStatus,
      reason,
      detail,
      bouncePct,
      severity,
      reassignedCount,
      workspacePaused,
    });
  }

  return results;
}

/**
 * Reassign pending LinkedIn actions from a flagged sender to the healthiest
 * available sender in the same workspace (least-loaded + budget check).
 *
 * Returns the number of actions reassigned.
 */
async function reassignActions(
  flaggedSenderId: string,
  workspaceSlug: string,
): Promise<{ reassignedCount: number }> {
  // Find a healthy replacement sender in the workspace
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const healthySenders = await prisma.sender.findMany({
    where: {
      workspaceSlug,
      status: { in: ["active", "setup"] },
      healthStatus: { in: ["healthy", "warning"] },
      id: { not: flaggedSenderId },
    },
  });

  if (healthySenders.length === 0) {
    // No healthy replacement — actions stay orphaned (workspace paused separately)
    return { reassignedCount: 0 };
  }

  // Pick least-loaded sender by pending action count
  const sendersWithLoad = await Promise.all(
    healthySenders.map(async (s) => {
      const pendingCount = await prisma.linkedInAction.count({
        where: { senderId: s.id, status: "pending" },
      });

      // Also check remaining daily budget
      const todayUsage = await prisma.linkedInDailyUsage.findUnique({
        where: { senderId_date: { senderId: s.id, date: today } },
        select: { connectionsSent: true, messagesSent: true },
      });
      const connectionsUsed = todayUsage?.connectionsSent ?? 0;
      const messagesUsed = todayUsage?.messagesSent ?? 0;
      const remainingBudget =
        (s.dailyConnectionLimit - connectionsUsed) + (s.dailyMessageLimit - messagesUsed);

      return { sender: s, pendingCount, remainingBudget };
    }),
  );

  // Sort by least pending + most remaining budget (combined score)
  sendersWithLoad.sort((a, b) => {
    const scoreA = a.pendingCount - a.remainingBudget;
    const scoreB = b.pendingCount - b.remainingBudget;
    return scoreA - scoreB;
  });

  const targetSender = sendersWithLoad[0]?.sender;
  if (!targetSender) return { reassignedCount: 0 };

  // Reassign all pending actions from the flagged sender to the target sender
  const result = await prisma.linkedInAction.updateMany({
    where: {
      senderId: flaggedSenderId,
      status: "pending",
    },
    data: {
      senderId: targetSender.id,
    },
  });

  return { reassignedCount: result.count };
}
