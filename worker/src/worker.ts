/**
 * Worker — polls the queue and executes LinkedIn actions.
 *
 * For each active sender:
 *   1. Check business hours
 *   2. Poll /api/linkedin/actions/next
 *   3. Load Voyager cookies from API (or env vars as fallback)
 *   4. Create VoyagerClient per sender and execute actions via HTTP
 *   5. Random delays between actions (30-90s)
 *   6. Report results back via API
 */

import { ApiClient } from "./api-client.js";
import { VoyagerClient } from "./voyager-client.js";
import type { ActionResult, ConnectionStatus } from "./voyager-client.js";
import { LinkedInBrowser } from "./linkedin-browser.js";
import {
  isWithinBusinessHours,
  msUntilBusinessHours,
  getActionDelay,
  getPollDelay,
  sleep,
} from "./scheduler.js";

interface SenderConfig {
  id: string;
  name: string;
  sessionData: string | null;
  sessionStatus: string;
  proxyUrl: string | null;
  status: string;
  healthStatus: string;
}

interface ActionItem {
  id: string;
  personId: string;
  actionType: "connect" | "message" | "profile_view" | "check_connection";
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

  constructor(options: WorkerOptions) {
    this.options = options;
    this.api = new ApiClient(options.apiUrl, options.apiSecret);
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
  }

  /**
   * Single tick — process all senders.
   */
  private async tick(): Promise<void> {
    // Check business hours (default schedule)
    if (!isWithinBusinessHours()) {
      const waitMs = msUntilBusinessHours();
      const waitMin = Math.round(waitMs / 60_000);
      console.log(`[Worker] Outside business hours. Waiting ${waitMin} minutes.`);
      await sleep(Math.min(waitMs, 30 * 60_000)); // Cap at 30 min to re-check
      return;
    }

    // Process each workspace
    for (const slug of this.options.workspaceSlugs) {
      if (!this.running) break;
      await this.processWorkspace(slug);
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

    for (const sender of activeSenders) {
      if (!this.running) break;
      await this.processSender(sender);
    }

    // After processing action queues, poll pending connections
    await this.pollConnections(workspaceSlug, activeSenders);
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

          // Only report actionable statuses — skip "unknown" and "not_connectable"
          if (
            rawStatus === "connected" ||
            rawStatus === "pending" ||
            rawStatus === "not_connected"
          ) {
            await this.api.reportConnectionResult(conn.connectionId, rawStatus);
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

      // Random delay between actions (not after the last one)
      if (i < actions.length - 1 && this.running) {
        const delay = getActionDelay();
        console.log(`[Worker] Waiting ${Math.round(delay / 1000)}s before next action`);
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

    try {
      switch (action.actionType) {
        case "profile_view":
          result = await client.viewProfile(profileUrl);
          break;

        case "connect":
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
