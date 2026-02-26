/**
 * Session Server — HTTP + WebSocket server for LinkedIn login sessions.
 *
 * Provides:
 * - REST endpoints to start/stop/check login sessions
 * - WebSocket proxy from noVNC client → x11vnc (RFB protocol)
 * - Static file serving for the noVNC web client
 *
 * The dashboard opens the login page in a new window, which loads the
 * noVNC viewer and connects to the WebSocket proxy. The user logs into
 * LinkedIn through the streamed browser. Once login is detected, cookies
 * are captured and saved via the Vercel API.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFile, stat } from "fs/promises";
import { join, extname } from "path";
import { createConnection, Socket } from "net";
import { VncManager } from "./vnc-manager.js";
import { SessionCapture } from "./session-capture.js";
import { ApiClient } from "./api-client.js";

// WebSocket handling via 'ws' package
import { WebSocketServer, WebSocket } from "ws";

interface SessionState {
  senderId: string;
  token: string;
  status: "starting" | "ready" | "logged_in" | "failed";
  error?: string;
}

const NOVNC_PATH = "/usr/share/novnc";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LinkedIn Login — Outsignal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #fafafa; font-family: system-ui, -apple-system, sans-serif; }
    #header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px; background: #111; border-bottom: 1px solid #222;
    }
    #header h1 { font-size: 14px; font-weight: 500; }
    #status {
      font-size: 12px; padding: 4px 10px; border-radius: 9999px;
      background: #1a1a2e; color: #818cf8;
    }
    #status.connected { background: #022c22; color: #34d399; }
    #status.success { background: #14532d; color: #4ade80; }
    #status.error { background: #450a0a; color: #f87171; }
    #vnc-container {
      width: 100%; height: calc(100vh - 49px);
      display: flex; align-items: center; justify-content: center;
    }
    #vnc-container canvas { max-width: 100%; max-height: 100%; }
    #success-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.8); z-index: 100;
      align-items: center; justify-content: center;
    }
    #success-overlay.show { display: flex; }
    #success-card {
      background: #111; border: 1px solid #222; border-radius: 12px;
      padding: 40px; text-align: center; max-width: 400px;
    }
    #success-card h2 { color: #4ade80; margin-bottom: 8px; }
    #success-card p { color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <div id="header">
    <h1>Outsignal — LinkedIn Login</h1>
    <span id="status">Connecting...</span>
  </div>
  <div id="vnc-container"></div>
  <div id="success-overlay">
    <div id="success-card">
      <h2>Login Successful</h2>
      <p>Your LinkedIn session has been captured and encrypted. You can close this window.</p>
    </div>
  </div>
  <script type="module">
    import RFB from './novnc/core/rfb.js';

    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      document.getElementById('status').textContent = 'Error: No token';
      document.getElementById('status').className = 'error';
      throw new Error('Missing token');
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProto + '//' + window.location.host + '/websockify?token=' + token;

    const statusEl = document.getElementById('status');
    const container = document.getElementById('vnc-container');

    const rfb = new RFB(container, wsUrl, { wsProtocols: ['binary'] });
    rfb.viewOnly = false;
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.qualityLevel = 6;
    rfb.compressionLevel = 2;

    rfb.addEventListener('connect', () => {
      statusEl.textContent = 'Connected — Please log into LinkedIn';
      statusEl.className = 'connected';
    });

    rfb.addEventListener('disconnect', (e) => {
      if (e.detail.clean) {
        statusEl.textContent = 'Disconnected';
      } else {
        statusEl.textContent = 'Connection lost';
        statusEl.className = 'error';
      }
    });

    // Poll for login completion
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/sessions/status?token=' + token);
        const data = await res.json();
        if (data.status === 'logged_in') {
          clearInterval(pollInterval);
          statusEl.textContent = 'Login captured!';
          statusEl.className = 'success';
          document.getElementById('success-overlay').classList.add('show');
        }
      } catch {}
    }, 3000);
  </script>
</body>
</html>`;

export class SessionServer {
  private vnc: VncManager;
  private api: ApiClient;
  private apiSecret: string;
  private sessionState: SessionState | null = null;
  private wss: WebSocketServer | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;

  constructor(api: ApiClient, apiSecret: string) {
    this.vnc = new VncManager();
    this.api = api;
    this.apiSecret = apiSecret;
  }

  /**
   * Start the HTTP + WebSocket server on the given port.
   */
  start(port: number): void {
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname === "/websockify") {
        const token = url.searchParams.get("token");

        if (!this.validateToken(token)) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        this.wss!.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          this.proxyToVnc(ws);
        });
      } else {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
      }
    });

    this.httpServer.listen(port, () => {
      console.log(`[SessionServer] Listening on port ${port}`);
    });
  }

  /**
   * Stop the server and clean up.
   */
  async stop(): Promise<void> {
    if (this.sessionState) {
      await this.vnc.stopSession();
      this.sessionState = null;
    }

    this.wss?.close();
    this.httpServer?.close();
  }

  /**
   * Handle HTTP requests — REST API + static files.
   */
  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const path = url.pathname;

    try {
      // REST API endpoints
      if (path === "/sessions/start" && req.method === "POST") {
        await this.handleStartSession(req, res);
        return;
      }

      if (path === "/sessions/stop" && req.method === "POST") {
        await this.handleStopSession(req, res);
        return;
      }

      if (path === "/sessions/status" && req.method === "GET") {
        this.handleSessionStatus(url, res);
        return;
      }

      if (path === "/health" && req.method === "GET") {
        this.jsonResponse(res, 200, { ok: true, session: !!this.sessionState });
        return;
      }

      // Login page
      if (path === "/login") {
        const token = url.searchParams.get("token");
        if (!this.validateToken(token)) {
          this.jsonResponse(res, 401, { error: "Invalid or expired token" });
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(LOGIN_PAGE_HTML);
        return;
      }

      // Serve noVNC static files
      if (path.startsWith("/novnc/")) {
        await this.serveStatic(path.slice(7), res); // Remove "/novnc/" prefix
        return;
      }

      this.jsonResponse(res, 404, { error: "Not found" });
    } catch (error) {
      console.error("[SessionServer] Request error:", error);
      this.jsonResponse(res, 500, { error: "Internal server error" });
    }
  }

  /**
   * POST /sessions/start — Start a new VNC login session.
   */
  private async handleStartSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.verifyAuth(req)) {
      this.jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    const body = await this.readBody(req);
    const { senderId, proxyUrl } = body;

    if (!senderId) {
      this.jsonResponse(res, 400, { error: "senderId is required" });
      return;
    }

    if (this.sessionState) {
      this.jsonResponse(res, 409, {
        error: "A login session is already active",
        activeSenderId: this.sessionState.senderId,
      });
      return;
    }

    // Generate a session token
    const token = this.generateToken();

    this.sessionState = {
      senderId,
      token,
      status: "starting",
    };

    try {
      await this.vnc.startSession(senderId, proxyUrl);
      this.sessionState.status = "ready";

      // Start monitoring for login in the background
      this.monitorLogin(senderId, token);

      this.jsonResponse(res, 200, { token });
    } catch (error) {
      this.sessionState = null;
      this.jsonResponse(res, 500, {
        error: `Failed to start session: ${error}`,
      });
    }
  }

  /**
   * POST /sessions/stop — Stop the active login session.
   */
  private async handleStopSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.verifyAuth(req)) {
      this.jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    await this.vnc.stopSession();
    this.sessionState = null;

    this.jsonResponse(res, 200, { ok: true });
  }

  /**
   * GET /sessions/status — Get current session status.
   */
  private handleSessionStatus(url: URL, res: ServerResponse): void {
    const token = url.searchParams.get("token");

    if (!this.sessionState) {
      this.jsonResponse(res, 200, { status: "idle" });
      return;
    }

    // Allow status check with either token or auth header
    if (token !== this.sessionState.token) {
      this.jsonResponse(res, 401, { error: "Invalid token" });
      return;
    }

    this.jsonResponse(res, 200, {
      status: this.sessionState.status,
      senderId: this.sessionState.senderId,
      error: this.sessionState.error,
    });
  }

  /**
   * Monitor for successful LinkedIn login in the background.
   */
  private async monitorLogin(senderId: string, token: string): Promise<void> {
    const capture = new SessionCapture(this.vnc.getCdpPort());

    try {
      console.log("[SessionServer] Monitoring for LinkedIn login...");
      const session = await capture.waitForLogin();

      console.log(`[SessionServer] Login detected! Captured ${session.cookies.length} cookies`);

      // Save cookies via API
      await this.api.updateSession(senderId, session.cookies);

      // Update state
      if (this.sessionState?.token === token) {
        this.sessionState.status = "logged_in";
      }

      console.log("[SessionServer] Session saved successfully");

      // Auto-stop after a short delay
      setTimeout(async () => {
        if (this.sessionState?.token === token) {
          await this.vnc.stopSession();
          this.sessionState = null;
          console.log("[SessionServer] Session auto-cleaned after login");
        }
      }, 30_000);
    } catch (error) {
      console.error("[SessionServer] Login monitoring failed:", error);

      if (this.sessionState?.token === token) {
        this.sessionState.status = "failed";
        this.sessionState.error = String(error);
      }
    }
  }

  /**
   * Proxy WebSocket data to/from x11vnc TCP socket.
   */
  private proxyToVnc(ws: WebSocket): void {
    const vncPort = this.vnc.getVncPort();
    const tcp = createConnection({ port: vncPort, host: "localhost" });

    tcp.on("connect", () => {
      console.log("[SessionServer] VNC proxy connected");
    });

    tcp.on("data", (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    tcp.on("error", (err) => {
      console.error("[SessionServer] VNC TCP error:", err.message);
      ws.close();
    });

    tcp.on("close", () => {
      ws.close();
    });

    ws.on("message", (data: Buffer) => {
      if (tcp.writable) {
        tcp.write(data);
      }
    });

    ws.on("close", () => {
      tcp.destroy();
    });

    ws.on("error", (err: Error) => {
      console.error("[SessionServer] WebSocket error:", err.message);
      tcp.destroy();
    });
  }

  /**
   * Serve static files from the noVNC directory.
   */
  private async serveStatic(filePath: string, res: ServerResponse): Promise<void> {
    const fullPath = join(NOVNC_PATH, filePath);

    // Prevent directory traversal
    if (!fullPath.startsWith(NOVNC_PATH)) {
      this.jsonResponse(res, 403, { error: "Forbidden" });
      return;
    }

    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) {
        this.jsonResponse(res, 404, { error: "Not found" });
        return;
      }

      const ext = extname(fullPath);
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      const content = await readFile(fullPath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      this.jsonResponse(res, 404, { error: "Not found" });
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
   * Validate a session token.
   */
  private validateToken(token: string | null): boolean {
    if (!token || !this.sessionState) return false;
    return token === this.sessionState.token;
  }

  /**
   * Generate a random token.
   */
  private generateToken(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 32; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
  }

  /**
   * Read and parse JSON request body.
   */
  private readBody(req: IncomingMessage): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
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
  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}
