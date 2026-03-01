/**
 * Worker — polls the queue and executes LinkedIn actions.
 *
 * For each active sender:
 *   1. Check business hours
 *   2. Poll /api/linkedin/actions/next
 *   3. Launch browser with sender's session + proxy
 *   4. Execute actions in priority order
 *   5. Random delays between actions (30-90s)
 *   6. Report results back via API
 *   7. Piggyback connection status checks
 */

import { ApiClient } from "./api-client.js";
import { LinkedInBrowser } from "./linkedin-browser.js";
import type { ActionResult } from "./linkedin-browser.js";
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
  private activeBrowsers: Map<string, LinkedInBrowser> = new Map();

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
   */
  async stop(): Promise<void> {
    console.log("[Worker] Stopping...");
    this.running = false;

    // Close all active browser sessions
    for (const [senderId, browser] of this.activeBrowsers) {
      try {
        console.log(`[Worker] Closing browser for sender ${senderId}`);
        await browser.close();
      } catch (error) {
        console.error(`[Worker] Error closing browser for ${senderId}:`, error);
      }
    }
    this.activeBrowsers.clear();
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
   * Process a single sender — fetch actions and execute them.
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

    // Get or launch browser for this sender
    let browser: LinkedInBrowser;
    try {
      browser = await this.getOrLaunchBrowser(sender);
    } catch (error) {
      console.error(`[Worker] Failed to launch browser for ${sender.name}:`, error);
      // Mark all actions as failed
      for (const action of actions) {
        await this.safeMarkFailed(action.id, `Browser launch failed: ${error}`);
      }
      return;
    }

    // Check for CAPTCHA or restriction before executing
    try {
      if (await browser.checkForCaptcha()) {
        console.error(`[Worker] CAPTCHA detected for ${sender.name} — pausing`);
        for (const action of actions) {
          await this.safeMarkFailed(action.id, "CAPTCHA detected");
        }
        await this.closeBrowser(sender.id);
        return;
      }

      if (await browser.checkForRestriction()) {
        console.error(`[Worker] Restriction detected for ${sender.name} — pausing`);
        for (const action of actions) {
          await this.safeMarkFailed(action.id, "LinkedIn restriction detected");
        }
        await this.closeBrowser(sender.id);
        return;
      }
    } catch (error) {
      console.error(`[Worker] Health check error for ${sender.name}:`, error);
    }

    // Execute each action with delays between them
    for (let i = 0; i < actions.length; i++) {
      if (!this.running) break;

      const action = actions[i];
      console.log(
        `[Worker] Executing ${action.actionType} (priority ${action.priority}) for person ${action.personId}`,
      );

      await this.executeAction(browser, action);

      // Random delay between actions (not after the last one)
      if (i < actions.length - 1 && this.running) {
        const delay = getActionDelay();
        console.log(`[Worker] Waiting ${Math.round(delay / 1000)}s before next action`);
        await sleep(delay);
      }
    }
  }

  /**
   * Execute a single LinkedIn action.
   */
  private async executeAction(browser: LinkedInBrowser, action: ActionItem): Promise<void> {
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
          result = await browser.viewProfile(profileUrl);
          break;

        case "connect":
          result = await browser.sendConnectionRequest(profileUrl);
          break;

        case "message":
          if (!action.messageBody) {
            result = { success: false, error: "No message body provided" };
            break;
          }
          result = await browser.sendMessage(profileUrl, action.messageBody);
          break;

        case "check_connection": {
          const status = await browser.checkConnectionStatus(profileUrl);
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
    }
  }

  /**
   * Get or launch a browser session for a sender.
   * Reuses existing sessions within the same tick.
   *
   * With agent-browser, sessions are isolated per sender via --session flag.
   * Cookies/state are managed internally by agent-browser's named sessions.
   *
   * If the session is expired, auto-login is attempted using stored credentials.
   * The key insight: login() runs on the SAME daemon that launch() started,
   * so the session persists across login → action execution.
   */
  private async getOrLaunchBrowser(sender: SenderConfig): Promise<LinkedInBrowser> {
    // Reuse existing browser if available
    const existing = this.activeBrowsers.get(sender.id);
    if (existing) return existing;

    // agent-browser manages session state internally via named sessions.
    // We pass an empty cookies array for API compatibility — the session
    // name (set via setSenderId) is what actually isolates state.
    const browser = new LinkedInBrowser([], sender.proxyUrl ?? undefined);
    browser.setSenderId(sender.id);
    const launchResult = await browser.launch();

    if (launchResult.success) {
      this.activeBrowsers.set(sender.id, browser);
      return browser;
    }

    // Session expired — attempt auto-login on the same daemon
    if (launchResult.needsLogin) {
      console.log(`[Worker] Session expired for ${sender.name} — attempting auto-login`);

      const credentials = await this.api.getSenderCredentials(sender.id);
      if (!credentials) {
        await browser.close();
        throw new Error("Session expired and no stored credentials for auto-login");
      }

      const loginSuccess = await browser.login(
        credentials.email,
        credentials.password,
        credentials.totpSecret,
        { daemonAlreadyRunning: true },
      );

      if (!loginSuccess) {
        await browser.close();
        throw new Error("Session expired and auto-login failed");
      }

      console.log(`[Worker] Auto-login successful for ${sender.name}`);
      this.activeBrowsers.set(sender.id, browser);
      return browser;
    }

    // Launch failed for non-session reasons (network error, daemon crash, etc.)
    await browser.close();
    throw new Error("Browser launch failed");
  }

  /**
   * Close and remove a browser session for a sender.
   */
  private async closeBrowser(senderId: string): Promise<void> {
    const browser = this.activeBrowsers.get(senderId);
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error(`[Worker] Error closing browser for ${senderId}:`, error);
      }
      this.activeBrowsers.delete(senderId);
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
