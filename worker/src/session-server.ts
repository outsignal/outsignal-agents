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

interface SessionState {
  senderId: string;
  status: "logging_in" | "logged_in" | "failed";
  error?: string;
}

export class SessionServer {
  private api: ApiClient;
  private apiSecret: string;
  private sessionState: SessionState | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;

  constructor(api: ApiClient, apiSecret: string) {
    this.api = api;
    this.apiSecret = apiSecret;
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
        this.jsonResponse(res, 200, {
          ok: true,
          session: !!this.sessionState,
        });
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
        // Export cookies and save via API for session tracking
        const cookies = await browser.exportCookies();
        await this.api.updateSession(senderId, cookies);

        this.sessionState = { senderId, status: "logged_in" };

        console.log("[SessionServer] Headless login successful");
        this.jsonResponse(res, 200, {
          success: true,
          cookieCount: cookies.length,
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
