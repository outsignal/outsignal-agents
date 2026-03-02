/**
 * Worker — polls the queue and executes LinkedIn actions.
 *
 * For each active sender:
 *   1. Check business hours
 *   2. Poll /api/linkedin/actions/next
 *   3. Load Voyager cookies from API (or extract via browser login if missing)
 *   4. Create VoyagerClient per sender and execute actions via HTTP
 *   5. Random delays between actions (30-90s)
 *   6. Report results back via API
 *   7. LinkedInBrowser is only used for login + cookie extraction (no action execution)
 */

import { ApiClient } from "./api-client.js";
import { LinkedInBrowser } from "./linkedin-browser.js";
import { VoyagerClient } from "./voyager-client.js";
import type { ActionResult } from "./voyager-client.js";
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
   * Get or create a VoyagerClient for a sender.
   *
   * Tries to reuse an existing client instance within the same tick.
   * Falls back to loading stored Voyager cookies from the API.
   * If no cookies are stored, launches a browser for login + cookie extraction.
   */
  private async getOrCreateVoyagerClient(sender: SenderConfig): Promise<VoyagerClient> {
    // Reuse existing client if available
    const existing = this.activeClients.get(sender.id);
    if (existing) return existing;

    // Try to load stored Voyager cookies
    let cookies = await this.api.getVoyagerCookies(sender.id);

    if (!cookies) {
      // No stored cookies — need to login via browser and extract
      console.log(`[Worker] No Voyager cookies for ${sender.name} — launching browser for login`);
      cookies = await this.loginAndExtractCookies(sender);
      if (!cookies) {
        throw new Error("Failed to obtain Voyager cookies via browser login");
      }
    }

    const client = new VoyagerClient(cookies.liAt, cookies.jsessionId, sender.proxyUrl ?? undefined);
    this.activeClients.set(sender.id, client);
    return client;
  }

  /**
   * Login via LinkedInBrowser and extract Voyager cookies.
   * LinkedInBrowser is ONLY used here — all action execution goes through VoyagerClient.
   *
   * After successful login, the extracted li_at + JSESSIONID are saved to the API
   * for future use (no browser launch needed on next tick).
   */
  private async loginAndExtractCookies(
    sender: SenderConfig,
  ): Promise<{ liAt: string; jsessionId: string } | null> {
    const browser = new LinkedInBrowser([], sender.proxyUrl ?? undefined);
    browser.setSenderId(sender.id);

    try {
      const launchResult = await browser.launch();

      if (launchResult.needsLogin) {
        const credentials = await this.api.getSenderCredentials(sender.id);
        if (!credentials) {
          console.error(`[Worker] No credentials for ${sender.name} — cannot login`);
          return null;
        }

        const loginSuccess = await browser.login(
          credentials.email,
          credentials.password,
          credentials.totpSecret,
          { daemonAlreadyRunning: true },
        );

        if (!loginSuccess) {
          console.error(`[Worker] Login failed for ${sender.name}`);
          return null;
        }
      }

      // Extract Voyager cookies from the browser session
      const cookies = await browser.extractVoyagerCookies();
      if (cookies) {
        // Persist cookies to API for future use
        await this.api.saveVoyagerCookies(sender.id, cookies);
        console.log(`[Worker] Voyager cookies extracted and saved for ${sender.name}`);
      }

      return cookies;
    } finally {
      await browser.close();
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
