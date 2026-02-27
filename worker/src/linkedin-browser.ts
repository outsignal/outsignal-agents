/**
 * LinkedIn browser automation using direct CDP (Chrome DevTools Protocol).
 *
 * Spawns a Chromium process, connects via WebSocket, and drives LinkedIn
 * interactions through Runtime.evaluate calls. All evaluated expressions
 * return serializable objects (never raw DOM elements).
 */

import { ChildProcess } from "child_process";
import {
  CdpCookie,
  cdpSend,
  evalValue,
  wait,
  killProcess,
  spawnChromium,
  connectCdp,
  setupProxyAuth,
  initCdp,
  log as cdpLog,
} from "./cdp.js";

export interface ActionResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export class LinkedInBrowser {
  private ws: WebSocket | null = null;
  private chromium: ChildProcess | null = null;
  private msgId = 0;
  private cookies: CdpCookie[];
  private proxyUrl: string | undefined;

  constructor(cookies: CdpCookie[], proxyUrl?: string) {
    this.cookies = cookies;
    this.proxyUrl = proxyUrl;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private nextId(): number {
    return ++this.msgId;
  }

  private log(msg: string): void {
    cdpLog("LinkedInBrowser", msg);
  }

  private sleep(ms: number): Promise<void> {
    return wait(ms);
  }

  /**
   * Navigate to a URL and wait for the page to fully load and render.
   *
   * Uses a two-phase approach:
   * 1. Navigate to about:blank first (destroys old SPA context completely)
   * 2. Navigate to target via window.location.href assignment (DOM-level nav)
   * 3. Wait for Page.frameNavigated + Page.loadEventFired
   * 4. Poll DOM until profile content is present
   */
  private async navigate(url: string): Promise<string> {
    if (!this.ws) throw new Error("Browser not launched");

    // Phase 1: Navigate to about:blank to destroy any SPA state
    this.log(`Phase 1: clearing page state via about:blank`);
    await cdpSend(this.ws, "Page.navigate", { url: "about:blank" }, this.nextId());
    // Wait for about:blank to fully load
    await this.waitForEvent("Page.loadEventFired", 5_000);
    await this.sleep(500);

    // Phase 2: Navigate to target URL using DOM API (not CDP Page.navigate)
    // This goes through the browser's normal navigation path
    this.log(`Phase 2: navigating to ${url}`);

    // Set up event listeners BEFORE triggering navigation
    const frameNavPromise = this.waitForEvent("Page.frameNavigated", 20_000);
    const loadPromise = this.waitForEvent("Page.loadEventFired", 25_000);

    // Trigger navigation via DOM — this destroys the current execution context
    this.ws.send(JSON.stringify({
      id: this.nextId(),
      method: "Page.navigate",
      params: { url },
    }));

    // Wait for new document context
    await frameNavPromise;
    this.log("Frame navigated");

    // Wait for page load
    await loadPromise;
    this.log("Page load event fired");

    // Phase 3: Poll until profile content renders (LinkedIn SPA needs time)
    const isProfileUrl = url.includes("/in/");
    if (isProfileUrl) {
      await this.pollForProfileContent();
    } else {
      await this.sleep(3000);
    }

    // Final URL check
    const result = evalValue(
      await cdpSend(this.ws, "Runtime.evaluate", {
        expression: `(() => {
  return {
    url: window.location.href,
    title: document.title.substring(0, 80),
    h1: (document.querySelector('h1')?.textContent?.trim() ?? '').substring(0, 50),
    bodyLen: document.body?.innerText?.length ?? 0,
    readyState: document.readyState,
    htmlLen: document.documentElement?.outerHTML?.length ?? 0,
  };
})()`,
        returnByValue: true,
      }, this.nextId()),
    ) as { url: string; title: string; h1: string; bodyLen: number; readyState: string; htmlLen: number } | null;

    this.log(`Landed: url=${result?.url}, title="${result?.title}", h1="${result?.h1}", body=${result?.bodyLen}, html=${result?.htmlLen}, readyState=${result?.readyState}`);
    return result?.url ?? "";
  }

  /**
   * Wait for a specific CDP event with timeout.
   */
  private waitForEvent(eventName: string, timeoutMs: number): Promise<void> {
    if (!this.ws) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.method === eventName) {
            this.ws?.removeEventListener("message", handler);
            resolve();
          }
        } catch { /* ignore */ }
      };
      this.ws!.addEventListener("message", handler);
      setTimeout(() => {
        this.ws?.removeEventListener("message", handler);
        resolve();
      }, timeoutMs);
    });
  }

  /**
   * Poll DOM until LinkedIn profile content is visible.
   * Checks for profile-specific indicators beyond just the URL.
   */
  private async pollForProfileContent(maxWaitMs = 15_000): Promise<void> {
    if (!this.ws) return;
    const start = Date.now();

    for (let i = 0; i < 30; i++) {
      if (Date.now() - start > maxWaitMs) {
        this.log(`Profile content poll timed out after ${maxWaitMs}ms`);
        break;
      }

      const result = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  const url = window.location.href;
  const title = document.title;
  const h1 = document.querySelector('h1')?.textContent?.trim() ?? '';
  // On a profile page, the title should contain the person's name, not "Feed"
  const isFeedTitle = title.includes('Feed');
  const isProfileTitle = !isFeedTitle && title.length > 5;
  // Check for profile-specific elements
  const hasH1 = h1.length > 0;
  return { url, title: title.substring(0, 50), h1: h1.substring(0, 30), isFeedTitle, isProfileTitle, hasH1 };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { url: string; title: string; h1: string; isFeedTitle: boolean; isProfileTitle: boolean; hasH1: boolean } | null;

      // Ready when: title is NOT "Feed" and has content, OR h1 has text
      if (result?.isProfileTitle || result?.hasH1) {
        this.log(`Profile content ready after ${Date.now() - start}ms: title="${result.title}", h1="${result.h1}"`);
        await this.sleep(2000); // Extra settle time for buttons to render
        return;
      }

      this.log(`Poll ${i + 1}: title="${result?.title}", h1="${result?.h1}", isFeed=${result?.isFeedTitle}`);
      await this.sleep(500);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Launch Chromium, connect via CDP, load cookies, and navigate to the feed.
   */
  async launch(): Promise<void> {
    this.log("Launching Chromium…");

    const { proc, port, proxyAuth } = await spawnChromium({
      proxyUrl: this.proxyUrl,
    });
    this.chromium = proc;

    this.ws = await connectCdp(port);

    // Enable Page, Network, Runtime domains + anti-detection patches
    await initCdp(this.ws, () => this.nextId());

    // Authenticate with the proxy if credentials were embedded in the URL
    if (proxyAuth) {
      await setupProxyAuth(this.ws, proxyAuth, () => this.nextId());
    }

    // Inject stored cookies
    if (this.cookies.length > 0) {
      this.log(`Loading ${this.cookies.length} cookies`);
      await cdpSend(
        this.ws,
        "Network.setCookies",
        { cookies: this.cookies },
        this.nextId(),
      );
    }

    // Navigate to the feed
    this.log("Navigating to LinkedIn feed");
    await cdpSend(
      this.ws,
      "Page.navigate",
      { url: "https://www.linkedin.com/feed/" },
      this.nextId(),
    );
    await this.sleep(3000);

    this.log("Launch complete");
  }

  /**
   * Tear down the browser session.
   */
  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.chromium) {
      killProcess(this.chromium);
      this.chromium = null;
    }
    this.log("Closed");
  }

  // ---------------------------------------------------------------------------
  // Session validation
  // ---------------------------------------------------------------------------

  /**
   * Check if the current session is valid (logged into LinkedIn).
   */
  async isSessionValid(): Promise<boolean> {
    if (!this.ws) return false;

    try {
      await cdpSend(
        this.ws,
        "Page.navigate",
        { url: "https://www.linkedin.com/feed/" },
        this.nextId(),
      );
      await this.sleep(3000);

      const resp = await cdpSend(
        this.ws,
        "Runtime.evaluate",
        { expression: "window.location.href", returnByValue: true },
        this.nextId(),
      );
      const url = evalValue(resp);
      this.log(`Session check URL: ${url}`);
      return typeof url === "string" && url.includes("/feed");
    } catch (err) {
      this.log(`Session check failed: ${err}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Visit a LinkedIn profile (counts as a profile view).
   */
  async viewProfile(profileUrl: string): Promise<ActionResult> {
    if (!this.ws) return { success: false, error: "Browser not launched" };

    try {
      this.log(`Viewing profile: ${profileUrl}`);
      const landedUrl = await this.navigate(profileUrl);
      await this.sleep(1000 + Math.random() * 2000);
      return { success: true, details: { landedUrl } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send a blank connection request (no note).
   */
  async sendConnectionRequest(profileUrl: string): Promise<ActionResult> {
    if (!this.ws) return { success: false, error: "Browser not launched" };

    try {
      this.log(`Sending connection request: ${profileUrl}`);

      // Navigate to profile and wait for full page load
      const landedUrl = await this.navigate(profileUrl);
      await this.sleep(1000 + Math.random() * 2000);

      if (!landedUrl.includes("/in/")) {
        return {
          success: false,
          error: `Navigation failed — landed on ${landedUrl} instead of profile`,
        };
      }

      // Step 1: Try to find and click the Connect button directly
      const connectResult = evalValue(
        await cdpSend(
          this.ws,
          "Runtime.evaluate",
          {
            expression: `(() => {
  // Try aria-label first
  let btn = document.querySelector('button[aria-label*="connect" i]');
  // Exclude "Connected" labels
  if (btn && btn.getAttribute('aria-label')?.toLowerCase().includes('connected')) btn = null;
  // Fallback: text content
  if (!btn) {
    btn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = b.textContent?.trim();
      return t === 'Connect' || t === 'Connect ';
    });
  }
  if (!btn) return { found: false };
  btn.click();
  return { found: true, clicked: true };
})()`,
            returnByValue: true,
          },
          this.nextId(),
        ),
      ) as { found: boolean; clicked?: boolean } | null;

      if (!connectResult?.found) {
        // Step 2: Try the "More" dropdown
        this.log("Connect not found directly, trying More dropdown");
        const moreResult = evalValue(
          await cdpSend(
            this.ws,
            "Runtime.evaluate",
            {
              expression: `(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b =>
    b.textContent?.trim().startsWith('More')
  );
  if (!btn) return { found: false };
  btn.click();
  return { found: true };
})()`,
              returnByValue: true,
            },
            this.nextId(),
          ),
        ) as { found: boolean } | null;

        if (!moreResult?.found) {
          return {
            success: false,
            error: "Connect button not found on profile",
          };
        }

        await this.sleep(1000);

        // Step 3: Look for Connect in the dropdown menu
        const menuResult = evalValue(
          await cdpSend(
            this.ws,
            "Runtime.evaluate",
            {
              expression: `(() => {
  const items = document.querySelectorAll('[role="menuitem"], [role="option"], li span');
  const connectItem = Array.from(items).find(el =>
    el.textContent?.trim().toLowerCase().includes('connect')
  );
  if (!connectItem) return { found: false };
  connectItem.click();
  return { found: true, clicked: true };
})()`,
              returnByValue: true,
            },
            this.nextId(),
          ),
        ) as { found: boolean; clicked?: boolean } | null;

        if (!menuResult?.found) {
          return {
            success: false,
            error: "Connect button not found — may already be connected",
          };
        }
      }

      // Step 4: Wait for the connection modal
      await this.sleep(2000);

      // Step 5: Handle modal — "Send without a note" or just "Send"
      const modalResult = evalValue(
        await cdpSend(
          this.ws,
          "Runtime.evaluate",
          {
            expression: `(() => {
  // Try "Send without a note" first
  let btn = Array.from(document.querySelectorAll('button')).find(b =>
    b.textContent?.trim().toLowerCase().includes('send without a note')
  );
  // Fallback: just "Send" button in modal
  if (!btn) {
    btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.trim() === 'Send'
    );
  }
  if (!btn) return { found: false };
  btn.click();
  return { found: true, clicked: true };
})()`,
            returnByValue: true,
          },
          this.nextId(),
        ),
      ) as { found: boolean; clicked?: boolean } | null;

      if (!modalResult?.found) {
        return {
          success: false,
          error: "Send button not found in connection modal",
        };
      }

      await this.sleep(2000);
      this.log("Connection request sent");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send a message to a 1st-degree connection.
   *
   * Uses LinkedIn's messaging page directly instead of the profile page,
   * because LinkedIn's SPA doesn't render profile content in headless Chrome.
   *
   * Flow: /messaging/ → New message → search recipient → type message → send
   */
  async sendMessage(
    profileUrl: string,
    message: string,
  ): Promise<ActionResult> {
    if (!this.ws) return { success: false, error: "Browser not launched" };

    // Extract the profile slug (e.g., "april-newman-27713482" from the URL)
    const slugMatch = profileUrl.match(/\/in\/([^/?]+)/);
    if (!slugMatch) {
      return { success: false, error: `Invalid profile URL: ${profileUrl}` };
    }

    try {
      this.log(`Sending message via messaging page to: ${profileUrl}`);

      // Step 1: Navigate to LinkedIn messaging
      const landedUrl = await this.navigate("https://www.linkedin.com/messaging/");
      this.log(`Messaging page landed: ${landedUrl}`);

      if (!landedUrl.includes("/messaging")) {
        return { success: false, error: `Failed to reach messaging page — landed on ${landedUrl}` };
      }

      // Step 2: Click "Compose" / new message button
      await this.sleep(2000);
      const composeResult = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  // Try the compose/pencil button (LinkedIn uses various selectors)
  let btn = document.querySelector('button[data-control-name="compose"], a[href*="compose"]');
  if (!btn) {
    // Try aria-label for compose
    btn = document.querySelector('button[aria-label*="compose" i], button[aria-label*="new message" i]');
  }
  if (!btn) {
    // Try finding by icon or class
    btn = document.querySelector('.msg-overlay-bubble-header__control--new-msg, .msg-conversations-container__compose-btn');
  }
  if (!btn) {
    // Broader search for compose-like buttons
    btn = Array.from(document.querySelectorAll('button, a')).find(el => {
      const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
      return label.includes('compose') || label.includes('new message') || label.includes('write a message');
    });
  }
  const title = document.title;
  const allBtns = Array.from(document.querySelectorAll('button')).slice(0, 15).map(b => {
    const label = b.getAttribute('aria-label') || b.textContent?.trim() || '';
    return label.substring(0, 30);
  });
  if (!btn) return { found: false, title: title.substring(0, 50), buttons: allBtns };
  btn.click();
  return { found: true };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { found: boolean; title?: string; buttons?: string[] } | null;

      if (!composeResult?.found) {
        this.log(`Compose button not found. Title: ${composeResult?.title}, Buttons: ${composeResult?.buttons?.join(' | ')}`);
        return {
          success: false,
          error: `Compose not found. Title="${composeResult?.title}" Buttons=[${composeResult?.buttons?.slice(0, 8).join(' | ')}]`,
        };
      }

      // Step 3: Wait for compose overlay, then type recipient name
      await this.sleep(2000);

      // Extract a searchable name from the profile URL slug
      // e.g., "april-newman-27713482" → "April Newman"
      const slug = slugMatch[1];
      const nameParts = slug.replace(/-\d+$/, "").split("-");
      const searchName = nameParts
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      this.log(`Searching for recipient: "${searchName}"`);

      // Type the name in the recipient search field
      const searchResult = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  // Find the "To" / recipient input field
  let input = document.querySelector('input[name="search-term"], input[placeholder*="name" i], input[aria-label*="name" i]');
  if (!input) {
    // Try broader selectors
    input = document.querySelector('.msg-connections-typeahead input, .msg-compose-form input[type="text"]');
  }
  if (!input) {
    // Last resort: any text input in the compose area
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    input = Array.from(inputs).find(i => {
      const label = (i.getAttribute('aria-label') || i.getAttribute('placeholder') || '').toLowerCase();
      return label.includes('type') || label.includes('name') || label.includes('search') || label.includes('to');
    });
  }
  const allInputs = Array.from(document.querySelectorAll('input')).map(i => ({
    type: i.type,
    name: i.name,
    placeholder: i.placeholder?.substring(0, 30),
    ariaLabel: i.getAttribute('aria-label')?.substring(0, 30),
  }));
  if (!input) return { found: false, inputs: allInputs };
  input.focus();
  input.value = '${searchName}';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { found: true };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { found: boolean; inputs?: Array<{ type: string; name: string; placeholder: string }> } | null;

      if (!searchResult?.found) {
        this.log(`Recipient input not found. Inputs: ${JSON.stringify(searchResult?.inputs)}`);
        return {
          success: false,
          error: `Recipient input not found. Inputs: ${JSON.stringify(searchResult?.inputs?.slice(0, 5))}`,
        };
      }

      // Step 4: Wait for autocomplete suggestions and click the first match
      await this.sleep(2000);

      const selectResult = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  // Look for autocomplete suggestions
  const suggestions = document.querySelectorAll('[role="option"], [role="listbox"] li, .msg-connections-typeahead__suggestion, .basic-typeahead__selectable');
  if (suggestions.length === 0) return { found: false, count: 0 };
  // Click the first suggestion
  const first = suggestions[0];
  first.click();
  return { found: true, count: suggestions.length, name: first.textContent?.trim().substring(0, 50) };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { found: boolean; count: number; name?: string } | null;

      if (!selectResult?.found) {
        return {
          success: false,
          error: `No autocomplete suggestions found for "${searchName}"`,
        };
      }
      this.log(`Selected recipient: "${selectResult.name}" (${selectResult.count} suggestions)`);

      // Step 5: Wait for message input to appear, then type message
      await this.sleep(2000);

      const escaped = message
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");

      const typeResult = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  const input = document.querySelector('div[role="textbox"][contenteditable="true"]');
  if (!input) return { found: false };
  input.focus();
  input.innerHTML = '<p>${escaped}</p>';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return { found: true };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { found: boolean } | null;

      if (!typeResult?.found) {
        return { success: false, error: "Message textbox not found after selecting recipient" };
      }

      // Step 6: Click Send
      await this.sleep(1000);

      const sendResult = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  // Find Send button in compose form
  let btn = document.querySelector('button[type="submit"]');
  if (!btn || !btn.textContent?.toLowerCase().includes('send')) {
    btn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = b.textContent?.trim().toLowerCase();
      return t === 'send' && b.closest('.msg-form, .msg-compose-form, [class*="msg-"]');
    });
  }
  if (!btn) {
    btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.trim() === 'Send'
    );
  }
  if (!btn) return { found: false };
  btn.click();
  return { found: true };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { found: boolean } | null;

      if (!sendResult?.found) {
        return { success: false, error: "Send button not found in compose form" };
      }

      await this.sleep(2000);
      this.log("Message sent via messaging compose");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check the connection status with a profile.
   */
  async checkConnectionStatus(
    profileUrl: string,
  ): Promise<"connected" | "pending" | "not_connected"> {
    if (!this.ws) return "not_connected";

    try {
      this.log(`Checking connection status: ${profileUrl}`);

      await this.navigate(profileUrl);
      await this.sleep(1000 + Math.random() * 2000);

      const result = evalValue(
        await cdpSend(
          this.ws,
          "Runtime.evaluate",
          {
            expression: `(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const hasMessage = buttons.some(b => b.textContent?.trim() === 'Message');
  const hasPending = buttons.some(b => b.textContent?.trim() === 'Pending');
  return { hasMessage, hasPending };
})()`,
            returnByValue: true,
          },
          this.nextId(),
        ),
      ) as { hasMessage: boolean; hasPending: boolean } | null;

      if (result?.hasMessage) return "connected";
      if (result?.hasPending) return "pending";
      return "not_connected";
    } catch {
      return "not_connected";
    }
  }

  // ---------------------------------------------------------------------------
  // Safety checks
  // ---------------------------------------------------------------------------

  /**
   * Check if LinkedIn is showing a CAPTCHA or verification challenge.
   */
  async checkForCaptcha(): Promise<boolean> {
    if (!this.ws) return false;

    try {
      const result = evalValue(
        await cdpSend(
          this.ws,
          "Runtime.evaluate",
          {
            expression: `(() => {
  const url = window.location.href;
  const title = document.title;
  return {
    checkpoint: url.includes('/checkpoint') || url.includes('/challenge'),
    securityTitle: title.toLowerCase().includes('security verification'),
  };
})()`,
            returnByValue: true,
          },
          this.nextId(),
        ),
      ) as { checkpoint: boolean; securityTitle: boolean } | null;

      return !!(result?.checkpoint || result?.securityTitle);
    } catch {
      return false;
    }
  }

  /**
   * Check if LinkedIn is showing a restriction warning.
   */
  async checkForRestriction(): Promise<boolean> {
    if (!this.ws) return false;

    try {
      const result = evalValue(
        await cdpSend(
          this.ws,
          "Runtime.evaluate",
          {
            expression: `(() => {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
  return headings.some(h => {
    const t = h.textContent?.toLowerCase() || '';
    return t.includes('restriction') || t.includes("you've reached");
  });
})()`,
            returnByValue: true,
          },
          this.nextId(),
        ),
      );

      return !!result;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Cookie management
  // ---------------------------------------------------------------------------

  /**
   * Export current cookies for storage (filtered to linkedin.com).
   */
  async exportCookies(): Promise<CdpCookie[]> {
    if (!this.ws) return [];

    try {
      const resp = await cdpSend(
        this.ws,
        "Network.getAllCookies",
        {},
        this.nextId(),
      );

      const allCookies = (resp?.result?.cookies as CdpCookie[] | undefined) ?? [];
      return allCookies.filter(
        (c) =>
          c.domain.includes("linkedin.com"),
      );
    } catch {
      this.log("Failed to export cookies");
      return [];
    }
  }
}
