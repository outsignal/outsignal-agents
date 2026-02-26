/**
 * Headless Login — drives Chromium headlessly via CDP to log into LinkedIn.
 *
 * Spawns a headless Chromium instance, fills email + password on the
 * LinkedIn login page, handles optional TOTP 2FA, waits for successful
 * redirect, then extracts and returns all LinkedIn cookies via CDP.
 */

import { spawn, ChildProcess } from "child_process";
import { TOTP } from "otpauth";

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  expires: number;
}

interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Send a CDP command over WebSocket and wait for the matching response.
 */
function cdpSend(
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string): void {
  console.log(`[HeadlessLogin] ${msg}`);
}

/**
 * Extract the evaluated value from a Runtime.evaluate CDP response.
 * CDP returns { result: { result: { type, value } } } — this unwraps it.
 */
function evalValue(response: CdpResponse): unknown {
  const outer = response.result as Record<string, unknown> | undefined;
  const inner = outer?.result as Record<string, unknown> | undefined;
  return inner?.value;
}

function killProcess(proc: ChildProcess): void {
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

/**
 * Log into LinkedIn headlessly and return the session cookies.
 *
 * Spawns a headless Chromium, navigates to the login page, fills
 * credentials, optionally handles TOTP 2FA, waits for a post-login
 * redirect, then extracts cookies via CDP.
 */
export async function headlessLogin(options: {
  email: string;
  password: string;
  totpSecret?: string;
  proxyUrl?: string;
}): Promise<CdpCookie[]> {
  const { email, password, totpSecret, proxyUrl } = options;
  const cdpPort = 9300 + Math.floor(Math.random() * 100);
  const chromiumPath = process.env.CHROME_PATH ?? "chromium";
  let chromium: ChildProcess | null = null;
  let msgId = 0;

  const nextId = () => ++msgId;

  try {
    // --- 1. Spawn headless Chromium ---
    log(`Launching headless Chromium on CDP port ${cdpPort}`);

    const chromiumArgs = [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${cdpPort}`,
      "--window-size=1920,1080",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      // Anti-detection
      "--disable-blink-features=AutomationControlled",
      "--disable-features=TranslateUI",
      "--lang=en-US,en",
      `--user-data-dir=/tmp/headless-login-${cdpPort}`,
      "about:blank",
    ];

    if (proxyUrl) {
      chromiumArgs.push(`--proxy-server=${proxyUrl}`);
      log(`Using proxy: ${proxyUrl}`);
    }

    chromium = spawn(chromiumPath, chromiumArgs, { stdio: "pipe" });

    chromium.on("error", (err) => {
      console.error("[HeadlessLogin] Chromium spawn error:", err);
    });

    chromium.on("exit", (code) => {
      log(`Chromium exited with code ${code}`);
    });

    // --- 2. Wait for Chromium to start ---
    log("Waiting for Chromium to initialize...");
    await wait(2000);

    // --- 3. Get CDP WebSocket URL ---
    log("Connecting to CDP...");
    let wsUrl: string | null = null;

    for (let attempt = 0; attempt < 10; attempt++) {
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
      throw new Error("Failed to connect to CDP — no pages found after 5 seconds");
    }

    log(`CDP connected: ${wsUrl}`);

    // --- 4. Open WebSocket ---
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

    // Enable required CDP domains
    await cdpSend(ws, "Page.enable", {}, nextId());
    await cdpSend(ws, "Network.enable", {}, nextId());
    await cdpSend(ws, "Runtime.enable", {}, nextId());

    // Remove automation indicators before navigating
    await cdpSend(ws, "Page.addScriptToEvaluateOnNewDocument", {
      source: `
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {} };
      `,
    }, nextId());

    // Set a realistic user agent
    await cdpSend(ws, "Network.setUserAgentOverride", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }, nextId());

    // --- 5. Navigate to LinkedIn login ---
    log("Navigating to LinkedIn login page...");
    await cdpSend(ws, "Page.navigate", { url: "https://www.linkedin.com/login" }, nextId());

    // --- 6. Wait for page to load ---
    await wait(3000);

    // Log page title to verify we got the login page
    const titleResult = await cdpSend(ws, "Runtime.evaluate", { expression: "document.title" }, nextId());
    const pageTitle = String(evalValue(titleResult) ?? "");
    log(`Page loaded — title: "${pageTitle}"`);

    // --- 7–8. Fill email and password ---
    log("Filling login credentials...");

    // Escape strings for safe injection into JS
    const safeEmail = email.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const safePassword = password.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    await cdpSend(
      ws,
      "Runtime.evaluate",
      {
        expression: `
          (() => {
            const el = document.querySelector('#username');
            if (!el) throw new Error('Email field not found');
            el.value = '${safeEmail}';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })();
        `,
      },
      nextId(),
    );

    await cdpSend(
      ws,
      "Runtime.evaluate",
      {
        expression: `
          (() => {
            const el = document.querySelector('#password');
            if (!el) throw new Error('Password field not found');
            el.value = '${safePassword}';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })();
        `,
      },
      nextId(),
    );

    // --- 9. Click sign-in button ---
    log("Clicking sign-in button...");
    await cdpSend(
      ws,
      "Runtime.evaluate",
      {
        expression: `
          (() => {
            const btn = document.querySelector('.login__form_action_container button');
            if (!btn) throw new Error('Sign-in button not found');
            btn.click();
          })();
        `,
      },
      nextId(),
    );

    // --- 10. Wait for redirect ---
    log("Waiting for login response...");
    await wait(5000);

    // --- 11. Check for 2FA challenge ---
    const urlResult = await cdpSend(
      ws,
      "Runtime.evaluate",
      { expression: "window.location.href" },
      nextId(),
    );
    const currentUrl = String(evalValue(urlResult) ?? "");
    log(`Current URL after login: ${currentUrl}`);

    const is2faChallenge =
      currentUrl.includes("/checkpoint") ||
      currentUrl.includes("/check/") ||
      currentUrl.includes("/challenge");

    if (is2faChallenge && totpSecret) {
      log("2FA challenge detected — generating TOTP code...");

      const totp = new TOTP({
        secret: totpSecret,
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      });
      const code = totp.generate();
      log(`TOTP code generated: ${code}`);

      // Wait a moment for the 2FA page to fully render
      await wait(2000);

      // Try common selectors for the 2FA input field
      const safeCode = code.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      await cdpSend(
        ws,
        "Runtime.evaluate",
        {
          expression: `
            (() => {
              const selectors = [
                'input[name="pin"]',
                'input#input__phone_verification_pin',
                'input#input__email_verification_pin',
                'input[type="text"]',
                'input[type="number"]',
              ];
              let el = null;
              for (const sel of selectors) {
                el = document.querySelector(sel);
                if (el) break;
              }
              if (!el) throw new Error('2FA input field not found');
              el.value = '${safeCode}';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            })();
          `,
        },
        nextId(),
      );

      // Click the submit/verify button
      await cdpSend(
        ws,
        "Runtime.evaluate",
        {
          expression: `
            (() => {
              const selectors = [
                'button[type="submit"]',
                '#two-step-submit-button',
                'button.btn__primary--large',
                'form button',
              ];
              let btn = null;
              for (const sel of selectors) {
                btn = document.querySelector(sel);
                if (btn) break;
              }
              if (!btn) throw new Error('2FA submit button not found');
              btn.click();
            })();
          `,
        },
        nextId(),
      );

      log("2FA code submitted");
      await wait(3000);
    } else if (is2faChallenge && !totpSecret) {
      throw new Error(
        "LinkedIn 2FA challenge detected but no totpSecret was provided. " +
        "Cannot proceed without 2FA credentials.",
      );
    }

    // --- 12. Poll for successful login ---
    log("Polling for successful login redirect...");
    const loginIndicators = [
      "/feed",
      "/mynetwork",
      "/messaging",
      "/notifications",
      "/jobs",
      "/in/",
    ];

    let loggedIn = false;
    const pollStart = Date.now();
    const pollTimeout = 60_000;

    let lastLoggedUrl = "";
    while (Date.now() - pollStart < pollTimeout) {
      const result = await cdpSend(
        ws,
        "Runtime.evaluate",
        { expression: "window.location.href" },
        nextId(),
      );
      const url = String(evalValue(result) ?? "");

      // Log URL changes for debugging
      if (url !== lastLoggedUrl) {
        log(`Page URL: ${url}`);
        lastLoggedUrl = url;
      }

      if (loginIndicators.some((indicator) => url.includes(indicator))) {
        log(`Login successful — redirected to: ${url}`);
        loggedIn = true;
        break;
      }

      // Check for known error states
      if (url.includes("/login") && Date.now() - pollStart > 10_000) {
        const errorCheck = await cdpSend(
          ws,
          "Runtime.evaluate",
          {
            expression: `
              (() => {
                const err = document.querySelector('#error-for-username, #error-for-password, .form__label--error, [role="alert"]');
                return err ? err.textContent.trim() : null;
              })();
            `,
          },
          nextId(),
        );
        const errorText = evalValue(errorCheck);
        if (errorText) {
          throw new Error(`LinkedIn login failed: ${errorText}`);
        }
      }

      await wait(2000);
    }

    if (!loggedIn) {
      // Capture final page state for debugging
      const finalUrl = await cdpSend(ws, "Runtime.evaluate", { expression: "window.location.href" }, nextId());
      const finalTitle = await cdpSend(ws, "Runtime.evaluate", { expression: "document.title" }, nextId());
      const finalUrlVal = String(evalValue(finalUrl) ?? "");
      const finalTitleVal = String(evalValue(finalTitle) ?? "");
      log(`Timeout — final URL: ${finalUrlVal}, title: ${finalTitleVal}`);
      throw new Error(`Login timed out. Final page: "${finalTitleVal}" at ${finalUrlVal}`);
    }

    // --- 13. Wait for cookies to settle ---
    log("Waiting for cookies to settle...");
    await wait(2000);

    // --- 14. Extract LinkedIn cookies ---
    log("Extracting LinkedIn cookies...");
    const cookieResult = await cdpSend(ws, "Network.getAllCookies", {}, nextId());
    const allCookies: CdpCookie[] =
      (cookieResult.result?.cookies as CdpCookie[] | undefined) ?? [];
    const linkedinCookies = allCookies.filter((c) => c.domain.includes("linkedin"));

    log(
      `Extracted ${linkedinCookies.length} LinkedIn cookies (of ${allCookies.length} total)`,
    );

    // Close WebSocket
    ws.close();

    // --- 15. Kill Chromium ---
    if (chromium) {
      log("Shutting down Chromium...");
      killProcess(chromium);
      chromium = null;
    }

    // --- 16. Return cookies ---
    return linkedinCookies;
  } catch (error) {
    // Always clean up Chromium on error
    if (chromium) {
      log("Error occurred — killing Chromium...");
      killProcess(chromium);
    }
    throw error;
  }
}
