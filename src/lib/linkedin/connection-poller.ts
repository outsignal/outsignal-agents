/**
 * Connection Accept Poller — detect LinkedIn connection accepts and handle timeouts.
 *
 * This module runs from the Railway worker. The worker:
 * 1. Calls getConnectionsToCheck() to get a batch of connections to verify
 * 2. For each, calls VoyagerClient.checkConnectionStatus()
 * 3. Calls processConnectionCheckResult() with the result
 *
 * Timeout logic runs inside pollConnectionAccepts(), which the worker calls
 * on each poll cycle (every 2 hours) before checking connection status.
 */
import { prisma } from "@/lib/db";
import { enqueueAction } from "./queue";
import { assignSenderForPerson } from "./sender";
import { evaluateSequenceRules } from "./sequencing";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fallback timeout days — used when no campaign is found for a connection */
const DEFAULT_CONNECTION_TIMEOUT_DAYS = 14;

/** Hours to wait after a timeout before retrying the connection request */
const WITHDRAWAL_COOLDOWN_HOURS = 48;

/**
 * Hard cutoff for live-checking pending connections.
 * All pending connections within this window are eligible for live API checks.
 * This is intentionally much longer than DEFAULT_CONNECTION_TIMEOUT_DAYS so
 * late acceptances (e.g. someone accepting after 20+ days) are still detected.
 */
const LIVE_CHECK_CUTOFF_DAYS = 90;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Look up the connectionTimeoutDays for the campaign associated with a person's
 * most recent connect action in the given workspace.
 * Falls back to DEFAULT_CONNECTION_TIMEOUT_DAYS if no campaign is found.
 */
async function getConnectionTimeoutDaysForPerson(
  personId: string,
  workspaceSlug: string,
): Promise<number> {
  const campaignAction = await prisma.linkedInAction.findFirst({
    where: {
      personId,
      workspaceSlug,
      actionType: { in: ["connect", "connection_request"] },
      campaignName: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!campaignAction?.campaignName) return DEFAULT_CONNECTION_TIMEOUT_DAYS;

  const campaign = await prisma.campaign.findUnique({
    where: { workspaceSlug_name: { workspaceSlug, name: campaignAction.campaignName } },
    select: { connectionTimeoutDays: true },
  });

  return campaign?.connectionTimeoutDays ?? DEFAULT_CONNECTION_TIMEOUT_DAYS;
}

// ─── Poll Entry Point ─────────────────────────────────────────────────────────

export interface PollResult {
  checked: number;
  accepted: number;
  timedOut: number;
  failed: number;
}

/**
 * Process pending connection state — handle timeouts and retries.
 *
 * This function handles the timeout/retry logic for all pending connections
 * in the workspace. It does NOT check live connection status via the API —
 * that's done by the worker calling getConnectionsToCheck() + VoyagerClient.
 *
 * Returns counts of connections processed in each category.
 */
export async function pollConnectionAccepts(workspaceSlug: string): Promise<PollResult> {
  const result: PollResult = { checked: 0, accepted: 0, timedOut: 0, failed: 0 };

  // Find all pending connections for active, healthy senders in this workspace
  const pendingConnections = await prisma.linkedInConnection.findMany({
    where: {
      status: "pending",
      sender: {
        workspaceSlug,
        status: "active",
        healthStatus: "healthy",
      },
    },
    include: {
      sender: true,
    },
  });

  const now = new Date();

  for (const conn of pendingConnections) {
    result.checked++;

    // Skip if no request timestamp (shouldn't happen, but guard defensively)
    if (!conn.requestSentAt) continue;

    // Look up per-campaign timeout (falls back to DEFAULT_CONNECTION_TIMEOUT_DAYS)
    const timeoutDays = await getConnectionTimeoutDaysForPerson(
      conn.personId,
      conn.sender.workspaceSlug,
    );
    const timeoutCutoff = new Date(
      now.getTime() - timeoutDays * 24 * 60 * 60 * 1000,
    );

    // Check if the connection request has timed out
    const isTimedOut = conn.requestSentAt < timeoutCutoff;
    if (!isTimedOut) continue; // Not timed out — will be checked via API by worker

    // Timed out — check if we already have a retry attempt
    const retryAction = await prisma.linkedInAction.findFirst({
      where: {
        personId: conn.personId,
        workspaceSlug: conn.sender.workspaceSlug,
        sequenceStepRef: "connection_retry",
        actionType: { in: ["connect", "connection_request"] },
      },
    });

    if (retryAction) {
      // Already retried once — mark as permanently failed
      await prisma.linkedInConnection.update({
        where: { id: conn.id },
        data: { status: "failed" },
      });

      // Cancel all remaining pending LinkedIn actions for this person
      await prisma.linkedInAction.updateMany({
        where: {
          personId: conn.personId,
          workspaceSlug: conn.sender.workspaceSlug,
          status: "pending",
        },
        data: { status: "cancelled" },
      });

      result.failed++;
    } else {
      // First timeout — check if cooldown period has passed before retrying
      const timeoutTime = new Date(
        conn.requestSentAt.getTime() + timeoutDays * 24 * 60 * 60 * 1000,
      );
      const cooldownEndTime = new Date(
        timeoutTime.getTime() + WITHDRAWAL_COOLDOWN_HOURS * 60 * 60 * 1000,
      );

      if (now >= cooldownEndTime) {
        // Cooldown passed — enqueue a retry connection request
        await enqueueAction({
          senderId: conn.senderId,
          personId: conn.personId,
          workspaceSlug: conn.sender.workspaceSlug,
          actionType: "connect",
          scheduledFor: new Date(),
          sequenceStepRef: "connection_retry",
        });
        result.timedOut++;
      }
      // If cooldown not yet passed: skip, will be processed next poll cycle
    }
  }

  return result;
}

// ─── Result Processing ────────────────────────────────────────────────────────

/**
 * Process the result of a VoyagerClient connection status check.
 *
 * Called by the worker after it checks each connection via the Voyager API.
 * Updates the DB and triggers follow-up sequence actions on acceptance.
 */
export async function processConnectionCheckResult(
  connectionId: string,
  newStatus: "connected" | "none" | "failed",
): Promise<void> {
  const conn = await prisma.linkedInConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { sender: true },
  });

  if (newStatus === "connected") {
    // Mark as connected
    await prisma.linkedInConnection.update({
      where: { id: connectionId },
      data: { status: "connected", connectedAt: new Date() },
    });

    // Increment connectionsAccepted counter for today
    const today = new Date();
    const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    await prisma.linkedInDailyUsage.upsert({
      where: { senderId_date: { senderId: conn.senderId, date: todayDate } },
      create: {
        senderId: conn.senderId,
        date: todayDate,
        connectionsAccepted: 1,
      },
      update: {
        connectionsAccepted: { increment: 1 },
      },
    });

    console.log(`[connection-poller] Connection accepted for person ${conn.personId} — connectionsAccepted incremented for sender ${conn.senderId}`);

    // Find the campaign context via the person's existing LinkedIn actions
    const campaignAction = await prisma.linkedInAction.findFirst({
      where: {
        personId: conn.personId,
        workspaceSlug: conn.sender.workspaceSlug,
        campaignName: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    if (campaignAction?.campaignName) {
      // Load person details for template context
      const person = await prisma.person.findUnique({
        where: { id: conn.personId },
        select: {
          firstName: true,
          lastName: true,
          company: true,
          jobTitle: true,
          linkedinUrl: true,
          email: true,
        },
      });

      if (person) {
        // Evaluate rules triggered by connection_accepted
        const actionDescriptors = await evaluateSequenceRules({
          workspaceSlug: conn.sender.workspaceSlug,
          campaignName: campaignAction.campaignName,
          triggerEvent: "connection_accepted",
          personId: conn.personId,
          person,
        });

        for (const descriptor of actionDescriptors) {
          const scheduledFor = new Date(
            Date.now() + descriptor.delayMinutes * 60 * 1000,
          );

          // Determine which sender to use for the follow-up
          let senderId = conn.senderId;

          // If original sender is no longer healthy, try to reassign
          if (conn.sender.healthStatus !== "healthy") {
            const newSender = await assignSenderForPerson(
              conn.sender.workspaceSlug,
              { mode: "linkedin_only" },
            );

            if (newSender) {
              senderId = newSender.id;
            } else {
              // No healthy sender available — log warning and hold
              // Action won't be enqueued; will be retried when a sender recovers
              console.warn(
                `[connection-poller] No healthy sender available for workspace ${conn.sender.workspaceSlug}. Follow-up for person ${conn.personId} is on hold.`,
              );
              continue;
            }
          }

          await enqueueAction({
            senderId,
            personId: conn.personId,
            workspaceSlug: conn.sender.workspaceSlug,
            actionType: descriptor.actionType as "connect" | "message" | "profile_view" | "check_connection",
            messageBody: descriptor.messageBody ?? undefined,
            scheduledFor,
            campaignName: campaignAction.campaignName,
            sequenceStepRef: descriptor.sequenceStepRef,
          });
        }
      }
    }
  } else if (newStatus === "failed") {
    // Declined or withdrawn by the other party — mark as failed
    await prisma.linkedInConnection.update({
      where: { id: connectionId },
      data: { status: "failed" },
    });

    // Cancel all remaining pending LinkedIn actions for this person
    await prisma.linkedInAction.updateMany({
      where: {
        personId: conn.personId,
        workspaceSlug: conn.sender.workspaceSlug,
        status: "pending",
      },
      data: { status: "cancelled" },
    });
  }
  // newStatus === "none" means still pending — no action needed
}

// ─── Worker Query Interface ───────────────────────────────────────────────────

export interface ConnectionToCheck {
  connectionId: string;
  senderId: string;
  personId: string;
  personLinkedinUrl: string;
}

/**
 * Return the list of pending connections that need to be checked via VoyagerClient.
 *
 * Used by the Railway worker to batch connection status checks.
 * Excludes timed-out connections (those are handled by pollConnectionAccepts).
 */
export async function getConnectionsToCheck(
  workspaceSlug: string,
): Promise<ConnectionToCheck[]> {
  const now = new Date();
  // Use a long 90-day cutoff so all pending connections — including those
  // past the per-campaign timeout — are still live-checked. This allows us to
  // detect late acceptances that would otherwise be missed. Connections that
  // have been pending for over 90 days are considered stale and excluded.
  const liveCheckCutoff = new Date(
    now.getTime() - LIVE_CHECK_CUTOFF_DAYS * 24 * 60 * 60 * 1000,
  );

  const connections = await prisma.linkedInConnection.findMany({
    where: {
      status: "pending",
      requestSentAt: { gte: liveCheckCutoff },
      sender: {
        workspaceSlug,
        status: "active",
        healthStatus: "healthy",
      },
    },
    include: {
      sender: true,
    },
  });

  const results: ConnectionToCheck[] = [];

  for (const conn of connections) {
    // Look up person's LinkedIn URL
    const person = await prisma.person.findUnique({
      where: { id: conn.personId },
      select: { linkedinUrl: true },
    });

    if (!person?.linkedinUrl) continue; // Can't check without a LinkedIn URL

    results.push({
      connectionId: conn.id,
      senderId: conn.senderId,
      personId: conn.personId,
      personLinkedinUrl: person.linkedinUrl,
    });
  }

  return results;
}
