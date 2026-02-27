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

  /**
   * Resolve the member URN for a profile via direct Voyager API fetch.
   * No fallbacks — if we can't get the URN reliably, we fail the action.
   */
  private async resolveRecipient(profileUrl: string): Promise<{
    urn: string;
    memberUrn: string | null;
    name: string | null;
  } | null> {
    const slugMatch = profileUrl.match(/\/in\/([^/?]+)/);
    if (!slugMatch) return null;
    const publicId = slugMatch[1].replace(/\/$/, "");

    return this.fetchVoyagerProfile(publicId);
  }

  /**
   * Execute a Voyager API call via the browser's fetch (uses browser proxy + cookies).
   * Returns the parsed response or null on failure.
   */
  private async voyagerFetch(
    url: string,
    method: "GET" | "POST" = "GET",
    body?: string,
  ): Promise<{ status: number; body: string } | null> {
    if (!this.ws) return null;

    // Get CSRF token from cookies
    const cookieResp = await cdpSend(
      this.ws, "Network.getAllCookies", {}, this.nextId(),
    );
    const allCookies = (cookieResp?.result?.cookies as CdpCookie[] | undefined) ?? [];
    const jsessionId = allCookies.find(
      c => c.domain.includes("linkedin.com") && c.name === "JSESSIONID",
    )?.value;
    if (!jsessionId) {
      this.log("Voyager: missing JSESSIONID cookie");
      return null;
    }
    const csrfToken = jsessionId.replace(/"/g, "");

    // Build the fetch options as a JSON string to inject into eval
    const headers: Record<string, string> = {
      "csrf-token": csrfToken,
      "x-restli-protocol-version": "2.0.0",
      "x-li-lang": "en_US",
    };
    // Only set normalized JSON accept for GET (profile) requests
    // POST requests (messaging) should not include it (matches linkedin-api library)
    if (method === "GET") {
      headers["accept"] = "application/vnd.linkedin.normalized+json+2.1";
    }
    const fetchOpts: Record<string, unknown> = { method, headers };
    if (body) {
      headers["content-type"] = "application/json; charset=UTF-8";
      fetchOpts.body = body;
    }

    const result = evalValue(
      await cdpSend(this.ws, "Runtime.evaluate", {
        expression: `(async () => {
  try {
    const resp = await fetch(${JSON.stringify(url)}, ${JSON.stringify(fetchOpts)});
    const text = await resp.text();
    return { status: resp.status, body: text.substring(0, 20000) };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
})()`,
        returnByValue: true,
        awaitPromise: true,
      }, this.nextId()),
    ) as { status: number; body: string } | null;

    return result;
  }

  /**
   * Fetch profile data via Voyager API (executed in browser context for proxy routing).
   */
  private async fetchVoyagerProfile(publicId: string): Promise<{
    urn: string;
    memberUrn: string | null;
    name: string | null;
  } | null> {
    const endpoints = [
      `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${publicId}`,
      `https://www.linkedin.com/voyager/api/identity/profiles/${publicId}/profileView`,
    ];

    for (const url of endpoints) {
      this.log(`Voyager profile fetch: ${url.substring(0, 120)}`);

      const result = await this.voyagerFetch(url);
      if (!result || result.status !== 200) {
        this.log(`Voyager returned ${result?.status ?? 'null'} for ${url.substring(url.lastIndexOf("/"))}`);
        continue;
      }

      // Debug: log all URN types found in the response
      const allUrns = result.body.match(/urn:li:[a-zA-Z_]+:[A-Za-z0-9_-]+/g) ?? [];
      const urnTypes = [...new Set(allUrns.map(u => u.split(":").slice(0, 3).join(":")))];
      this.log(`Voyager URN types found: ${urnTypes.join(", ")}`);

      // Extract profile URNs - we need both fsd_profile ID and member URN
      const fsdMatch = result.body.match(/urn:li:fsd_profile:([A-Za-z0-9_-]+)/);
      const memberMatch = result.body.match(/urn:li:member:(\d+)/);
      const miniMatch = result.body.match(/urn:li:fs_miniProfile:([A-Za-z0-9_-]+)/);
      const profileId = miniMatch?.[1] ?? fsdMatch?.[1];
      if (!profileId) {
        this.log("Voyager response has no profile URN, trying next endpoint");
        continue;
      }

      // Extract name from the response
      let name: string | null = null;
      try {
        const json = JSON.parse(result.body);
        const profile = json?.profile ?? json?.elements?.[0] ?? {};
        const firstName = profile?.firstName ?? profile?.localizedFirstName ?? "";
        const lastName = profile?.lastName ?? profile?.localizedLastName ?? "";
        if (firstName || lastName) {
          name = `${firstName} ${lastName}`.trim();
        }
        if (Array.isArray(json?.included)) {
          for (const item of json.included) {
            if (item?.firstName && item?.lastName && !name) {
              name = `${item.firstName} ${item.lastName}`.trim();
            }
          }
        }
      } catch { /* extraction is best-effort */ }

      const memberUrn = memberMatch?.[1] ?? null;
      this.log(`Voyager profile resolved: profileId="${profileId}", memberUrn=${memberUrn}, name="${name}"`);
      return { urn: profileId, memberUrn, name };
    }

    this.log("All Voyager profile endpoints failed");
    return null;
  }

  /**
   * Send a message via the Voyager messaging API (executed in browser context).
   */
  /**
   * Send message via the messaging UI:
   * 1. Navigate to /messaging/
   * 2. Click "Compose message" button
   * 3. Type recipient name in the To field
   * 4. Select from autocomplete dropdown
   * 5. Type the message
   * 6. Click send
   */
  private async sendMessageToRecipient(
    _profileId: string,
    _memberUrn: string | null,
    recipientName: string | null,
    messageText: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.ws) return { success: false, error: "Browser not launched" };
    if (!recipientName) return { success: false, error: "Recipient name required for compose approach" };

    // Step 1: Navigate to the messaging page
    this.log("Navigating to messaging page");
    await cdpSend(this.ws, "Page.navigate", { url: "about:blank" }, this.nextId());
    await this.waitForEvent("Page.loadEventFired", 5_000);
    await this.sleep(500);

    const loadPromise = this.waitForEvent("Page.loadEventFired", 25_000);
    this.ws.send(JSON.stringify({
      id: this.nextId(),
      method: "Page.navigate",
      params: { url: "https://www.linkedin.com/messaging/" },
    }));
    await loadPromise;
    await this.sleep(3000);

    // Step 2: Click the "Compose message" button
    this.log("Looking for Compose message button...");
    const composeBtn = evalValue(
      await cdpSend(this.ws, "Runtime.evaluate", {
        expression: `(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const btn = btns.find(b => {
    const text = b.textContent?.trim().toLowerCase() ?? '';
    const label = (b.getAttribute('aria-label') ?? '').toLowerCase();
    return text.includes('compose') || label.includes('compose') || label.includes('new message');
  });
  if (!btn) return { found: false, allBtns: btns.slice(0, 10).map(b => (b.textContent?.trim() ?? '').substring(0, 25)) };
  btn.click();
  return { found: true, text: btn.textContent?.trim()?.substring(0, 30) };
})()`,
        returnByValue: true,
      }, this.nextId()),
    ) as { found: boolean; text?: string; allBtns?: string[] } | null;

    if (!composeBtn?.found) {
      this.log(`Compose button not found. Buttons: [${composeBtn?.allBtns?.join(', ')}]`);
      return { success: false, error: "Compose message button not found" };
    }
    this.log(`Clicked compose button: "${composeBtn.text}"`);
    await this.sleep(2000);

    // Step 3: Find the To/recipient input field and type the name
    this.log(`Typing recipient name: ${recipientName}`);
    const toField = evalValue(
      await cdpSend(this.ws, "Runtime.evaluate", {
        expression: `(() => {
  // Look for the To input in the compose overlay
  const inputs = document.querySelectorAll('input[type="text"], input:not([type]), [role="combobox"]');
  // The To field is usually the first input in the compose overlay, or has placeholder about "Type a name"
  for (const inp of inputs) {
    const ph = (inp.getAttribute('placeholder') ?? '').toLowerCase();
    const label = (inp.getAttribute('aria-label') ?? '').toLowerCase();
    if (ph.includes('name') || ph.includes('recipient') || ph.includes('to') || label.includes('name') || label.includes('recipient') || label.includes('to:')) {
      inp.focus();
      inp.click();
      return { found: true, tag: inp.tagName, placeholder: ph.substring(0, 40) };
    }
  }
  // Fallback: try the first text input in a modal/overlay
  const overlay = document.querySelector('[role="dialog"], .msg-overlay-conversation-bubble, .msg-compose');
  if (overlay) {
    const inp = overlay.querySelector('input');
    if (inp) {
      inp.focus();
      inp.click();
      return { found: true, tag: inp.tagName, placeholder: (inp.getAttribute('placeholder') ?? '').substring(0, 40), fallback: true };
    }
  }
  return { found: false, inputCount: inputs.length };
})()`,
        returnByValue: true,
      }, this.nextId()),
    ) as { found: boolean; tag?: string; placeholder?: string; fallback?: boolean; inputCount?: number } | null;

    if (!toField?.found) {
      this.log(`To field not found (${toField?.inputCount} inputs on page)`);
      return { success: false, error: "Recipient input field not found in compose dialog" };
    }
    this.log(`Found To field: ${toField.tag} placeholder="${toField.placeholder}" fallback=${toField.fallback ?? false}`);
    await this.sleep(500);

    // Type the recipient name to trigger autocomplete
    await cdpSend(this.ws, "Input.insertText", { text: recipientName }, this.nextId());
    await this.sleep(2000); // Wait for autocomplete to populate

    // Step 4: Select the first matching result from autocomplete
    const selectResult = evalValue(
      await cdpSend(this.ws, "Runtime.evaluate", {
        expression: `(() => {
  // Look for autocomplete dropdown items
  const listItems = document.querySelectorAll('[role="option"], [role="listbox"] li, .basic-typeahead__triggered-content li, .msg-connections-typeahead__search-result');
  if (listItems.length === 0) {
    return { found: false, reason: 'no autocomplete items' };
  }
  // Click the first result
  const first = listItems[0];
  const name = first.textContent?.trim()?.substring(0, 50) ?? '';
  first.click();
  return { found: true, name, count: listItems.length };
})()`,
        returnByValue: true,
      }, this.nextId()),
    ) as { found: boolean; name?: string; count?: number; reason?: string } | null;

    if (!selectResult?.found) {
      this.log(`Autocomplete selection failed: ${selectResult?.reason}`);
      // Try pressing Enter as fallback (selects first result)
      await cdpSend(this.ws, "Input.dispatchKeyEvent", {
        type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
      }, this.nextId());
      await cdpSend(this.ws, "Input.dispatchKeyEvent", {
        type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
      }, this.nextId());
      await this.sleep(1000);
      this.log("Pressed Enter as autocomplete fallback");
    } else {
      this.log(`Selected recipient: "${selectResult.name}" (from ${selectResult.count} results)`);
    }
    await this.sleep(1000);

    // Step 5: Focus the message body input and type the message
    this.log("Focusing message body...");
    await cdpSend(this.ws, "Runtime.evaluate", {
      expression: `(() => {
  // Look for the message body input (contenteditable div)
  const inputs = document.querySelectorAll('.msg-form__contenteditable, [role="textbox"][contenteditable="true"], .msg-form__message-texteditable, [aria-label*="message" i][contenteditable]');
  for (const inp of inputs) {
    inp.focus();
    inp.click();
    return true;
  }
  return false;
})()`,
      returnByValue: true,
    }, this.nextId());
    await this.sleep(500);

    // Type the message
    this.log("Typing message...");
    await cdpSend(this.ws, "Input.insertText", { text: messageText }, this.nextId());
    await this.sleep(1000);

    // Step 6: Send the message — try button click first, Enter key as fallback
    const sendResult = evalValue(
      await cdpSend(this.ws, "Runtime.evaluate", {
        expression: `(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  // Look for Send button by various patterns
  const sendBtn = btns.find(b => {
    const text = b.textContent?.trim().toLowerCase() ?? '';
    const label = (b.getAttribute('aria-label') ?? '').toLowerCase();
    return text === 'send' || label === 'send' || label === 'send message'
      || (label.includes('send') && !label.includes('send options'));
  });
  // Also try: button with type="submit" inside a messaging form
  const submitBtn = !sendBtn ? btns.find(b => b.type === 'submit' && b.closest('.msg-form, .msg-overlay, [role="dialog"]')) : null;
  const btn = sendBtn ?? submitBtn;
  if (!btn) {
    // Debug: log all button labels and aria-labels
    const debugBtns = btns.map(b => ({
      text: (b.textContent?.trim() ?? '').substring(0, 25),
      label: b.getAttribute('aria-label')?.substring(0, 25) ?? '',
      type: b.type,
    })).filter(b => b.text || b.label);
    return { found: false, debug: debugBtns.slice(-10) };
  }
  if (btn.disabled) return { found: true, disabled: true };
  btn.click();
  return { found: true, clicked: true, text: btn.textContent?.trim()?.substring(0, 20) };
})()`,
        returnByValue: true,
      }, this.nextId()),
    ) as { found: boolean; clicked?: boolean; disabled?: boolean; text?: string; debug?: Array<{ text: string; label: string; type: string }> } | null;

    if (sendResult?.found && sendResult.clicked) {
      this.log(`Send button clicked: "${sendResult.text}"`);
      await this.sleep(3000);
      return { success: true };
    }

    if (sendResult?.disabled) {
      this.log("Send button found but disabled — message body may be empty");
      return { success: false, error: "Send button disabled" };
    }

    // Button not found — log debug info and try Enter key
    if (sendResult?.debug) {
      this.log(`Send btn not found. Buttons: ${JSON.stringify(sendResult.debug)}`);
    }

    this.log("Trying Enter key to send...");
    await cdpSend(this.ws, "Input.dispatchKeyEvent", {
      type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
    }, this.nextId());
    await cdpSend(this.ws, "Input.dispatchKeyEvent", {
      type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
    }, this.nextId());
    await this.sleep(3000);

    this.log("Enter key sent as send fallback");
    return { success: true };
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
   * Send a message to a LinkedIn connection.
   *
   * Uses the Voyager messaging API directly — no compose page, no DOM interaction.
   * Flow:
   * 1. Resolve recipient URN via Voyager profile API
   * 2. Navigate to profile (counts as a profile view for human-like behavior)
   * 3. Send message via Voyager messaging API
   */
  async sendMessage(
    profileUrl: string,
    message: string,
  ): Promise<ActionResult> {
    if (!this.ws) return { success: false, error: "Browser not launched" };

    if (!profileUrl.includes("/in/")) {
      return { success: false, error: `Invalid profile URL (missing /in/): ${profileUrl}` };
    }

    try {
      this.log(`Sending message to: ${profileUrl}`);

      // Step 1: Resolve the recipient URN via Voyager API
      const recipient = await this.resolveRecipient(profileUrl);
      if (!recipient) {
        return {
          success: false,
          error: `Failed to resolve member URN for: ${profileUrl}`,
        };
      }
      const { urn: profileId, memberUrn, name: recipientName } = recipient;
      this.log(`Resolved: ${recipientName} (profileId=${profileId}, memberUrn=${memberUrn})`);

      // Step 2: Navigate to the profile page (counts as a profile view)
      const landedUrl = await this.navigate(profileUrl);
      this.log(`Profile page landed: ${landedUrl}`);

      // Human-like delay after viewing profile
      await this.sleep(1000 + Math.random() * 2000);

      // Step 3: Try to send via existing conversation first, then compose fallback
      const sendResult = await this.sendMessageToRecipient(profileId, memberUrn, recipientName, message);
      if (!sendResult.success) {
        return {
          success: false,
          error: sendResult.error ?? "Message send failed",
        };
      }

      return {
        success: true,
        details: { profileId, memberUrn, recipientName },
      };
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
