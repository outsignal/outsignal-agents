/**
 * CDP Utilities — shared Chrome DevTools Protocol helpers.
 *
 * Extracted from headless-login.ts so multiple modules can reuse
 * the same Chromium spawning, CDP communication, anti-detection,
 * and proxy-auth plumbing.
 */

import { spawn, ChildProcess } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  expires: number;
}

export interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Send a CDP command over WebSocket and wait for the matching response.
 */
export function cdpSend(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  id: number,
  timeoutMs = 15_000,
): Promise<CdpResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`CDP command '${method}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (event: MessageEvent) => {
      const data: CdpResponse = JSON.parse(String(event.data));
      if (data.id === id) {
        clearTimeout(timer);
        ws.removeEventListener("message", handler);
        if (data.error) {
          reject(new Error(`CDP error on '${method}': ${data.error.message}`));
        } else {
          resolve(data);
        }
      }
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/**
 * Extract the evaluated value from a Runtime.evaluate CDP response.
 * CDP returns { result: { result: { type, value } } } — this unwraps it.
 */
export function evalValue(response: CdpResponse): unknown {
  const outer = response.result as Record<string, unknown> | undefined;
  const inner = outer?.result as Record<string, unknown> | undefined;
  return inner?.value;
}

/**
 * Parse a proxy URL like http://user:pass@host:port into components.
 */
export function parseProxyUrl(url: string): { host: string; port: string; username?: string; password?: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
    };
  } catch {
    // Fallback: treat as host:port
    const [host, port] = url.split(":");
    return { host, port };
  }
}

/**
 * Safe process cleanup: SIGTERM then SIGKILL after 2s.
 */
export function killProcess(proc: ChildProcess): void {
  try {
    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
  } catch {
    // Process may already be dead
  }
  // Force kill after a short delay
  setTimeout(() => {
    try {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    } catch {
      // Already dead
    }
  }, 2000);
}

/** Promise-based delay. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Console logger with prefix. */
export function log(prefix: string, msg: string): void {
  console.log(`[${prefix}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Anti-detection script to inject via Page.addScriptToEvaluateOnNewDocument. */
export const ANTI_DETECTION_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {} };
`;

/** Common Chromium launch args (without port-specific or proxy-specific args). */
export const CHROMIUM_BASE_ARGS: string[] = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--window-size=1920,1080",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
  "--disable-blink-features=AutomationControlled",
  "--disable-features=TranslateUI",
  "--lang=en-US,en",
];

// ---------------------------------------------------------------------------
// Higher-level helpers
// ---------------------------------------------------------------------------

/**
 * Spawn headless Chromium, return process + port + proxy auth info.
 *
 * Picks a random CDP port in the 9300-9399 range, creates a per-port
 * user-data-dir under /tmp, and optionally configures a proxy.
 */
export function spawnChromium(options?: {
  proxyUrl?: string;
  cdpPort?: number;
}): { proc: ChildProcess; port: number; proxyAuth: { username: string; password: string } | null } {
  const port = options?.cdpPort ?? 9300 + Math.floor(Math.random() * 100);
  const chromiumPath = process.env.CHROME_PATH ?? "chromium";

  const args = [
    ...CHROMIUM_BASE_ARGS,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/headless-${port}`,
    "about:blank",
  ];

  let proxyAuth: { username: string; password: string } | null = null;

  if (options?.proxyUrl) {
    const proxy = parseProxyUrl(options.proxyUrl);
    args.push(`--proxy-server=${proxy.host}:${proxy.port}`);
    if (proxy.username && proxy.password) {
      proxyAuth = { username: proxy.username, password: proxy.password };
    }
  }

  const proc = spawn(chromiumPath, args, { stdio: "pipe" });

  return { proc, port, proxyAuth };
}

/**
 * Poll CDP /json endpoint until a page's WebSocket URL is available,
 * then connect and return the open WebSocket.
 */
export async function connectCdp(cdpPort: number, maxAttempts = 10): Promise<WebSocket> {
  let wsUrl: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:${cdpPort}/json`);
      const pages = (await response.json()) as Array<{ webSocketDebuggerUrl: string }>;
      if (pages.length > 0 && pages[0].webSocketDebuggerUrl) {
        wsUrl = pages[0].webSocketDebuggerUrl;
        break;
      }
    } catch {
      // CDP not ready yet
    }
    await wait(500);
  }

  if (!wsUrl) {
    throw new Error(`Failed to connect to CDP on port ${cdpPort} — no pages found after ${maxAttempts} attempts`);
  }

  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("WebSocket connection to CDP timed out"));
    }, 10_000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection to CDP failed"));
    };
  });

  return ws;
}

/**
 * Register Fetch.authRequired handler for proxy authentication.
 *
 * Enables the Fetch domain with handleAuthRequests:true, then listens for
 * Fetch.authRequired (responds with credentials) and Fetch.requestPaused
 * (continues the request) events.
 */
export function setupProxyAuth(
  ws: WebSocket,
  auth: { username: string; password: string },
  nextId: () => number,
): void {
  // Enable Fetch domain with auth interception (fire-and-forget)
  ws.send(JSON.stringify({
    id: nextId(),
    method: "Fetch.enable",
    params: { handleAuthRequests: true },
  }));

  ws.addEventListener("message", (event: MessageEvent) => {
    const msg = JSON.parse(String(event.data));
    if (msg.method === "Fetch.authRequired") {
      const requestId = msg.params.requestId;
      ws.send(JSON.stringify({
        id: nextId(),
        method: "Fetch.continueWithAuth",
        params: {
          requestId,
          authChallengeResponse: {
            response: "ProvideCredentials",
            username: auth.username,
            password: auth.password,
          },
        },
      }));
    } else if (msg.method === "Fetch.requestPaused") {
      // Continue any paused requests
      ws.send(JSON.stringify({
        id: nextId(),
        method: "Fetch.continueRequest",
        params: { requestId: msg.params.requestId },
      }));
    }
  });
}

/**
 * Initialize common CDP domains and anti-detection.
 *
 * Enables Page, Network, Runtime; injects the anti-detection script;
 * and sets a realistic user agent.
 */
export async function initCdp(
  ws: WebSocket,
  nextId: () => number,
): Promise<void> {
  await cdpSend(ws, "Page.enable", {}, nextId());
  await cdpSend(ws, "Network.enable", {}, nextId());
  await cdpSend(ws, "Runtime.enable", {}, nextId());

  // Remove automation indicators before navigating
  await cdpSend(ws, "Page.addScriptToEvaluateOnNewDocument", {
    source: ANTI_DETECTION_SCRIPT,
  }, nextId());

  // Set a realistic user agent
  await cdpSend(ws, "Network.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  }, nextId());
}
