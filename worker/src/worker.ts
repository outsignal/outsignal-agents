/**
 * Worker — polls the queue and executes LinkedIn actions.
 *
 * For each active sender:
 *   1. Check business hours
 *   2. Poll /api/linkedin/actions/next
 *   3. Load Voyager cookies from API (or env vars as fallback)
 *   4. Create VoyagerClient per sender and execute actions via HTTP
 *   5. Spread delays between actions (evenly across remaining business hours)
 *   6. Report results back via API
 */

import { ApiClient } from "./api-client.js";
import { VoyagerClient } from "./voyager-client.js";
import type { ActionResult, ConnectionStatus, VoyagerConversation, VoyagerMessage } from "./voyager-client.js";
import { LinkedInBrowser } from "./linkedin-browser.js";
import {
  isWithinBusinessHours,
  msUntilBusinessHours,
  getActionDelay,
  getSpreadDelay,
  getRemainingBusinessMs,
  getLondonHoursMinutes,
  getPollDelay,
  sleep,
} from "./scheduler.js";
import { KeepaliveManager } from "./keepalive.js";

interface SenderConfig {
  id: string;
  name: string;
  linkedinProfileUrl: string | null;
  sessionData: string | null;
  sessionStatus: string;
  proxyUrl: string | null;
  status: string;
  healthStatus: string;
  dailyConnectionLimit: number;
  dailyMessageLimit: number;
  dailyProfileViewLimit: number;
}

interface ActionItem {
  id: string;
  personId: string;
  actionType: "connect" | "connection_request" | "message" | "profile_view" | "check_connection" | "withdraw_connection";
  messageBody: string | null;
  priority: number;
  linkedinUrl: string | null;
}

interface WorkerOptions {
  apiUrl: string;
  apiSecret: string;
  /** Workspace slugs to process. If empty, discovers from API. */
  workspaceSlugs: string[];
  /** Override schedule config per workspace */
  scheduleOverrides?: Record<string, { timezone?: string; startHour?: number; endHour?: number }>;
}

export class Worker {
  private api: ApiClient;
  private options: WorkerOptions;
  private running = false;
  private activeClients: Map<string, VoyagerClient> = new Map();
  /** Last successful session test per sender (epoch ms). */
  private lastSessionCheck: Map<string, number> = new Map();
  /** Auto-re-login attempt count per sender per day (reset daily). */
  private reloginAttempts: Map<string, { count: number; date: string }> = new Map();
  private static readonly SESSION_CHECK_INTERVAL_MS = 30 * 60 * 1000;
  private static readonly MAX_RELOGIN_PER_DAY = 2;
  private keepalive: KeepaliveManager;
  /** Tracks lastActivityAt per conversation to detect new activity. */
  private conversationCache: Map<string, number> = new Map();
  /** Counts poll cycles to skip conversation checks (check every 3rd cycle). */
  private pollCycleCount = 0;
  /** Per-sender backoff counter for conversation fetch failures. */
  private conversationBackoff: Map<string, number> = new Map();
  /** Cached workspace slugs from API discovery. */
  private cachedSlugs: string[] = [];
  /** Timestamp of last slug cache refresh. */
  private slugsCachedAt = 0;
  private static readonly SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
  /** Timestamp of last expired-session recovery attempt. */
  private lastRecoveryAttempt = 0;
  private static readonly RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
  /** Timestamp of last stuck-action recovery attempt. */
  private lastStuckRecoveryAt = 0;
  private static readonly STUCK_RECOVERY_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
  /** Timestamp of last connection polling run per workspace. */
  private lastConnectionPoll: Map<string, number> = new Map();
  /** Next connection poll interval per workspace (jittered). */
  private nextConnectionPollInterval: Map<string, number> = new Map();
  /** Last date (YYYY-MM-DD) daily planning was run per workspace. */
  private lastPlanDate: Map<string, string> = new Map();
  /** Last date (YYYY-MM-DD) mid-day top-up was run per workspace. */
  private lastTopupDate: Map<string, string> = new Map();

  constructor(options: WorkerOptions) {
    this.options = options;
    this.api = new ApiClient(options.apiUrl, options.apiSecret);
    this.keepalive = new KeepaliveManager(this.api);
  }

  /**
   * Start the worker loop.
   */
  async start(): Promise<void> {
    this.running = true;
    console.log("[Worker] Starting LinkedIn action worker");

    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        console.error("[Worker] Tick error:", error);
      }

      if (!this.running) break;

      // Wait before next poll
      const delay = getPollDelay();
      console.log(`[Worker] Next poll in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }

    console.log("[Worker] Worker stopped");
  }

  /**
   * Stop the worker gracefully.
   * VoyagerClient is stateless HTTP — no connections to close, just clear the map.
   */
  async stop(): Promise<void> {
    console.log("[Worker] Stopping...");
    this.running = false;
    this.activeClients.clear();
    this.lastSessionCheck.clear();
    this.conversationCache.clear();
    this.conversationBackoff.clear();
    this.lastConnectionPoll.clear();
    this.nextConnectionPollInterval.clear();
  }

  /**
   * Resolve workspace slugs — uses env var override or dynamic API discovery with caching.
   */
  private async getWorkspaceSlugs(): Promise<string[]> {
    if (this.options.workspaceSlugs.length > 0) {
      return this.options.workspaceSlugs;
    }

    const now = Date.now();
    if (this.cachedSlugs.length > 0 && now - this.slugsCachedAt < Worker.SLUG_CACHE_TTL_MS) {
      return this.cachedSlugs;
    }

    try {
      const slugs = await this.api.getWorkspaceSlugs();
      this.cachedSlugs = slugs;
      this.slugsCachedAt = now;
      console.log(`[Worker] Discovered ${slugs.length} active workspace(s): ${slugs.join(", ")}`);
      return slugs;
    } catch (err) {
      console.error("[Worker] Failed to fetch workspace slugs:", err);
      return this.cachedSlugs;
    }
  }

  /**
   * Attempt to recover senders whose sessions have already expired.
   * These senders are filtered out of processWorkspace() and never reach processSender(),
   * so this separate loop picks them up and attempts auto-re-login.
   * Throttled to run at most once every 10 minutes.
   */
  private async recoverExpiredSessions(slugs: string[]): Promise<void> {
    const now = Date.now();
    if (now - this.lastRecoveryAttempt < Worker.RECOVERY_INTERVAL_MS) {
      return;
    }
    this.lastRecoveryAttempt = now;

    console.log("[Worker] Running expired session recovery check...");

    let totalExpired = 0;
    let totalRecovered = 0;

    for (const slug of slugs) {
      if (!this.running) break;

      let senders: SenderConfig[];
      try {
        senders = await this.api.getSenders(slug);
      } catch (err) {
        console.error(`[Worker] Recovery: failed to get senders for ${slug}:`, err);
        continue;
      }

      const expiredSenders = senders.filter(
        (s) => s.status === "active" && s.healthStatus === "session_expired",
      );

      if (expiredSenders.length === 0) continue;

      totalExpired += expiredSenders.length;
      console.log(
        `[Worker] Recovery: found ${expiredSenders.length} expired session(s) in ${slug}: ${expiredSenders.map((s) => s.name).join(", ")}`,
      );

      for (const sender of expiredSenders) {
        if (!this.running) break;

        console.log(`[Worker] Recovery: attempting auto-re-login for ${sender.name}...`);

        // Clear any cached client for this sender (stale session)
        this.activeClients.delete(sender.id);
        this.lastSessionCheck.delete(sender.id);

        const success = await this.attemptAutoRelogin(sender);

        if (success) {
          totalRecovered++;
          console.log(`[Worker] Recovery: successfully recovered session for ${sender.name}`);
        } else {
          console.warn(`[Worker] Recovery: failed to recover session for ${sender.name}`);
        }
      }
    }

    if (totalExpired === 0) {
      console.log("[Worker] Recovery: no expired sessions found");
    } else {
      console.log(
        `[Worker] Recovery: ${totalRecovered}/${totalExpired} session(s) recovered`,
      );
    }
  }

  /**
   * Recover actions stuck in "running" status (from worker crashes).
   * Calls POST /api/linkedin/actions/recover, throttled to every 60 minutes.
   */
  private async recoverStuckActions(): Promise<void> {
    const now = Date.now();
    if (now - this.lastStuckRecoveryAt < Worker.STUCK_RECOVERY_INTERVAL_MS) {
      return;
    }
    this.lastStuckRecoveryAt = now;

    console.log("[Worker] Running stuck-action recovery...");
    try {
      const result = await this.api.recoverStuckActions();
      if (result.recovered > 0) {
        console.log(`[Worker] Recovered ${result.recovered} stuck action(s)`);
      } else {
        console.log("[Worker] No stuck actions found");
      }
    } catch (err) {
      console.error("[Worker] Stuck-action recovery failed:", err);
    }
  }

  /**
   * Single tick — process all senders.
   */
  private async tick(): Promise<void> {
    const slugs = await this.getWorkspaceSlugs();

    // Run keepalives BEFORE business hours check — keepalives fire 24/7
    for (const slug of slugs) {
      if (!this.running) break;
      try {
        const senders = await this.api.getSenders(slug);
        await this.keepalive.checkAndRunKeepalives(senders);
      } catch (err) {
        console.error(`[Worker] Keepalive check failed for ${slug}:`, err);
      }
    }

    // Recover expired sessions — runs 24/7, throttled to every 10 minutes
    await this.recoverExpiredSessions(slugs);

    // Recover stuck actions — throttled to every 60 minutes
    await this.recoverStuckActions();

    // Check business hours (default schedule) — actions only during business hours
    if (!isWithinBusinessHours()) {
      const waitMs = msUntilBusinessHours();
      const waitMin = Math.round(waitMs / 60_000);
      console.log(`[Worker] Outside business hours. Waiting ${waitMin} minutes.`);
      await sleep(Math.min(waitMs, 30 * 60_000)); // Cap at 30 min to re-check
      return;
    }

    // Daily planning + workspace processing — run all workspaces in PARALLEL.
    // Workspaces are independent (different LinkedIn accounts, different campaigns),
    // so a backlog on one sender must NOT block other workspaces from being polled.
    // Within processWorkspace, senders are also parallelised (see processWorkspace).
    // Within a single sender, action-level sleeps remain (LinkedIn safety).
    const today = new Date().toISOString().slice(0, 10);
    await Promise.all(
      slugs.map(async (slug) => {
        if (!this.running) return;

        // Daily plan
        const lastPlan = this.lastPlanDate.get(slug);
        if (lastPlan !== today) {
          console.log(`[Worker] Running daily plan for ${slug}...`);
          try {
            const result = await this.api.planDay(slug);
            console.log(
              `[Worker] Planned ${result.planned} actions for ${slug} across ${result.campaigns.length} campaign(s)`,
            );
            this.lastPlanDate.set(slug, today);
          } catch (err) {
            console.error(`[Worker] Daily plan failed for ${slug}:`, err);
          }
        }

        // Mid-day top-up for signal campaign leads added mid-day
        if (new Date().getUTCHours() >= 13) {
          const lastTopup = this.lastTopupDate.get(slug);
          if (lastTopup !== today) {
            console.log(`[Worker] Running mid-day top-up for ${slug}...`);
            try {
              const result = await this.api.planDay(slug);
              if (result.planned > 0) {
                console.log(
                  `[Worker] Mid-day top-up: ${result.planned} new actions for ${slug}`,
                );
              }
              this.lastTopupDate.set(slug, today);
            } catch (err) {
              console.error(`[Worker] Mid-day top-up failed for ${slug}:`, err);
            }
          }
        }

        if (!this.running) return;

        // Process this workspace (senders parallelised inside)
        try {
          await this.processWorkspace(slug);
        } catch (err) {
          console.error(`[Worker] processWorkspace failed for ${slug}:`, err);
        }
      }),
    );

    // -----------------------------------------------------------------------
    // LinkedIn conversation check — runs every 2nd cycle (~4 min)
    // -----------------------------------------------------------------------
    this.pollCycleCount++;
    if (this.pollCycleCount >= 2) {
      this.pollCycleCount = 0;
      console.log("[Worker] Checking LinkedIn conversations for new messages...");

      for (const slug of slugs) {
        if (!this.running) break;
        try {
          const senders = await this.api.getSenders(slug);
          const activeSenders = senders.filter(
            (s) =>
              s.status === "active" &&
              s.healthStatus !== "blocked" &&
              s.healthStatus !== "session_expired" &&
              s.sessionStatus === "active",
          );

          if (activeSenders.length > 0) {
            await this.checkConversations(activeSenders);
          }
        } catch (err) {
          console.error(`[Worker] Conversation check failed for ${slug}:`, err);
        }
      }
    }
  }

  /**
   * Process all active senders in a workspace.
   */
  private async processWorkspace(workspaceSlug: string): Promise<void> {
    let senders: SenderConfig[];
    try {
      senders = await this.api.getSenders(workspaceSlug);
    } catch (error) {
      console.error(`[Worker] Failed to get senders for ${workspaceSlug}:`, error);
      return;
    }

    const activeSenders = senders.filter(
      (s) =>
        s.status === "active" &&
        s.healthStatus !== "blocked" &&
        s.healthStatus !== "session_expired" &&
        s.sessionStatus === "active",
    );

    if (activeSenders.length === 0) {
      console.log(`[Worker] No active senders for ${workspaceSlug}`);
      return;
    }

    // Process senders in PARALLEL — each sender is a different LinkedIn account
    // with its own session, action queue, and rate limits. The intra-sender
    // spread-delay sleep remains (LinkedIn safety), so this is the right level
    // to parallelise: one sender's hour-long backlog must not stall its peers.
    //
    // Per-sender timeout (Finding 5.3): wrap each processSender in a 10-min
    // race so a single hung sender (network stall, deadlocked Voyager, etc.)
    // can't stall the whole workspace tick. The stuck-running sweeper
    // (Trigger.dev) will eventually clean up the orphaned action row.
    const PER_SENDER_TIMEOUT_MS = 10 * 60 * 1000;
    await Promise.all(
      activeSenders.map((sender) => {
        if (!this.running) return Promise.resolve();
        const senderWork = this.processSender(sender);
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<void>((resolve) => {
          timeoutId = setTimeout(() => {
            console.error(
              `[Worker] processSender timed out after ${PER_SENDER_TIMEOUT_MS / 60000}min for ${sender.name} — abandoning this tick`,
            );
            resolve();
          }, PER_SENDER_TIMEOUT_MS);
        });
        return Promise.race([senderWork, timeout])
          .catch((err) => {
            console.error(`[Worker] processSender failed for ${sender.name}:`, err);
          })
          .finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
          });
      }),
    );

    // After processing action queues, poll pending connections (throttled with jitter)
    await this.maybePollConnections(workspaceSlug, activeSenders);
  }

  /**
   * Check for new LinkedIn messages across all active senders and push to main app.
   * Runs every 3rd poll cycle (~5-6 minutes) to avoid hammering LinkedIn.
   * Only fetches full messages for conversations with new activity.
   */
  private async checkConversations(
    activeSenders: SenderConfig[],
  ): Promise<void> {
    for (const sender of activeSenders) {
      if (!this.running) break;

      // Check backoff — skip if sender is in backoff period
      const backoff = this.conversationBackoff.get(sender.id) ?? 0;
      if (backoff > 0) {
        this.conversationBackoff.set(sender.id, backoff - 1);
        continue;
      }

      let client: VoyagerClient;
      try {
        client = await this.getOrCreateVoyagerClient(sender);
      } catch {
        continue; // No cookies available — skip
      }

      try {
        const conversations = await client.fetchConversations(10);
        console.log(
          `[Worker] Fetched ${conversations.length} conversations for ${sender.name}`,
        );
        if (conversations.length === 0) continue;

        // Filter to conversations with new activity since last check
        const updatedConversations: Array<VoyagerConversation & { messages: VoyagerMessage[] }> = [];

        for (const conv of conversations) {
          const cachedActivity = this.conversationCache.get(conv.conversationId);

          if (cachedActivity && conv.lastActivityAt <= cachedActivity) {
            // Even if no new activity, push embedded messages to backfill any missing messages
            // (push endpoint deduplicates by eventUrn, so this is safe)
            if (conv.embeddedMessages && conv.embeddedMessages.length > 0) {
              updatedConversations.push({ ...conv, messages: conv.embeddedMessages });
            }
            continue;
          }

          // Update cache
          this.conversationCache.set(conv.conversationId, conv.lastActivityAt);

          // On first cache prime, process conversations with recent activity
          // (within last 2 hours) to catch replies that arrived before worker started
          if (cachedActivity === undefined) {
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            if (conv.lastActivityAt < twoHoursAgo) continue;
            console.log(
              `[Worker] First-time conversation ${conv.conversationId} has recent activity (${Math.round((Date.now() - conv.lastActivityAt) / 60000)}m ago), processing`,
            );
          }

          // Use embedded messages from GraphQL response if available, otherwise fetch separately
          let messages: VoyagerMessage[];
          if (conv.embeddedMessages && conv.embeddedMessages.length > 0) {
            messages = conv.embeddedMessages;
          } else {
            try {
              messages = await client.fetchMessages(conv.conversationId, 10);
            } catch (msgErr) {
              console.error(
                `[Worker] Failed to fetch messages for conversation ${conv.conversationId}:`,
                msgErr,
              );
              continue;
            }
          }
          if (messages.length > 0) {
            updatedConversations.push({ ...conv, messages });
          }
        }

        // ---- Link enrichment: fetch full messages for short bodies missing URLs ----
        for (const conv of updatedConversations) {
          const needsEnrichment = conv.messages.some(
            (m) => m.body.length < 30 && !m.body.match(/https?:\/\//)
          );
          if (!needsEnrichment) continue;

          try {
            const fullMessages = await client.fetchMessages(
              conv.conversationId,
              20,
              conv.entityUrn
            );
            if (fullMessages.length > 0) {
              const fullByUrn = new Map(fullMessages.map((m) => [m.eventUrn, m]));
              let enrichedCount = 0;
              for (let i = 0; i < conv.messages.length; i++) {
                const embedded = conv.messages[i];
                const full = fullByUrn.get(embedded.eventUrn);
                if (
                  full &&
                  full.body !== embedded.body &&
                  full.body.match(/https?:\/\//)
                ) {
                  conv.messages[i] = { ...embedded, body: full.body };
                  enrichedCount++;
                }
              }
              // Also add any messages from fetchMessages not present in embedded set
              const embeddedUrns = new Set(conv.messages.map((m) => m.eventUrn));
              for (const full of fullMessages) {
                if (!embeddedUrns.has(full.eventUrn) && full.body.match(/https?:\/\//)) {
                  conv.messages.push(full);
                  enrichedCount++;
                }
              }
              if (enrichedCount > 0) {
                console.log(
                  `[Worker] Link enrichment: found ${enrichedCount} additional messages for ${conv.participantName ?? conv.conversationId}`
                );
              }
            }
          } catch {
            // Best-effort — don't break the flow
          }
        }

        if (updatedConversations.length === 0) {
          console.log(`[Worker] Conversation check for ${sender.name}: no new activity`);
          continue;
        }

        // Push to main app
        try {
          const result = await this.api.pushConversations(sender.id, updatedConversations);
          console.log(
            `[Worker] Pushed conversations for ${sender.name}: ${result.conversationsProcessed} convs, ${result.newInboundMessages} new inbound`,
          );
        } catch (pushErr) {
          console.error(`[Worker] Failed to push conversations for ${sender.name}:`, pushErr);
        }

        this.conversationBackoff.delete(sender.id);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (/429|401|403/.test(errMsg)) {
          this.conversationBackoff.set(sender.id, 5); // ~15-25 min backoff
          console.warn(
            `[Worker] Conversation check rate limited/auth error for ${sender.name}, backing off 5 cycles`,
          );
        } else {
          this.conversationBackoff.set(sender.id, 2);
          console.error(`[Worker] Conversation check failed for ${sender.name}:`, errMsg);
        }
      }
    }
  }

  /**
   * Generate a jittered connection poll interval: 2h ± 30min (1.5h to 2.5h).
   * Randomised each cycle to avoid detection patterns.
   */
  private static getJitteredConnectionPollInterval(): number {
    return 7_200_000 + (Math.random() - 0.5) * 3_600_000;
  }

  /**
   * Throttle wrapper for pollConnections — only runs every ~2h with ±30min jitter
   * per workspace. Skips if not enough time has elapsed since last poll.
   */
  private async maybePollConnections(
    workspaceSlug: string,
    activeSenders: SenderConfig[],
  ): Promise<void> {
    const now = Date.now();
    const lastPoll = this.lastConnectionPoll.get(workspaceSlug) ?? 0;
    const interval = this.nextConnectionPollInterval.get(workspaceSlug)
      ?? Worker.getJitteredConnectionPollInterval();

    if (lastPoll > 0 && now - lastPoll < interval) {
      return; // Not yet time to poll
    }

    await this.pollConnections(workspaceSlug, activeSenders);

    this.lastConnectionPoll.set(workspaceSlug, now);
    // Generate a fresh jittered interval for the next cycle
    this.nextConnectionPollInterval.set(
      workspaceSlug,
      Worker.getJitteredConnectionPollInterval(),
    );
  }

  /**
   * Poll pending connections — check live status via VoyagerClient
   * and report results so follow-up messages can fire.
   */
  private async pollConnections(
    workspaceSlug: string,
    activeSenders: SenderConfig[],
  ): Promise<void> {
    let connections: {
      connectionId: string;
      senderId: string;
      personId: string;
      personLinkedinUrl: string;
    }[];

    try {
      connections = await this.api.getConnectionsToCheck(workspaceSlug);
    } catch (error) {
      console.error(
        `[Worker] Failed to get connections to check for ${workspaceSlug}:`,
        error,
      );
      return;
    }

    if (connections.length === 0) return;

    console.log(
      `[Worker] ${connections.length} pending connection(s) to check for ${workspaceSlug}`,
    );

    // Group by sender to reuse VoyagerClient instances
    const bySender = new Map<string, typeof connections>();
    for (const conn of connections) {
      const list = bySender.get(conn.senderId) ?? [];
      list.push(conn);
      bySender.set(conn.senderId, list);
    }

    for (const [senderId, senderConnections] of bySender) {
      if (!this.running) break;

      const senderConfig = activeSenders.find((s) => s.id === senderId);
      if (!senderConfig) continue;

      let client: VoyagerClient;
      try {
        client = await this.getOrCreateVoyagerClient(senderConfig);
      } catch (error) {
        console.error(
          `[Worker] Failed to get VoyagerClient for ${senderConfig.name} during connection polling:`,
          error,
        );
        continue;
      }

      for (const conn of senderConnections) {
        if (!this.running) break;

        try {
          const rawStatus: ConnectionStatus = await client.checkConnectionStatus(
            conn.personLinkedinUrl,
          );

          console.log(
            `[Worker] Connection ${conn.connectionId} (person ${conn.personId}): ${rawStatus}`,
          );

          // Report actionable statuses. "unknown" means the Voyager API couldn't
          // determine the status (e.g. profile private, transient error) — treat
          // it as "pending" so the record stays eligible for next-cycle checks
          // rather than silently disappearing from the live-check queue.
          if (rawStatus === "unknown" || rawStatus === "not_connectable") {
            console.warn(
              `[Worker] Connection ${conn.connectionId} returned status "${rawStatus}" — treating as pending (will retry next cycle)`,
            );
          }

          if (
            rawStatus === "connected" ||
            rawStatus === "pending" ||
            rawStatus === "not_connected" ||
            rawStatus === "unknown"
          ) {
            const reportedStatus =
              rawStatus === "unknown" ? "pending" : rawStatus;
            await this.api.reportConnectionResult(
              conn.connectionId,
              reportedStatus,
            );
          }
        } catch (error) {
          console.error(
            `[Worker] Failed to check connection ${conn.connectionId}:`,
            error,
          );
        }

        // Small delay between checks to avoid rate limiting
        if (this.running) {
          await sleep(3000 + Math.random() * 2000);
        }
      }
    }
  }

  /**
   * Process a single sender — fetch actions and execute them via VoyagerClient.
   */
  private async processSender(sender: SenderConfig): Promise<void> {
    console.log(`[Worker] Processing sender: ${sender.name} (${sender.id})`);

    // Get next batch of actions
    let actions: ActionItem[];
    try {
      actions = await this.api.getNextActions(sender.id, 5);
    } catch (error) {
      console.error(`[Worker] Failed to get actions for ${sender.name}:`, error);
      return;
    }

    if (actions.length === 0) {
      console.log(`[Worker] No pending actions for ${sender.name}`);
      return;
    }

    console.log(`[Worker] ${actions.length} actions for ${sender.name}`);

    // Get or create VoyagerClient for this sender
    let client: VoyagerClient;
    try {
      client = await this.getOrCreateVoyagerClient(sender);
    } catch (error) {
      console.error(`[Worker] Failed to create VoyagerClient for ${sender.name}:`, error);
      // Mark all actions as failed
      for (const action of actions) {
        await this.safeMarkFailed(action.id, `VoyagerClient creation failed: ${error}`);
      }
      return;
    }

    // Backfill linkedinProfileUrl if missing — uses existing Voyager session, no browser needed
    if (!sender.linkedinProfileUrl) {
      try {
        const profileUrl = await client.fetchOwnProfileUrl();
        if (profileUrl) {
          await this.api.updateSenderProfileUrl(sender.id, profileUrl);
          console.log(`[Worker] Backfilled linkedinProfileUrl for ${sender.name}: ${profileUrl}`);
        }
      } catch (err) {
        console.warn(`[Worker] Failed to backfill profile URL for ${sender.name}:`, err);
      }
    }

    // Session health check — only if 30+ minutes since last successful test
    const lastCheck = this.lastSessionCheck.get(sender.id) ?? 0;
    const now = Date.now();
    if (now - lastCheck > Worker.SESSION_CHECK_INTERVAL_MS) {
      console.log(`[Worker] Testing session health for ${sender.name}...`);
      const sessionResult = await client.testSession();

      if (sessionResult === "ok") {
        console.log(`[Worker] Session OK for ${sender.name}`);
        this.lastSessionCheck.set(sender.id, now);
      } else if (sessionResult === "rate_limited") {
        // Session might be fine — just back off, don't mark expired
        console.warn(`[Worker] Rate limited during health check for ${sender.name} — skipping this tick`);
        return;
      } else if (sessionResult === "network_error") {
        // Transient failure — don't mark expired, retry next tick
        console.warn(`[Worker] Network error during health check for ${sender.name} — will retry next tick`);
        return;
      } else {
        // "expired" or "checkpoint" — genuine session failure
        console.warn(`[Worker] Session health check: ${sessionResult} for ${sender.name}`);
        this.activeClients.delete(sender.id);
        this.lastSessionCheck.delete(sender.id);

        // Attempt auto-re-login if credentials are available
        const reloginSuccess = await this.attemptAutoRelogin(sender);

        if (reloginSuccess) {
          // Re-create client with fresh cookies
          try {
            client = await this.getOrCreateVoyagerClient(sender);
          } catch (error) {
            console.error(`[Worker] Failed to create client after re-login for ${sender.name}:`, error);
            for (const action of actions) {
              await this.safeMarkFailed(action.id, "session_expired");
            }
            return;
          }
        } else {
          // Re-login failed or not available — mark expired
          await this.api.updateSenderHealth(sender.id, "session_expired").catch((err) =>
            console.error(`[Worker] Failed to update sender health:`, err),
          );
          for (const action of actions) {
            await this.safeMarkFailed(action.id, "session_expired");
          }
          return;
        }
      }
    }

    // Fetch daily usage for spread delay calculation
    let usageData: Record<string, unknown> | null = null;
    try {
      usageData = await this.api.getUsage(sender.id);
    } catch (err) {
      console.warn(`[Worker] Failed to fetch usage for ${sender.name}, falling back to fixed delay:`, err);
    }

    // Execute each action with delays between them
    for (let i = 0; i < actions.length; i++) {
      if (!this.running) break;

      const action = actions[i];
      console.log(
        `[Worker] Executing ${action.actionType} (priority ${action.priority}) for person ${action.personId}`,
      );

      try {
        await this.executeAction(client, action, sender.id);
      } catch (error) {
        if (error instanceof Error && error.message === "RATE_LIMITED") {
          // Skip remaining actions for this sender — natural backoff until next poll
          break;
        }
        throw error;
      }

      // Spread delay between actions (not after the last one)
      if (i < actions.length - 1 && this.running) {
        const delay = this.calculateSpreadDelay(action.actionType, sender, usageData);
        const delaySec = Math.round(delay / 1000);
        const totalRemaining = this.getTotalDailyRemaining(usageData);
        // Pick remaining per type for log transparency. Same shape the
        // /api/linkedin/usage endpoint returns.
        const pick = (slot: unknown): number => {
          const s = slot as { remaining?: number } | undefined;
          return typeof s?.remaining === "number" ? Math.max(0, s.remaining) : 0;
        };
        const connRemaining = pick(usageData?.connections);
        const msgRemaining = pick(usageData?.messages);
        const pvRemaining = pick(usageData?.profileViews);
        const { hour, minute } = getLondonHoursMinutes();
        const hoursLeft = Math.max(0, 18 - (hour + minute / 60));
        console.log(
          `[Worker] ${sender.name}: spread ${connRemaining}c + ${msgRemaining}m + ${pvRemaining}pv (total ${totalRemaining}) over ${hoursLeft.toFixed(1)}h → ${delaySec}s`,
        );
        await sleep(delay);
      }
    }
  }

  /**
   * Attempt automatic re-login for a sender whose session has expired.
   * Uses stored credentials (linkedinEmail + encrypted password + optional TOTP).
   * Rate-limited to MAX_RELOGIN_PER_DAY attempts per sender per calendar day.
   *
   * Returns true if re-login succeeded and fresh cookies are available.
   */
  private async attemptAutoRelogin(sender: SenderConfig): Promise<boolean> {
    // Check daily re-login budget
    const today = new Date().toISOString().slice(0, 10);
    const attempts = this.reloginAttempts.get(sender.id);
    if (attempts && attempts.date === today && attempts.count >= Worker.MAX_RELOGIN_PER_DAY) {
      console.warn(`[Worker] Auto-re-login budget exhausted for ${sender.name} (${attempts.count}/${Worker.MAX_RELOGIN_PER_DAY} today)`);
      return false;
    }

    // Fetch decrypted credentials from API
    const creds = await this.api.getSenderCredentials(sender.id);
    if (!creds) {
      console.warn(`[Worker] No stored credentials for ${sender.name} — cannot auto-re-login`);
      return false;
    }

    // Track attempt
    const currentAttempts = attempts?.date === today ? attempts.count : 0;
    this.reloginAttempts.set(sender.id, { count: currentAttempts + 1, date: today });

    console.log(`[Worker] Session expired, attempting auto-re-login for ${sender.name} (attempt ${currentAttempts + 1}/${Worker.MAX_RELOGIN_PER_DAY})`);

    try {
      // Create browser and perform headless login
      const browser = new LinkedInBrowser([], sender.proxyUrl ?? undefined);
      browser.setSenderId(sender.id);

      const success = await browser.login(creds.email, creds.password, creds.totpSecret);

      if (success) {
        console.log(`[Worker] Auto-re-login successful for ${sender.name}`);

        // Extract and save Voyager cookies
        const voyagerCookies = browser.getVoyagerCookies();
        if (voyagerCookies) {
          await this.api.saveVoyagerCookies(sender.id, voyagerCookies);
          console.log(`[Worker] Saved fresh Voyager cookies for ${sender.name}`);
        } else {
          console.warn(`[Worker] Re-login succeeded but no Voyager cookies extracted for ${sender.name}`);
          await browser.close();
          return false;
        }

        // Persist LinkedIn profile URL if extracted during login
        const profileUrl = browser.getOwnProfileUrl();
        if (profileUrl) {
          await this.api.updateSenderProfileUrl(sender.id, profileUrl).catch((err) =>
            console.error(`[Worker] Failed to save profile URL after re-login:`, err),
          );
          console.log(`[Worker] Saved LinkedIn profile URL for ${sender.name}: ${profileUrl}`);
        }

        // Reset health to healthy
        await this.api.updateSenderHealth(sender.id, "healthy").catch((err) =>
          console.error(`[Worker] Failed to reset sender health after re-login:`, err),
        );

        await browser.close();
        return true;
      } else {
        console.error(`[Worker] Auto-re-login failed for ${sender.name} — login returned false`);
        await browser.close();
        return false;
      }
    } catch (error) {
      console.error(
        `[Worker] Auto-re-login error for ${sender.name}:`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Get or create a VoyagerClient for a sender.
   *
   * Tries to reuse an existing client instance within the same tick.
   * Falls back to loading stored Voyager cookies from the API, then env vars.
   * If no cookies are available from either source, throws — no browser fallback.
   */
  private async getOrCreateVoyagerClient(sender: SenderConfig): Promise<VoyagerClient> {
    // Reuse existing client if available
    const existing = this.activeClients.get(sender.id);
    if (existing) return existing;

    // Try to load stored Voyager cookies
    let cookies = await this.api.getVoyagerCookies(sender.id);

    if (!cookies) {
      // Fallback: check env vars (temporary workaround while Vercel deploy is blocked)
      const envLiAt = process.env.VOYAGER_LI_AT;
      const envJsessionId = process.env.VOYAGER_JSESSIONID;
      if (envLiAt && envJsessionId) {
        console.log(`[Worker] Using Voyager cookies from environment variables for ${sender.name}`);
        cookies = { liAt: envLiAt, jsessionId: envJsessionId };
      }
    }

    if (!cookies) {
      throw new Error(
        `No Voyager cookies available for sender ${sender.name} — seed cookies via Chrome extension or local browser`,
      );
    }

    const client = new VoyagerClient(cookies.liAt, cookies.jsessionId, sender.proxyUrl ?? undefined);
    this.activeClients.set(sender.id, client);
    return client;
  }

  /**
   * Sum the TOTAL remaining daily budget across every action type (connections,
   * messages, profile views). This is the correct denominator for spread math —
   * using a single action type or the current batch size causes front-loading
   * (see getSpreadDelay docstring for the 2026-04-14 incident).
   *
   * Withdrawals are excluded: they have no daily limit and run outside the
   * business-hour spread entirely.
   */
  private getTotalDailyRemaining(
    usageData: Record<string, unknown> | null,
  ): number {
    if (!usageData) return 0;
    const pickRemaining = (slot: unknown): number => {
      const s = slot as { remaining?: number } | undefined;
      return typeof s?.remaining === "number" ? Math.max(0, s.remaining) : 0;
    };
    return (
      pickRemaining(usageData.connections) +
      pickRemaining(usageData.messages) +
      pickRemaining(usageData.profileViews)
    );
  }

  /**
   * Calculate spread delay for an action, falling back to getActionDelay() if usage data unavailable.
   *
   * Uses the sender's TOTAL daily remaining budget (connections + messages +
   * views) — NOT the batch size — as the denominator, so N actions are spread
   * evenly across the remaining business window.
   */
  private calculateSpreadDelay(
    _actionType: string,
    _sender: SenderConfig,
    usageData: Record<string, unknown> | null,
  ): number {
    if (!usageData) return getActionDelay();

    const totalRemaining = this.getTotalDailyRemaining(usageData);
    const remainingMs = getRemainingBusinessMs();

    return getSpreadDelay(remainingMs, totalRemaining);
  }

  /**
   * Execute a single LinkedIn action via VoyagerClient.
   *
   * On auth/blocking errors, explicitly calls updateSenderHealth() to set sender
   * healthStatus — markFailed() only updates LinkedInAction.status, NOT Sender.healthStatus.
   */
  private async executeAction(
    client: VoyagerClient,
    action: ActionItem,
    senderId: string,
  ): Promise<void> {
    let result: ActionResult;

    // Validate that we have a LinkedIn URL
    if (!action.linkedinUrl) {
      await this.safeMarkFailed(action.id, "No LinkedIn URL for person");
      return;
    }

    const profileUrl = action.linkedinUrl;

    // Pre-send connection gate: verify the prospect is still connected before sending messages.
    // Only applies to message actions — connect and profile_view do not require an existing connection.
    if (action.actionType === "message" && action.personId) {
      try {
        const connStatus = await this.api.getConnectionStatusForPerson(action.personId);
        if (!connStatus || connStatus.status !== "connected") {
          const reason = connStatus
            ? `connection status is '${connStatus.status}'`
            : "no connection record found";
          console.warn(
            `[Worker] Skipping message action ${action.id} — ${reason} for person ${action.personId}`,
          );
          await this.safeMarkFailed(action.id, `not_connected: ${reason}`);
          return;
        }
      } catch (err) {
        // If the API call fails, log a warning but proceed with the action.
        // A transient network error should not block message delivery.
        console.warn(
          `[Worker] Connection status check failed for person ${action.personId}, proceeding with message:`,
          err,
        );
      }
    }

    try {
      switch (action.actionType) {
        case "profile_view":
          result = await client.viewProfile(profileUrl);
          break;

        case "connect":
        case "connection_request":
          result = await client.sendConnectionRequest(profileUrl);
          break;

        case "message":
          if (!action.messageBody) {
            result = { success: false, error: "No message body provided" };
            break;
          }
          result = await client.sendMessage(profileUrl, action.messageBody);
          break;

        case "check_connection": {
          const status = await client.checkConnectionStatus(profileUrl);
          result = {
            success: true,
            details: { connectionStatus: status },
          };
          break;
        }

        case "withdraw_connection":
          result = await client.withdrawConnection(profileUrl);
          break;

        default:
          result = { success: false, error: `Unknown action type: ${action.actionType}` };
      }
    } catch (error) {
      result = { success: false, error: String(error) };
    }

    // Report result back to API
    if (result.success) {
      console.log(`[Worker] Action ${action.id} completed successfully`);
      await this.safeMarkComplete(action.id, result.details);
    } else {
      console.error(`[Worker] Action ${action.id} failed: ${result.error}`);
      if (result.details) {
        console.error(`[Worker] Error details:`, JSON.stringify(result.details));
      }
      await this.safeMarkFailed(action.id, result.error ?? "Unknown error");

      // Handle auth/blocking errors — invalidate cached client and update sender health.
      // IMPORTANT: markFailed() only updates LinkedInAction.status — it does NOT update
      // Sender.healthStatus. We must call updateSenderHealth() explicitly.
      if (result.error === "rate_limited") {
        console.warn(`[Worker] Rate limited for sender ${senderId}, backing off`);
        this.activeClients.delete(senderId);
        throw new Error("RATE_LIMITED");
      }

      if (result.error === "auth_expired" || result.error === "unauthorized") {
        console.warn(`[Worker] Auth expired for sender ${senderId} — removing cached client`);
        this.activeClients.delete(senderId); // Will re-create with fresh cookies next tick
        await this.api.updateSenderHealth(senderId, "session_expired").catch((err) =>
          console.error(`[Worker] Failed to update sender health:`, err),
        );
      }

      if (result.error === "ip_blocked") {
        console.error(`[Worker] Sender ${senderId} IP blocked — updating health to blocked`);
        this.activeClients.delete(senderId);
        await this.api.updateSenderHealth(senderId, "blocked").catch((err) =>
          console.error(`[Worker] Failed to update sender health:`, err),
        );
      }

      if (result.error === "checkpoint_detected") {
        console.error(`[Worker] Sender ${senderId} checkpoint detected — updating health to blocked`);
        this.activeClients.delete(senderId);
        await this.api.updateSenderHealth(senderId, "blocked").catch((err) =>
          console.error(`[Worker] Failed to update sender health:`, err),
        );
      }
    }
  }

  /**
   * Safely mark an action as complete (swallow errors).
   */
  private async safeMarkComplete(
    actionId: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.api.markComplete(actionId, details);
    } catch (error) {
      console.error(`[Worker] Failed to report completion for ${actionId}:`, error);
    }
  }

  /**
   * Safely mark an action as failed (swallow errors).
   */
  private async safeMarkFailed(actionId: string, error: string): Promise<void> {
    try {
      await this.api.markFailed(actionId, error);
    } catch (err) {
      console.error(`[Worker] Failed to report failure for ${actionId}:`, err);
    }
  }
}
