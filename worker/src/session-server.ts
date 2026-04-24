/**
 * Session Server — HTTP server for LinkedIn login sessions.
 *
 * Provides:
 * - REST endpoints to start headless login sessions
 * - Health check endpoint
 *
 * With agent-browser, login is fully headless via the LinkedInBrowser.login()
 * method. The VNC streaming approach is no longer needed — agent-browser
 * handles browser lifecycle and session persistence internally.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { LinkedInBrowser } from "./linkedin-browser.js";
import { ApiClient } from "./api-client.js";
import { VoyagerClient, VoyagerError } from "./voyager-client.js";
import {
  buildWorkerHealthSnapshot,
  type WorkerHealthSnapshot,
} from "./health.js";

interface SessionState {
  senderId: string;
  status: "logging_in" | "logged_in" | "failed";
  error?: string;
}

export class SessionServer {
  private api: ApiClient;
  private apiSecret: string;
  private getWorkerHealth: () => WorkerHealthSnapshot;
  private sessionState: SessionState | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;

  constructor(
    api: ApiClient,
    apiSecret: string,
    getWorkerHealth: (() => WorkerHealthSnapshot) | null = null,
  ) {
    this.api = api;
    this.apiSecret = apiSecret;
    this.getWorkerHealth =
      getWorkerHealth ??
      (() =>
        buildWorkerHealthSnapshot({
          lastPollTickAt: null,
          activeSleepUntil: null,
          activeSleepReason: null,
        }));
  }

  /**
   * Start the HTTP server on the given port.
   */
  start(port: number): void {
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));

    this.httpServer.listen(port, () => {
      console.log(`[SessionServer] Listening on port ${port}`);
    });
  }

  /**
   * Stop the server and clean up.
   */
  async stop(): Promise<void> {
    this.sessionState = null;
    this.httpServer?.close();
  }

  /**
   * Handle HTTP requests.
   */
  private async handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (path === "/sessions/login" && req.method === "POST") {
        await this.handleHeadlessLogin(req, res);
        return;
      }

      if (path === "/sessions/status" && req.method === "GET") {
        this.handleSessionStatus(res);
        return;
      }

      if (path === "/health" && req.method === "GET") {
        // Return honest health status including session info
        const hasActiveSession = this.sessionState?.status === "logged_in";
        const workerHealth = this.getWorkerHealth();
        this.jsonResponse(res, 200, {
          ok: true,
          workerHealthy: workerHealth.workerHealthy,
          lastPollTickAt: workerHealth.lastPollTickAt,
          pollAgeSeconds: workerHealth.pollAgeSeconds,
          businessHoursActive: workerHealth.businessHoursActive,
          interpretation: workerHealth.interpretation,
          sessionActive: hasActiveSession,
          sessionState: this.sessionState
            ? { senderId: this.sessionState.senderId, status: this.sessionState.status }
            : null,
        });
        return;
      }

      // Match: GET /sessions/{senderId}/conversations/{conversationId}/messages
      // More specific — must be checked BEFORE the conversations route
      if (
        req.method === "GET" &&
        path.match(/^\/sessions\/[^/]+\/conversations\/[^/]+\/messages$/)
      ) {
        const segments = path.split("/");
        const senderId = segments[2];
        const conversationId = segments[4];
        await this.handleGetMessages(senderId, conversationId, req, res);
        return;
      }

      // Match: GET /sessions/{senderId}/conversations
      if (
        req.method === "GET" &&
        path.match(/^\/sessions\/[^/]+\/conversations$/)
      ) {
        const segments = path.split("/");
        const senderId = segments[2];
        await this.handleGetConversations(senderId, req, res);
        return;
      }

      this.jsonResponse(res, 404, { error: "Not found" });
    } catch (error) {
      console.error("[SessionServer] Request error:", error);
      this.jsonResponse(res, 500, { error: "Internal server error" });
    }
  }

  /**
   * POST /sessions/login — Headless login with credentials.
   *
   * Uses agent-browser via LinkedInBrowser.login() to:
   * 1. Navigate to LinkedIn login page
   * 2. Fill email + password
   * 3. Handle TOTP 2FA if needed
   * 4. Verify successful login
   * 5. Save session state for future use
   */
  private async handleHeadlessLogin(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.verifyAuth(req)) {
      this.jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    const body = await this.readBody(req);
    const { senderId, email, password, totpSecret, proxyUrl } = body;

    if (!senderId || !email || !password) {
      this.jsonResponse(res, 400, {
        error: "senderId, email, and password are required",
      });
      return;
    }

    this.sessionState = { senderId, status: "logging_in" };

    try {
      console.log(
        `[SessionServer] Starting headless login for sender ${senderId}`,
      );

      // Create a browser instance for this sender
      const browser = new LinkedInBrowser([], proxyUrl || undefined);
      browser.setSenderId(senderId);

      // Execute login flow via agent-browser
      const success = await browser.login(
        email,
        password,
        totpSecret || undefined,
      );

      if (success) {
        this.sessionState = { senderId, status: "logged_in" };
        console.log("[SessionServer] Headless login successful");

        // Try to export cookies and save via API for tracking.
        // This is optional — agent-browser manages the session internally
        // via the --session flag, so cookie export failure is non-fatal.
        let cookieCount = 0;
        try {
          const cookies = await browser.exportCookies();
          if (Array.isArray(cookies) && cookies.length > 0) {
            await this.api.updateSession(senderId, cookies);
            cookieCount = cookies.length;
            console.log(
              `[SessionServer] Saved ${cookieCount} cookies for tracking`,
            );
          } else {
            console.log(
              "[SessionServer] No cookies exported (agent-browser manages session internally)",
            );
          }
        } catch (cookieError) {
          console.warn(
            "[SessionServer] Cookie export/save failed (non-fatal):",
            cookieError instanceof Error
              ? cookieError.message
              : String(cookieError),
          );
        }

        // Save Voyager-format cookies for the worker's VoyagerClient
        try {
          const voyagerCookies = browser.getVoyagerCookies();
          if (voyagerCookies) {
            await this.api.saveVoyagerCookies(senderId, voyagerCookies);
            console.log("[SessionServer] Saved Voyager cookies (li_at + JSESSIONID)");
          } else {
            console.warn("[SessionServer] No Voyager cookies available to save");
          }
        } catch (voyagerError) {
          console.error(
            "[SessionServer] Failed to save Voyager cookies:",
            voyagerError instanceof Error ? voyagerError.message : String(voyagerError),
          );
        }

        this.jsonResponse(res, 200, {
          success: true,
          cookieCount,
        });
      } else {
        this.sessionState = {
          senderId,
          status: "failed",
          error: "Login failed",
        };
        this.jsonResponse(res, 200, {
          success: false,
          error: "login_failed",
        });
      }

      // Close the browser after login (session state is persisted by agent-browser)
      await browser.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[SessionServer] Headless login failed:", message);

      this.sessionState = { senderId, status: "failed", error: message };

      if (message.includes("2FA") || message.includes("totpSecret")) {
        this.jsonResponse(res, 200, {
          success: false,
          error: "2fa_required",
        });
        return;
      }

      this.jsonResponse(res, 500, { success: false, error: message });
    }
  }

  /**
   * GET /sessions/status — Get current session status.
   */
  private handleSessionStatus(res: ServerResponse): void {
    if (!this.sessionState) {
      this.jsonResponse(res, 200, { status: "idle" });
      return;
    }

    this.jsonResponse(res, 200, {
      status: this.sessionState.status,
      senderId: this.sessionState.senderId,
      error: this.sessionState.error,
    });
  }

  /**
   * GET /sessions/{senderId}/conversations
   *
   * Fetches the last 20 LinkedIn messaging conversations for a given sender.
   * Loads Voyager cookies from the Vercel API, constructs a VoyagerClient,
   * and returns conversation metadata (participant info, snippets, timestamps).
   *
   * Auth: Shared secret via Authorization: Bearer {apiSecret}
   * Errors: 401 Unauthorized | 404 no session | 401/403 session expired | 429 rate limited
   */
  private async handleGetConversations(
    senderId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.verifyAuth(req)) {
      this.jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    try {
      const cookies = await this.api.getVoyagerCookies(senderId);
      if (!cookies) {
        this.jsonResponse(res, 404, { error: "No Voyager session for sender" });
        return;
      }

      const voyager = new VoyagerClient(
        cookies.liAt,
        cookies.jsessionId,
        cookies.proxyUrl ?? undefined,
      );
      const conversations = await voyager.fetchConversations(20);
      this.jsonResponse(res, 200, {
        conversations,
        syncedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof VoyagerError) {
        // Per user decision: 401/403 returns error with reconnect hint
        if (err.status === 401 || err.status === 403) {
          this.jsonResponse(res, err.status, {
            error: "session_expired",
            message: "Reconnect LinkedIn in settings",
          });
          return;
        }
        // Per user decision: 429 fails fast, no retry
        if (err.status === 429) {
          this.jsonResponse(res, 429, {
            error: "rate_limited",
            message: "LinkedIn rate limit hit. Try again in a few minutes.",
          });
          return;
        }
        this.jsonResponse(res, err.status >= 400 ? err.status : 500, {
          error: err.body,
        });
        return;
      }
      this.jsonResponse(res, 500, { error: String(err) });
    }
  }

  /**
   * GET /sessions/{senderId}/conversations/{conversationId}/messages
   *
   * Fetches the last 20 messages for a specific LinkedIn conversation.
   * On-demand fetch per conversation — NOT inline with conversations list
   * to minimize Voyager API calls per Phase 33 design decision.
   *
   * Auth: Shared secret via Authorization: Bearer {apiSecret}
   * Errors: 401 Unauthorized | 404 no session | 401/403 session expired | 429 rate limited
   */
  private async handleGetMessages(
    senderId: string,
    conversationId: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (!this.verifyAuth(req)) {
      this.jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    try {
      const cookies = await this.api.getVoyagerCookies(senderId);
      if (!cookies) {
        this.jsonResponse(res, 404, { error: "No Voyager session for sender" });
        return;
      }

      const voyager = new VoyagerClient(
        cookies.liAt,
        cookies.jsessionId,
        cookies.proxyUrl ?? undefined,
      );
      const messages = await voyager.fetchMessages(conversationId, 20);
      this.jsonResponse(res, 200, {
        messages,
        conversationId,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof VoyagerError) {
        if (err.status === 401 || err.status === 403) {
          this.jsonResponse(res, err.status, {
            error: "session_expired",
            message: "Reconnect LinkedIn in settings",
          });
          return;
        }
        if (err.status === 429) {
          this.jsonResponse(res, 429, {
            error: "rate_limited",
            message: "LinkedIn rate limit hit. Try again in a few minutes.",
          });
          return;
        }
        this.jsonResponse(res, err.status >= 400 ? err.status : 500, {
          error: err.body,
        });
        return;
      }
      this.jsonResponse(res, 500, { error: String(err) });
    }
  }

  /**
   * Verify the worker API secret from the Authorization header.
   */
  private verifyAuth(req: IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return false;
    return auth.slice(7) === this.apiSecret;
  }

  /**
   * Read and parse JSON request body.
   */
  private readBody(req: IncomingMessage): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  /**
   * Send a JSON response.
   */
  private jsonResponse(
    res: ServerResponse,
    status: number,
    data: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}
