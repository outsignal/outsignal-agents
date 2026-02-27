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
   * Extract the member URN (numeric ID) from the current profile page.
   * Tries 4 fallback strategies to find it in the DOM.
   */
  private async extractMemberUrn(maxWaitMs = 10_000): Promise<string | null> {
    if (!this.ws) return null;
    const start = Date.now();

    for (let i = 0; i < 20; i++) {
      if (Date.now() - start > maxWaitMs) {
        this.log(`Member URN extraction timed out after ${maxWaitMs}ms`);
        break;
      }

      const result = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  // Strategy 1: data-member-id attribute
  const memberIdEl = document.querySelector('[data-member-id]');
  if (memberIdEl) {
    const id = memberIdEl.getAttribute('data-member-id');
    if (id) return { id, strategy: 'data-member-id' };
  }

  // Strategy 2: urn:li:fsd_profile:{id} regex on page HTML
  const html = document.documentElement.innerHTML;
  const fsdMatch = html.match(/urn:li:fsd_profile:([A-Za-z0-9_-]+)/);
  if (fsdMatch) return { id: fsdMatch[1], strategy: 'fsd_profile_regex' };

  // Strategy 3: entityUrn in <code> tags (LinkedIn embeds JSON in code tags)
  const codeTags = document.querySelectorAll('code');
  for (const code of codeTags) {
    const text = code.textContent || '';
    const urnMatch = text.match(/"entityUrn"\\s*:\\s*"urn:li:(?:fsd_profile|member):([A-Za-z0-9_-]+)"/);
    if (urnMatch) return { id: urnMatch[1], strategy: 'code_tag_entityUrn' };
  }

  // Strategy 4: data-entity-urn attribute
  const entityUrnEl = document.querySelector('[data-entity-urn]');
  if (entityUrnEl) {
    const urn = entityUrnEl.getAttribute('data-entity-urn') || '';
    const match = urn.match(/urn:li:(?:fsd_profile|member):([A-Za-z0-9_-]+)/);
    if (match) return { id: match[1], strategy: 'data-entity-urn' };
  }

  return null;
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { id: string; strategy: string } | null;

      if (result?.id) {
        this.log(`Extracted member URN "${result.id}" via strategy: ${result.strategy}`);
        return result.id;
      }

      this.log(`URN poll ${i + 1}: no URN found yet`);
      await this.sleep(500);
    }

    return null;
  }

  /**
   * Extract the profile name from the current profile page's <h1> tag.
   * Single-shot eval — profile content should already be loaded by navigate().
   */
  private async extractProfileName(): Promise<string | null> {
    if (!this.ws) return null;

    const result = evalValue(
      await cdpSend(this.ws, "Runtime.evaluate", {
        expression: `(() => {
  const h1 = document.querySelector('h1');
  if (!h1) return null;
  const text = h1.textContent?.trim() ?? '';
  return text.length > 0 ? text : null;
})()`,
        returnByValue: true,
      }, this.nextId()),
    ) as string | null;

    if (result) {
      this.log(`Extracted profile name: "${result}"`);
    } else {
      this.log("Could not extract profile name from h1");
    }

    return result;
  }

  /**
   * Wait for a recipient pill/tag to appear in the compose form.
   * Polls multiple CSS selectors that LinkedIn uses for recipient pills.
   */
  private async waitForComposeRecipient(maxWaitMs = 10_000): Promise<string | null> {
    if (!this.ws) return null;
    const start = Date.now();

    for (let i = 0; i < 20; i++) {
      if (Date.now() - start > maxWaitMs) {
        this.log(`Compose recipient poll timed out after ${maxWaitMs}ms`);
        break;
      }

      const result = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  // Strategy 1: element with data-entity-urn containing a span (pill with name)
  const urnEl = document.querySelector('[data-entity-urn] span');
  if (urnEl && urnEl.textContent?.trim()) return { name: urnEl.textContent.trim(), strategy: 'data-entity-urn span' };

  // Strategy 2: pill-like classes LinkedIn uses
  const pill = document.querySelector('.msg-compose-pill, .msg-connections-typeahead__pill, .artdeco-pill');
  if (pill && pill.textContent?.trim()) return { name: pill.textContent.trim(), strategy: 'pill-class' };

  // Strategy 3: listitem role inside recipient area
  const listItem = document.querySelector('[role="listitem"]');
  if (listItem && listItem.textContent?.trim()) return { name: listItem.textContent.trim(), strategy: 'role-listitem' };

  // Strategy 4: pill-like elements near the "To:" label
  const toLabel = Array.from(document.querySelectorAll('label, span')).find(el =>
    el.textContent?.trim().toLowerCase() === 'to' || el.textContent?.trim().toLowerCase() === 'to:'
  );
  if (toLabel) {
    const container = toLabel.closest('div');
    if (container) {
      const pill = container.querySelector('span[data-entity-urn], button, .artdeco-pill');
      if (pill && pill.textContent?.trim()) return { name: pill.textContent.trim(), strategy: 'near-to-label' };
    }
  }

  return null;
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { name: string; strategy: string } | null;

      if (result?.name) {
        this.log(`Compose recipient found: "${result.name}" via strategy: ${result.strategy}`);
        return result.name;
      }

      this.log(`Recipient poll ${i + 1}: no pill found yet`);
      await this.sleep(500);
    }

    return null;
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
   * Uses URN-based compose URL for reliable recipient targeting:
   * 1. Navigate to the profile page to extract the member URN
   * 2. Open /messaging/compose/?recipientUrn=urn:li:fsd_profile:{id}
   * 3. Verify recipient pill matches profile name
   * 4. Type and send the message
   */
  async sendMessage(
    profileUrl: string,
    message: string,
  ): Promise<ActionResult> {
    if (!this.ws) return { success: false, error: "Browser not launched" };

    // Validate profile URL
    if (!profileUrl.includes("/in/")) {
      return { success: false, error: `Invalid profile URL (missing /in/): ${profileUrl}` };
    }

    try {
      this.log(`Sending message via URN compose to: ${profileUrl}`);

      // Step 1: Navigate to the profile page
      const landedUrl = await this.navigate(profileUrl);
      this.log(`Profile page landed: ${landedUrl}`);

      // Human-like delay after viewing profile
      await this.sleep(1000 + Math.random() * 2000);

      // Step 2: Extract the member URN from the profile page
      const memberId = await this.extractMemberUrn();
      if (!memberId) {
        return {
          success: false,
          error: `Failed to extract member URN from profile page: ${profileUrl}`,
        };
      }

      // Step 3: Extract profile name for later verification
      const profileName = await this.extractProfileName();
      this.log(`Profile name for verification: "${profileName}"`);

      // Step 4: Navigate to compose URL with recipient URN
      const composeUrl = `https://www.linkedin.com/messaging/compose/?recipientUrn=urn:li:fsd_profile:${memberId}`;
      this.log(`Navigating to compose URL: ${composeUrl}`);
      await this.navigate(composeUrl);

      // Step 5: Wait for the recipient pill to appear
      const pillName = await this.waitForComposeRecipient();
      if (!pillName) {
        // Diagnose why the pill didn't appear
        const diagResult = evalValue(
          await cdpSend(this.ws, "Runtime.evaluate", {
            expression: `(() => {
  return {
    url: window.location.href,
    title: document.title.substring(0, 80),
    bodyText: document.body?.innerText?.substring(0, 200) ?? '',
  };
})()`,
            returnByValue: true,
          }, this.nextId()),
        ) as { url: string; title: string; bodyText: string } | null;

        const currentUrl = diagResult?.url ?? "unknown";
        if (currentUrl.includes("/messaging/compose")) {
          return {
            success: false,
            error: `Compose loaded but no recipient pill — cannot message this person (memberId=${memberId}, url=${currentUrl})`,
          };
        }
        return {
          success: false,
          error: `Compose redirect failed — landed on ${currentUrl} (title="${diagResult?.title}")`,
        };
      }

      // Step 6: Name verification — compare pill name to profile name
      if (profileName) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
        const normalizedPill = normalize(pillName);
        const normalizedProfile = normalize(profileName);

        this.log(`Name verification: pill="${pillName}" (${normalizedPill}) vs profile="${profileName}" (${normalizedProfile})`);

        if (!normalizedPill.startsWith(normalizedProfile) && !normalizedProfile.startsWith(normalizedPill)) {
          return {
            success: false,
            error: `Recipient mismatch: pill='${pillName}' profile='${profileName}'`,
          };
        }
        this.log("Name verification passed");
      } else {
        this.log("Skipping name verification — profile name not extracted");
      }

      // Step 7: Focus the message textbox
      const focusResult = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  const input = document.querySelector('div[role="textbox"][contenteditable="true"]');
  if (!input) {
    const allEditable = document.querySelectorAll('[contenteditable="true"]');
    return { found: false, editableCount: allEditable.length };
  }
  input.focus();
  input.click();
  return { found: true };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { found: boolean; editableCount?: number } | null;

      if (!focusResult?.found) {
        return { success: false, error: `Message textbox not found (${focusResult?.editableCount ?? 0} editables)` };
      }

      // Step 8: Type the message character by character using CDP Input.dispatchKeyEvent
      await this.sleep(500);
      for (const char of message) {
        await cdpSend(this.ws, "Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
        }, this.nextId());
        await cdpSend(this.ws, "Input.dispatchKeyEvent", {
          type: "keyUp",
          text: char,
        }, this.nextId());
        // Small delay between characters for realism
        await this.sleep(30 + Math.random() * 50);
      }

      this.log("Message typed via keyboard events");

      // Step 9: Verify the message was typed
      await this.sleep(1500);

      const verifyResult = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  const input = document.querySelector('div[role="textbox"][contenteditable="true"]');
  if (!input) return { found: false };
  const text = input.textContent?.trim() ?? '';
  return { found: true, hasText: text.length > 0, textLen: text.length, preview: text.substring(0, 30) };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { found: boolean; hasText?: boolean; textLen?: number; preview?: string } | null;

      if (!verifyResult?.found || !verifyResult?.hasText) {
        this.log(`Message not in textbox. Result: ${JSON.stringify(verifyResult)}`);
        return { success: false, error: `Message not typed (textLen=${verifyResult?.textLen ?? 0})` };
      }
      this.log(`Message in textbox: "${verifyResult.preview}..." (${verifyResult.textLen} chars)`);

      // Step 10: Press Enter to send
      await cdpSend(this.ws, "Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      }, this.nextId());
      await cdpSend(this.ws, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      }, this.nextId());

      // Step 11: Verify textbox cleared (message was sent)
      await this.sleep(2000);

      const afterSend = evalValue(
        await cdpSend(this.ws, "Runtime.evaluate", {
          expression: `(() => {
  const input = document.querySelector('div[role="textbox"][contenteditable="true"]');
  if (!input) return { cleared: true };
  const text = input.textContent?.trim() ?? '';
  return { cleared: text.length === 0, remainingLen: text.length };
})()`,
          returnByValue: true,
        }, this.nextId()),
      ) as { cleared: boolean; remainingLen?: number } | null;

      if (afterSend?.cleared) {
        this.log("Message sent (textbox cleared)");
      } else {
        this.log(`Textbox still has ${afterSend?.remainingLen} chars after Enter — message may still have sent`);
      }

      return {
        success: true,
        details: { memberId, recipientName: pillName },
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
