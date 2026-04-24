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
import { VoyagerClient, VoyagerError } from "./voyager-client.js";
import type {
  ActionResult,
  ConnectionCheckResult,
  ConnectionStatus,
  VoyagerConversation,
  VoyagerMessage,
} from "./voyager-client.js";
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
import {
  HARD_SENDER_TIMEOUT_MS,
  PER_SENDER_TIMEOUT_MS,
  shouldExitSenderLoop,
} from "./sender-timeout.js";
import { KeepaliveManager } from "./keepalive.js";
import {
  buildWorkerHealthSnapshot,
  type WorkerHealthSnapshot,
  type WorkerPlannedSleepReason,
} from "./health.js";
import {
  clearSenderStateOverrides,
  getEffectiveSenderState as getSharedEffectiveSenderState,
  isSenderRecoverable as isSharedSenderRecoverable,
  isSenderRunnable as isSharedSenderRunnable,
  senderStateOverrides,
  syncSenderHealth as syncSharedSenderHealth,
  type SenderStateOverride,
} from "./sender-health-sync.js";

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
  campaignName?: string | null;
  linkedinUrl: string | null;
}

interface UsageBudgetSlot {
  sent?: number;
  limit?: number;
  remaining?: number;
}

interface SenderUsageBudget {
  connections?: UsageBudgetSlot;
  messages?: UsageBudgetSlot;
  profileViews?: UsageBudgetSlot;
}

interface WorkerOptions {
  apiUrl: string;
  apiSecret: string;
  /** Workspace slugs to process. If empty, discovers from API. */
  workspaceSlugs: string[];
  /** Override schedule config per workspace */
  scheduleOverrides?: Record<string, { timezone?: string; startHour?: number; endHour?: number }>;
}

interface PlannedBatchAction {
  action: ActionItem;
  originalIndex: number;
  plannedSpreadMs: number;
  exhaustedBudget: boolean;
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
  private static readonly CONNECTION_STATUS_BROWSER_FALLBACK_COOLDOWN_MS =
    30 * 60 * 1000;
  /** Timestamp of last connection polling run per workspace. */
  private lastConnectionPoll: Map<string, number> = new Map();
  /** Next connection poll interval per workspace (jittered). */
  private nextConnectionPollInterval: Map<string, number> = new Map();
  /** Last browser-fallback attempt per sender for connection status. */
  private lastConnectionBrowserFallback: Map<string, number> = new Map();
  /** Last date (YYYY-MM-DD) daily planning was run per workspace. */
  private lastPlanDate: Map<string, string> = new Map();
  /** Last date (YYYY-MM-DD) mid-day top-up was run per workspace. */
  private lastTopupDate: Map<string, string> = new Map();
  /** Currently claimed action IDs per sender for timeout cleanup. */
  private inFlightActionIdsBySender: Map<string, Set<string>> = new Map();
  /** Senders whose previous tick hit the hard backstop and must drain first. */
  private senderAborted: Set<string> = new Set();
  /** Shared process-local fail-closed sender state for worker + keepalive. */
  private senderStateOverrides = senderStateOverrides;
  /** Timestamp of the last top-level poll tick heartbeat. */
  private lastPollTickAt: number | null = null;
  /** Active intentional sleep windows tracked for health reporting. */
  private activeSleepWindows = new Map<
    number,
    { until: number; reason: WorkerPlannedSleepReason }
  >();
  private nextSleepWindowId = 1;
  /**
   * Only spend ~70% of the sender tick budget on claimed work so we have
   * room for action execution, cleanup, and guard refreshes.
   */
  private static readonly BATCH_EXECUTION_BUDGET_MS = Math.floor(
    PER_SENDER_TIMEOUT_MS * 0.7,
  );
  /**
   * Small per-action execution buffer used when deciding how much claimed
   * work can realistically fit inside one sender tick.
   */
  private static readonly BATCH_ACTION_EXECUTION_BUFFER_MS = 15_000;

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
      await this.sleepWithHealthTracking(delay, "between_ticks");
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
    this.lastConnectionBrowserFallback.clear();
    this.inFlightActionIdsBySender.clear();
    this.senderAborted.clear();
    clearSenderStateOverrides();
  }

  private getEffectiveSenderState(sender: SenderConfig): SenderStateOverride {
    return getSharedEffectiveSenderState(sender);
  }

  private isSenderRunnable(sender: SenderConfig): boolean {
    return isSharedSenderRunnable(sender);
  }

  private isSenderRecoverable(sender: SenderConfig): boolean {
    return isSharedSenderRecoverable(sender);
  }

  private async syncSenderHealth(
    sender: Pick<SenderConfig, "id" | "name" | "sessionStatus">,
    healthStatus: string,
    context: string,
  ): Promise<boolean> {
    return syncSharedSenderHealth(this.api, sender, healthStatus, context);
  }

  private async getExecutionGuard(
    sender: SenderConfig,
  ): Promise<{
    guardedSender: SenderConfig;
    pausedCampaignNames: Set<string>;
  } | null> {
    try {
      const guard = await this.api.getExecutionGuard(sender.id);
      if (!guard) {
        throw new Error("Empty execution guard response");
      }
      return {
        guardedSender: {
          ...sender,
          status: guard.sender.status,
          healthStatus: guard.sender.healthStatus,
          sessionStatus: guard.sender.sessionStatus,
        },
        pausedCampaignNames: new Set(guard.pausedCampaignNames),
      };
    } catch (error) {
      console.warn(
        `[Worker] Failed to refresh execution guard for ${sender.name}:`,
        error,
      );
      return null;
    }
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

  private async getBrowserForConnectionFallback(
    sender: SenderConfig,
  ): Promise<LinkedInBrowser | null> {
    const browser = new LinkedInBrowser([], sender.proxyUrl ?? undefined);
    browser.setSenderId(sender.id);

    const launched = await browser.launch();
    if (!launched.success || launched.needsLogin) {
      console.warn(
        `[Worker] Browser fallback session unavailable for ${sender.name}: success=${launched.success} needsLogin=${launched.needsLogin}`,
      );
      await browser.close().catch(() => {});
      return null;
    }

    return browser;
  }

  private async checkConnectionStatusWithFallback(
    voyagerResult: ConnectionCheckResult,
    sender: SenderConfig,
    profileUrl: string,
    browser?: LinkedInBrowser | null,
  ): Promise<ConnectionStatus> {
    if (!voyagerResult.shouldBrowserFallback) {
      return voyagerResult.status;
    }

    if (!browser) {
      const lastFallbackAt =
        this.lastConnectionBrowserFallback.get(sender.id) ?? 0;
      const now = Date.now();
      if (
        now - lastFallbackAt <
        Worker.CONNECTION_STATUS_BROWSER_FALLBACK_COOLDOWN_MS
      ) {
        console.warn(
          `[Worker] Browser fallback cooldown active for ${sender.name}; keeping ${profileUrl} as pending after Voyager 404`,
        );
        return voyagerResult.status;
      }
      console.warn(
        `[Worker] Browser fallback unavailable for ${sender.name}; keeping ${profileUrl} as pending after Voyager 404`,
      );
      return voyagerResult.status;
    }

    const now = Date.now();
    console.log(
      `[Worker] Voyager returned 404 for ${profileUrl}; falling back to browser connection check for ${sender.name}`,
    );
    const browserStatus = await browser.checkConnectionStatus(profileUrl);
    this.lastConnectionBrowserFallback.set(sender.id, now);
    console.log(
      `[Worker] Browser fallback connection status for ${profileUrl}: ${browserStatus}`,
    );
    return browserStatus;
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

      const expiredSenders = senders.filter((s) => this.isSenderRecoverable(s));

      if (expiredSenders.length === 0) continue;

      totalExpired += expiredSenders.length;
      console.log(
        `[Worker] Recovery: found ${expiredSenders.length} expired session(s) in ${slug}: ${expiredSenders.map((s) => s.name).join(", ")}`,
      );

      for (const sender of expiredSenders) {
        if (!this.running) break;

        console.log(
          `[Worker] Recovery: attempting session recovery for ${sender.name}...`,
        );

        // Clear any cached client for this sender (stale session)
        this.activeClients.delete(sender.id);
        this.lastSessionCheck.delete(sender.id);

        const success = (await this.ensureSenderSessionHealthy(sender)) !== null;

        if (success) {
          totalRecovered++;
          console.log(
            `[Worker] Recovery: successfully recovered session for ${sender.name}`,
          );
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
    this.markPollHeartbeat();
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

    // Connection polling — runs 24/7, NOT gated by business hours.
    // Polling is read-only (checks if connections have been accepted).
    // Detecting acceptances outside business hours lets follow-up messages
    // queue immediately and fire as soon as business hours resume.
    for (const slug of slugs) {
      if (!this.running) break;
      try {
        const senders = await this.api.getSenders(slug);
        const activeSenders = senders.filter((s) => this.isSenderRunnable(s));
        if (activeSenders.length > 0) {
          await this.maybePollConnections(slug, activeSenders);
        }
      } catch (err) {
        console.error(`[Worker] Connection poll failed for ${slug}:`, err);
      }
    }

    // Check business hours (default schedule) — actions only during business hours
    if (!isWithinBusinessHours()) {
      const waitMs = msUntilBusinessHours();
      const waitMin = Math.round(waitMs / 60_000);
      console.log(`[Worker] Outside business hours. Waiting ${waitMin} minutes.`);
      await this.sleepWithHealthTracking(
        Math.min(waitMs, 30 * 60_000),
        "outside_business_hours",
      ); // Cap at 30 min to re-check
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
          const activeSenders = senders.filter((s) => this.isSenderRunnable(s));

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

    const activeSenders = senders.filter((s) => this.isSenderRunnable(s));

    if (activeSenders.length === 0) {
      console.log(`[Worker] No active senders for ${workspaceSlug}`);
      return;
    }

    // Process senders in PARALLEL — each sender is a different LinkedIn account
    // with its own session, action queue, and rate limits. The intra-sender
    // spread-delay sleep remains (LinkedIn safety), so this is the right level
    // to parallelise: one sender's hour-long backlog must not stall its peers.
    //
    // Per-sender timeout (Finding 5.3): processSender now yields gracefully
    // around the 20-minute mark when the claimed batch would overrun, while a
    // later 25-minute hard backstop still protects the whole workspace tick
    // from a truly hung sender (network stall, deadlocked Voyager, etc.).
    await Promise.all(
      activeSenders.map((sender) => {
        if (!this.running) return Promise.resolve();
        if (this.senderAborted.has(sender.id)) {
          console.warn(
            `[Worker] Skipping ${sender.name} — prior hard-timeout cleanup still draining`,
          );
          return Promise.resolve();
        }
        const senderWork = this.processSender(sender).then(
          () => "completed" as const,
        );
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<"timeout">((resolve) => {
          timeoutId = setTimeout(() => {
            console.error(
              `[Worker] processSender hit hard timeout after ${HARD_SENDER_TIMEOUT_MS / 60000}min for ${sender.name} — abandoning this tick`,
            );
            resolve("timeout");
          }, HARD_SENDER_TIMEOUT_MS);
        });
        return Promise.race([senderWork, timeout])
          .then(async (result) => {
            if (result === "timeout") {
              await this.handleSenderTimeout(sender);
            }
          })
          .catch((err) => {
            console.error(`[Worker] processSender failed for ${sender.name}:`, err);
          })
          .finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
          });
      }),
    );

    // Connection polling moved to tick() — runs 24/7 before business hours gate.
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
        const healthyClient = await this.ensureSenderSessionHealthy(sender);
        if (!healthyClient) continue;
        client = healthyClient;
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
        if (err instanceof VoyagerError && (err.status === 401 || err.status === 403)) {
          await this.markSenderSessionExpired(
            sender,
            err.body.includes("checkpoint_detected") ? "blocked" : "session_expired",
            "conversation check auth failure",
          );
          continue;
        }

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

    console.log(
      `[Worker] maybePollConnections(${workspaceSlug}): lastPoll=${lastPoll} interval=${Math.round(interval / 1000)}s elapsed=${lastPoll > 0 ? Math.round((now - lastPoll) / 1000) : 'first-run'}s`,
    );

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
      let browserFallback: LinkedInBrowser | null | undefined;
      try {
        const healthyClient = await this.ensureSenderSessionHealthy(senderConfig);
        if (!healthyClient) continue;
        client = healthyClient;
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
          const voyagerPreview = await client.checkConnectionStatusDetailed(
            conn.personLinkedinUrl,
          );
          let rawStatus: ConnectionStatus;
          if (voyagerPreview.shouldBrowserFallback) {
            if (browserFallback === undefined) {
              browserFallback =
                await this.getBrowserForConnectionFallback(senderConfig);
            }
            rawStatus = await this.checkConnectionStatusWithFallback(
              voyagerPreview,
              senderConfig,
              conn.personLinkedinUrl,
              browserFallback,
            );
          } else {
            rawStatus = voyagerPreview.status;
          }

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

          if (
            error instanceof VoyagerError &&
            (error.status === 401 || error.status === 403)
          ) {
            await this.markSenderSessionExpired(
              senderConfig,
              error.body.includes("checkpoint_detected")
                ? "blocked"
                : "session_expired",
              "connection polling auth failure",
            );
            break;
          }
        }

        // Small delay between checks to avoid rate limiting
        if (this.running) {
          await sleep(3000 + Math.random() * 2000);
        }
      }

      if (browserFallback) {
        await browserFallback.close().catch((err) => {
          console.error(
            `[Worker] Failed to close browser fallback for ${senderConfig.name}:`,
            err,
          );
        });
      }
    }
  }

  /**
   * Process a single sender — fetch actions and execute them via VoyagerClient.
   */
  private async processSender(sender: SenderConfig): Promise<void> {
    console.log(`[Worker] Processing sender: ${sender.name} (${sender.id})`);
    const senderStartedAt = Date.now();

    try {
      // Proactively validate sender session health before claiming actions.
      // This ensures idle senders still get checked on the 30-minute cadence
      // instead of silently looping with dead cookies until keepalive happens.
      let client: VoyagerClient;
      try {
        const healthyClient = await this.ensureSenderSessionHealthy(sender);
        if (!healthyClient) return;
        client = healthyClient;
      } catch (error) {
        console.error(`[Worker] Failed to create VoyagerClient for ${sender.name}:`, error);
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

      if (this.senderAborted.has(sender.id)) {
        console.warn(
          `[Worker] ${sender.name}: hard-timeout cleanup fired before action claim completed — stopping sender work`,
        );
        return;
      }

      // Get next batch of actions only after session health is confirmed.
      let actions: ActionItem[];
      try {
        actions = await this.api.getNextActions(sender.id, 5);
      } catch (error) {
        console.error(`[Worker] Failed to get actions for ${sender.name}:`, error);
        return;
      }

      if (this.senderAborted.has(sender.id)) {
        if (actions.length > 0) {
          console.warn(
            `[Worker] ${sender.name}: releasing ${actions.length} stale claimed action(s) after hard-timeout cleanup`,
          );
          await Promise.all(
            actions.map((action) =>
              this.safeMarkFailedIfRunning(action.id, "graceful_yield"),
            ),
          );
        }
        return;
      }

      if (actions.length === 0) {
        console.log(`[Worker] No pending actions for ${sender.name}`);
        return;
      }

      console.log(`[Worker] ${actions.length} actions for ${sender.name}`);
      const inFlight = new Set(actions.map((action) => action.id));
      this.inFlightActionIdsBySender.set(sender.id, inFlight);
      const releaseClaimedActions = async (): Promise<void> => {
        await Promise.all(
          Array.from(inFlight).map((actionId) =>
            this.safeMarkFailedIfRunning(actionId, "graceful_yield"),
          ),
        );
      };

      let executionGuard = await this.getExecutionGuard(sender);
      if (!executionGuard) {
        console.warn(
          `[Worker] ${sender.name}: execution guard unavailable after claim — releasing ${inFlight.size} claimed action(s) for next tick`,
        );
        await releaseClaimedActions();
        return;
      }

      const refreshExecutionGuard = async (
        context: string,
      ): Promise<boolean> => {
        const refreshed = await this.getExecutionGuard(sender);
        if (!refreshed) {
          console.warn(
            `[Worker] ${sender.name}: execution guard unavailable ${context} — releasing ${inFlight.size} claimed action(s) for next tick`,
          );
          await releaseClaimedActions();
          return false;
        }
        executionGuard = refreshed;
        return true;
      };

      // Fetch daily usage for spread delay calculation. Refreshed before each
      // subsequent action so the delay follows the latest per-type counters.
      let usageData: SenderUsageBudget | null = null;
      try {
        usageData = await this.api.getUsage(sender.id);
      } catch (err) {
        console.warn(`[Worker] Failed to fetch usage for ${sender.name}, falling back to fixed delay:`, err);
      }

      const batchPlan = this.planClaimedBatch(actions, sender, usageData);
      if (batchPlan.deferredActions.length > 0) {
        console.log(
          `[Worker] ${sender.name}: claimed ${actions.length} actions but only ${batchPlan.actions.length} fit the sender tick budget (~${Math.round(batchPlan.totalExpectedMs / 1000)}s expected) — yielding ${batchPlan.deferredActions.length} early`,
        );
        await Promise.all(
          batchPlan.deferredActions.map((action) =>
            this.safeMarkFailedIfRunning(action.id, "graceful_yield"),
          ),
        );
        for (const action of batchPlan.deferredActions) {
          inFlight.delete(action.id);
        }
        if (inFlight.size === 0) {
          this.inFlightActionIdsBySender.delete(sender.id);
          return;
        }
      }
      actions = batchPlan.actions;

      // Execute each action with delays between them
      for (let i = 0; i < actions.length; i++) {
        if (!this.running) break;
        if (this.senderAborted.has(sender.id)) {
          console.warn(
            `[Worker] ${sender.name}: previous hard-timeout cleanup fired — stopping sender loop`,
          );
          break;
        }

        const elapsedMs = Date.now() - senderStartedAt;
        if (shouldExitSenderLoop({ elapsedMs })) {
          console.log(
            `[Worker] ${sender.name}: approaching timeout (${Math.round(elapsedMs / 1000)}s elapsed), processed ${i}/${actions.length} — releasing ${inFlight.size} claimed action(s) for next tick`,
          );
          await releaseClaimedActions();
          break;
        }

        const action = actions[i];
        const { guardedSender, pausedCampaignNames } = executionGuard;

        if (i > 0) {
          try {
            usageData = await this.api.getUsage(sender.id);
          } catch (err) {
            console.warn(
              `[Worker] Failed to refresh usage for ${sender.name} before ${action.actionType}, reusing prior budget snapshot:`,
              err,
            );
          }
        }

        const remainingForType = this.getRemainingBudgetForActionType(
          action.actionType,
          usageData,
        );
        if (remainingForType !== null && remainingForType <= 0) {
          console.warn(
            `[Worker] ${sender.name}: no ${action.actionType} budget remaining — yielding ${action.id} for the next eligible tick`,
          );
          await this.safeMarkFailedIfRunning(action.id, "graceful_yield");
          inFlight.delete(action.id);
          if (inFlight.size === 0) {
            this.inFlightActionIdsBySender.delete(sender.id);
          }
          continue;
        }

        if (!this.isSenderRunnable(guardedSender)) {
          const effectiveState = this.getEffectiveSenderState(guardedSender);
          console.warn(
            `[Worker] ${sender.name}: sender is now status=${guardedSender.status} ${effectiveState.healthStatus}/${effectiveState.sessionStatus} before executing ${action.id} — releasing ${inFlight.size} claimed action(s)`,
          );
          await releaseClaimedActions();
          break;
        }

        if (action.campaignName && pausedCampaignNames.has(action.campaignName)) {
          console.warn(
            `[Worker] ${sender.name}: campaign "${action.campaignName}" paused after claim — cancelling ${action.id} before execution`,
          );
          await this.safeMarkFailedIfRunning(action.id, "campaign_paused");
          inFlight.delete(action.id);
          if (inFlight.size === 0) {
            this.inFlightActionIdsBySender.delete(sender.id);
          }
          continue;
        }

        // Keep the existing inter-action pattern: the first claimed action
        // runs immediately, and subsequent actions sleep beforehand using the
        // next action's own remaining daily budget bucket.
        if (i > 0 && this.running) {
          const delay = this.calculateSpreadDelay(action.actionType, sender, usageData);
          const elapsedMs = Date.now() - senderStartedAt;
          if (shouldExitSenderLoop({ elapsedMs, nextDelayMs: delay })) {
            console.log(
              `[Worker] ${sender.name}: approaching timeout (${Math.round(elapsedMs / 1000)}s elapsed + ${Math.round(delay / 1000)}s spread), processed ${i}/${actions.length} — releasing ${inFlight.size} claimed action(s) for next tick`,
            );
            await releaseClaimedActions();
            break;
          }
          const delaySec = Math.round(delay / 1000);
          const totalRemaining = this.getTotalDailyRemaining(usageData);
          const typeRemainingLabel =
            remainingForType === null ? "n/a" : String(remainingForType);
          const { hour, minute } = getLondonHoursMinutes();
          const hoursLeft = Math.max(0, 18 - (hour + minute / 60));
          console.log(
            `[Worker] ${sender.name}: spread ${action.actionType} (${typeRemainingLabel} remaining; pooled ${totalRemaining}) over ${hoursLeft.toFixed(1)}h → ${delaySec}s`,
          );
          await this.sleepWithHealthTracking(delay, "spread_delay");
          if (!(await refreshExecutionGuard("after spread sleep"))) {
            break;
          }

          const refreshedEffectiveState = this.getEffectiveSenderState(
            executionGuard.guardedSender,
          );
          if (!this.isSenderRunnable(executionGuard.guardedSender)) {
            console.warn(
              `[Worker] ${sender.name}: sender is now status=${executionGuard.guardedSender.status} ${refreshedEffectiveState.healthStatus}/${refreshedEffectiveState.sessionStatus} after spread sleep — releasing ${inFlight.size} claimed action(s)`,
            );
            await releaseClaimedActions();
            break;
          }

          if (
            action.campaignName &&
            executionGuard.pausedCampaignNames.has(action.campaignName)
          ) {
            console.warn(
              `[Worker] ${sender.name}: campaign "${action.campaignName}" paused during spread sleep — cancelling ${action.id} before execution`,
            );
            await this.safeMarkFailedIfRunning(action.id, "campaign_paused");
            inFlight.delete(action.id);
            if (inFlight.size === 0) {
              this.inFlightActionIdsBySender.delete(sender.id);
            }
            continue;
          }
        }

        console.log(
          `[Worker] Executing ${action.actionType} (priority ${action.priority}) for person ${action.personId}`,
        );

        try {
          await this.executeAction(client, action, sender);
        } catch (error) {
          if (error instanceof Error && error.message === "RATE_LIMITED") {
            // Skip remaining actions for this sender — natural backoff until next poll
            break;
          }
          throw error;
        } finally {
          inFlight.delete(action.id);
          if (inFlight.size === 0) {
            this.inFlightActionIdsBySender.delete(sender.id);
          }
        }

        if (this.senderAborted.has(sender.id)) {
          console.warn(
            `[Worker] ${sender.name}: hard-timeout cleanup completed while finishing action ${i + 1}/${actions.length} — stopping sender loop`,
          );
          break;
        }

        if (!this.isSenderRunnable(sender)) {
          const effectiveState = this.getEffectiveSenderState(sender);
          console.warn(
            `[Worker] ${sender.name}: sender is now ${effectiveState.healthStatus}/${effectiveState.sessionStatus} — stopping sender loop`,
          );
          break;
        }
      }
    } finally {
      this.inFlightActionIdsBySender.delete(sender.id);
      this.senderAborted.delete(sender.id);
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
        await this.syncSenderHealth(
          sender,
          "healthy",
          "post-relogin health reset",
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
   * messages, profile views). Used only as a fallback when the worker cannot
   * determine a per-type budget bucket for the current action.
   *
   * Withdrawals are excluded: they have no daily limit and run outside the
   * business-hour spread entirely.
   */
  private getTotalDailyRemaining(
    usageData: SenderUsageBudget | null,
  ): number {
    if (!usageData) return 0;
    return (
      this.pickRemaining(usageData.connections) +
      this.pickRemaining(usageData.messages) +
      this.pickRemaining(usageData.profileViews)
    );
  }

  private pickRemaining(slot: UsageBudgetSlot | undefined): number {
    return typeof slot?.remaining === "number" ? Math.max(0, slot.remaining) : 0;
  }

  private getBudgetSlotForActionType(
    actionType: string,
    usageData: SenderUsageBudget | null,
  ): UsageBudgetSlot | null {
    if (!usageData) return null;

    switch (actionType) {
      case "connect":
      case "connection_request":
        return usageData.connections ?? null;
      case "message":
        return usageData.messages ?? null;
      case "profile_view":
      case "check_connection":
        return usageData.profileViews ?? null;
      default:
        return null;
    }
  }

  private getRemainingBudgetForActionType(
    actionType: string,
    usageData: SenderUsageBudget | null,
  ): number | null {
    const slot = this.getBudgetSlotForActionType(actionType, usageData);
    if (!slot) return null;
    if (typeof slot.limit !== "number") return null;
    return this.pickRemaining(slot);
  }

  private planClaimedBatch(
    actions: ActionItem[],
    sender: SenderConfig,
    usageData: SenderUsageBudget | null,
  ): {
    actions: ActionItem[];
    deferredActions: ActionItem[];
    totalExpectedMs: number;
  } {
    if (!usageData || actions.length <= 1) {
      return { actions, deferredActions: [], totalExpectedMs: 0 };
    }

    const planned: PlannedBatchAction[] = actions.map((action, originalIndex) => {
      const remainingForType = this.getRemainingBudgetForActionType(
        action.actionType,
        usageData,
      );
      const exhaustedBudget =
        remainingForType !== null && remainingForType <= 0;
      return {
        action,
        originalIndex,
        plannedSpreadMs: exhaustedBudget
          ? Number.POSITIVE_INFINITY
          : this.calculateSpreadDelay(action.actionType, sender, usageData),
        exhaustedBudget,
      };
    });

    planned.sort((a, b) => {
      if (a.exhaustedBudget !== b.exhaustedBudget) {
        return a.exhaustedBudget ? 1 : -1;
      }
      if (a.plannedSpreadMs !== b.plannedSpreadMs) {
        return a.plannedSpreadMs - b.plannedSpreadMs;
      }
      return a.originalIndex - b.originalIndex;
    });

    const kept: ActionItem[] = [];
    const deferred: ActionItem[] = [];
    let totalExpectedMs = 0;

    for (const plannedAction of planned) {
      if (plannedAction.exhaustedBudget) {
        deferred.push(plannedAction.action);
        continue;
      }

      const preDelayMs = kept.length === 0 ? 0 : plannedAction.plannedSpreadMs;
      const actionBudgetMs =
        preDelayMs + Worker.BATCH_ACTION_EXECUTION_BUFFER_MS;

      if (
        kept.length > 0 &&
        totalExpectedMs + actionBudgetMs >
          Worker.BATCH_EXECUTION_BUDGET_MS
      ) {
        deferred.push(plannedAction.action);
        continue;
      }

      kept.push(plannedAction.action);
      totalExpectedMs += actionBudgetMs;
    }

    return {
      actions: kept,
      deferredActions: deferred,
      totalExpectedMs,
    };
  }

  /**
   * Calculate spread delay for an action, falling back to getActionDelay() if usage data unavailable.
   *
   * Uses the action type's OWN remaining daily budget (connections OR messages
   * OR views) so low-volume connection caps are not artificially accelerated by
   * spare message/profile-view capacity. Types without a configured budget
   * bucket (e.g. withdrawals) fall back to the pooled denominator.
   */
  private calculateSpreadDelay(
    actionType: string,
    _sender: SenderConfig,
    usageData: SenderUsageBudget | null,
  ): number {
    if (!usageData) return getActionDelay();

    const remainingMs = getRemainingBusinessMs();
    const remainingForType = this.getRemainingBudgetForActionType(
      actionType,
      usageData,
    );
    if (remainingForType !== null) {
      return getSpreadDelay(remainingMs, remainingForType);
    }

    const totalRemaining = this.getTotalDailyRemaining(usageData);
    return getSpreadDelay(remainingMs, totalRemaining);
  }

  getHealthSnapshot(now: Date = new Date()): WorkerHealthSnapshot {
    let activeSleepUntil: number | null = null;
    let activeSleepReason: WorkerPlannedSleepReason | null = null;

    for (const sleepWindow of this.activeSleepWindows.values()) {
      if (sleepWindow.until <= now.getTime()) {
        continue;
      }
      if (activeSleepUntil === null || sleepWindow.until > activeSleepUntil) {
        activeSleepUntil = sleepWindow.until;
        activeSleepReason = sleepWindow.reason;
      }
    }

    return buildWorkerHealthSnapshot(
      {
        lastPollTickAt: this.lastPollTickAt,
        activeSleepUntil,
        activeSleepReason,
      },
      { now },
    );
  }

  private markPollHeartbeat(): void {
    this.lastPollTickAt = Date.now();
  }

  private async sleepWithHealthTracking(
    ms: number,
    reason: WorkerPlannedSleepReason,
  ): Promise<void> {
    const sleepId = this.nextSleepWindowId++;
    this.activeSleepWindows.set(sleepId, {
      until: Date.now() + ms,
      reason,
    });

    try {
      await sleep(ms);
    } finally {
      this.activeSleepWindows.delete(sleepId);
    }
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
    sender: Pick<SenderConfig, "id" | "name" | "sessionStatus">,
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
        const connStatus = await this.api.getConnectionStatusForPerson(
          sender.id,
          action.personId,
        );
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
          // Note: browser fallback disabled in executeAction — no SenderConfig available,
          // only senderId. Use plain Voyager check; connection polling handles fallback.
          const checkResult = await client.checkConnectionStatusDetailed(profileUrl);
          const status = checkResult.status;
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
        console.warn(`[Worker] Rate limited for sender ${sender.id}, backing off`);
        this.activeClients.delete(sender.id);
        throw new Error("RATE_LIMITED");
      }

      if (result.error === "auth_expired" || result.error === "unauthorized") {
        console.warn(
          `[Worker] Auth expired for sender ${sender.id} — removing cached client`,
        );
        this.activeClients.delete(sender.id); // Will re-create with fresh cookies next tick
        await this.syncSenderHealth(
          sender,
          "session_expired",
          "action auth failure",
        );
      }

      if (result.error === "ip_blocked") {
        console.error(
          `[Worker] Sender ${sender.id} IP blocked — updating health to blocked`,
        );
        this.activeClients.delete(sender.id);
        await this.syncSenderHealth(sender, "blocked", "action ip block");
      }

      if (result.error === "checkpoint_detected") {
        console.error(
          `[Worker] Sender ${sender.id} checkpoint detected — updating health to blocked`,
        );
        this.activeClients.delete(sender.id);
        await this.syncSenderHealth(
          sender,
          "blocked",
          "action checkpoint detection",
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

  private async safeMarkFailedIfRunning(
    actionId: string,
    error: string,
  ): Promise<void> {
    try {
      await this.api.markFailedIfRunning(actionId, error);
    } catch (err) {
      console.error(
        `[Worker] Failed to report timeout failure for ${actionId}:`,
        err,
      );
    }
  }

  private async markSenderSessionExpired(
    sender: SenderConfig,
    status: "session_expired" | "blocked",
    context: string,
  ): Promise<void> {
    this.activeClients.delete(sender.id);
    this.lastSessionCheck.delete(sender.id);
    console.warn(
      `[Worker] ${context} for ${sender.name} — marking ${status}`,
    );
    await this.syncSenderHealth(sender, status, context);
  }

  private async ensureSenderSessionHealthy(
    sender: SenderConfig,
  ): Promise<VoyagerClient | null> {
    let client: VoyagerClient;
    try {
      client = await this.getOrCreateVoyagerClient(sender);
    } catch (error) {
      console.error(
        `[Worker] Failed to create VoyagerClient for ${sender.name}:`,
        error,
      );
      return null;
    }

    const lastCheck = this.lastSessionCheck.get(sender.id) ?? 0;
    const now = Date.now();
    if (now - lastCheck <= Worker.SESSION_CHECK_INTERVAL_MS) {
      return client;
    }

    console.log(`[Worker] Testing session health for ${sender.name}...`);
    const sessionResult = await client.testSession();

    if (sessionResult === "ok") {
      console.log(`[Worker] Session OK for ${sender.name}`);
      this.lastSessionCheck.set(sender.id, now);
      const effectiveState = this.getEffectiveSenderState(sender);
      if (
        effectiveState.healthStatus === "session_expired" ||
        effectiveState.healthStatus === "blocked"
      ) {
        await this.syncSenderHealth(
          sender,
          "healthy",
          "session health check recovery",
        );
      }
      return client;
    }

    if (sessionResult === "rate_limited") {
      console.warn(
        `[Worker] Rate limited during health check for ${sender.name} — skipping this tick`,
      );
      return null;
    }

    if (sessionResult === "network_error") {
      console.warn(
        `[Worker] Network error during health check for ${sender.name} — will retry next tick`,
      );
      return null;
    }

    console.warn(`[Worker] Session health check: ${sessionResult} for ${sender.name}`);
    this.activeClients.delete(sender.id);
    this.lastSessionCheck.delete(sender.id);

    if (sessionResult === "checkpoint") {
      await this.markSenderSessionExpired(
        sender,
        "blocked",
        "checkpoint during health check",
      );
      return null;
    }

    const reloginSuccess = await this.attemptAutoRelogin(sender);
    if (!reloginSuccess) {
      await this.markSenderSessionExpired(
        sender,
        "session_expired",
        "health check auth failure",
      );
      return null;
    }

    try {
      client = await this.getOrCreateVoyagerClient(sender);
      this.lastSessionCheck.set(sender.id, now);
      return client;
    } catch (error) {
      console.error(
        `[Worker] Failed to create client after re-login for ${sender.name}:`,
        error,
      );
      await this.markSenderSessionExpired(
        sender,
        "session_expired",
        "post-relogin client bootstrap failure",
      );
      return null;
    }
  }

  private async handleSenderTimeout(sender: SenderConfig): Promise<void> {
    this.senderAborted.add(sender.id);

    const inFlight = Array.from(
      this.inFlightActionIdsBySender.get(sender.id) ?? [],
    );

    this.activeClients.delete(sender.id);
    this.lastSessionCheck.delete(sender.id);

    if (inFlight.length === 0) {
      return;
    }

    console.error(
      `[Worker] Hard-timing out ${inFlight.length} in-flight action(s) for ${sender.name}: ${inFlight.join(", ")}`,
    );
    await Promise.all(
      inFlight.map((actionId) =>
        this.safeMarkFailedIfRunning(actionId, "hard_backstop_abort"),
      ),
    );
    this.inFlightActionIdsBySender.delete(sender.id);
  }
}
