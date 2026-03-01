/**
 * LinkedIn browser automation using agent-browser (Vercel Labs).
 *
 * Uses the agent-browser CLI tool which provides accessibility-tree-based
 * browser automation. Each sender gets an isolated session via --session flag.
 *
 * Key design decisions (from rewrite brief 2026-02-27):
 * - Profile URL is the identity: every action starts by navigating to the
 *   target's profile URL. No name search, no autocomplete.
 * - Hybrid messaging: extract member URN from profile page source, then
 *   navigate to compose URL with ?recipientUrn= (not profile Message button).
 * - Enter key to send: LinkedIn's Send button is a compound split button with
 *   label "Open send options". Enter key sends reliably.
 * - Profile buttons may not render in headless: connection requests fall back
 *   to the More dropdown, then to a retry with delay.
 */

import { execFileSync } from "child_process";

export interface ActionResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export type ConnectionStatus =
  | "connected"
  | "pending"
  | "not_connected"
  | "not_connectable"
  | "unknown";

interface SnapshotElement {
  ref: string;
  role: string;
  text: string;
  raw: string;
}

/** Cached URN data for a profile to avoid re-extraction. */
interface CachedProfile {
  memberUrn: string;
  name: string | null;
  extractedAt: number;
}

export class LinkedInBrowser {
  private session: string;
  private proxyUrl: string | undefined;
  private launched = false;
  private urnCache: Map<string, CachedProfile> = new Map();

  /** URN cache TTL: 30 minutes */
  private static readonly URN_CACHE_TTL = 30 * 60 * 1000;

  /** Default command timeout: 30 seconds */
  private static readonly CMD_TIMEOUT = 30_000;

  /** Extended timeout for page loads: 45 seconds */
  private static readonly NAV_TIMEOUT = 45_000;

  /**
   * Constructor matches the old CDP-based API signature so worker.ts
   * does not need changes. The cookies param is accepted but not used
   * directly — agent-browser manages session state internally via
   * named sessions.
   */
  constructor(_cookies: unknown[], proxyUrl?: string) {
    this.session = "default";
    this.proxyUrl = proxyUrl;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private log(msg: string): void {
    console.log(`[LinkedInBrowser] ${msg}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute an agent-browser CLI command synchronously.
   * Returns stdout as a string.
   */
  private exec(command: string, timeoutMs = LinkedInBrowser.CMD_TIMEOUT): string {
    const args = ["--session", this.session];

    if (this.proxyUrl) {
      args.push("--proxy", this.proxyUrl);
    }

    // Split command string into individual args
    const cmdParts = this.parseCommand(command);
    args.push(...cmdParts);

    try {
      const result = execFileSync("agent-browser", args, {
        encoding: "utf-8",
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB for large snapshots
      });
      return result.trim();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("TIMEOUT") || msg.includes("timed out")) {
        this.log(`Command timed out: ${command}`);
      } else {
        this.log(`Command failed: ${command} -- ${msg.substring(0, 200)}`);
      }
      throw error;
    }
  }

  /**
   * Parse a command string into args, respecting quoted strings.
   * e.g. 'fill @e3 "Hello world"' -> ['fill', '@e3', 'Hello world']
   */
  private parseCommand(command: string): string[] {
    const args: string[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];

      if (!inQuotes && (ch === '"' || ch === "'")) {
        inQuotes = true;
        quoteChar = ch;
      } else if (inQuotes && ch === quoteChar) {
        inQuotes = false;
        quoteChar = "";
      } else if (!inQuotes && ch === " ") {
        if (current.length > 0) {
          args.push(current);
          current = "";
        }
      } else {
        current += ch;
      }
    }

    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }

  /**
   * Parse agent-browser snapshot output into structured elements.
   *
   * Snapshot format:
   *   @e1 button "Connect"
   *   @e2 link "April Newman"
   *   @e3 textbox "Message"
   */
  private parseSnapshot(snapshot: string): SnapshotElement[] {
    const elements: SnapshotElement[] = [];
    const lines = snapshot.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("@")) continue;

      // Match: @eN role "text" or @eN role 'text' or @eN role text
      const match = trimmed.match(/^(@e\d+)\s+(\S+)\s+(?:"([^"]*)"|'([^']*)'|(.+))$/);
      if (match) {
        elements.push({
          ref: match[1],
          role: match[2],
          text: match[3] ?? match[4] ?? match[5] ?? "",
          raw: trimmed,
        });
      } else {
        // Simpler format: @eN role (no text)
        const simpleMatch = trimmed.match(/^(@e\d+)\s+(\S+)$/);
        if (simpleMatch) {
          elements.push({
            ref: simpleMatch[1],
            role: simpleMatch[2],
            text: "",
            raw: trimmed,
          });
        }
      }
    }

    return elements;
  }

  /**
   * Find an element in a snapshot by text content (case-insensitive partial match).
   */
  private findElement(
    elements: SnapshotElement[],
    text: string,
    role?: string,
  ): SnapshotElement | null {
    const needle = text.toLowerCase();
    return (
      elements.find((el) => {
        const textMatch =
          el.text.toLowerCase().includes(needle) ||
          el.raw.toLowerCase().includes(needle);
        if (role) {
          return textMatch && el.role.toLowerCase() === role.toLowerCase();
        }
        return textMatch;
      }) ?? null
    );
  }

  /**
   * Find an element by exact text match (case-insensitive).
   */
  private findElementExact(
    elements: SnapshotElement[],
    text: string,
    role?: string,
  ): SnapshotElement | null {
    const needle = text.toLowerCase();
    return (
      elements.find((el) => {
        const textMatch = el.text.toLowerCase().trim() === needle;
        if (role) {
          return textMatch && el.role.toLowerCase() === role.toLowerCase();
        }
        return textMatch;
      }) ?? null
    );
  }

  /**
   * Navigate to a URL and wait for the page to load.
   * Returns the final URL after any redirects.
   */
  private async navigateTo(url: string): Promise<string> {
    this.exec(`open ${url}`, LinkedInBrowser.NAV_TIMEOUT);
    await this.sleep(1000);

    // Wait for network to settle
    try {
      this.exec("wait --load networkidle", LinkedInBrowser.NAV_TIMEOUT);
    } catch {
      // networkidle timeout is non-fatal -- page may still be usable
      this.log("networkidle wait timed out -- continuing");
    }

    // Get final URL
    const finalUrl = this.exec("get url");
    return finalUrl;
  }

  /**
   * Check if the current page is a login/challenge page (session expired).
   */
  private isLoginPage(url: string): boolean {
    return (
      url.includes("/login") ||
      url.includes("/authwall") ||
      url.includes("/checkpoint") ||
      url.includes("/challenge")
    );
  }

  /**
   * Extract the profile slug from a LinkedIn profile URL.
   */
  private extractSlug(profileUrl: string): string | null {
    const match = profileUrl.match(/\/in\/([^/?#]+)/);
    return match ? match[1].replace(/\/$/, "") : null;
  }

  /**
   * Get a cached URN for a profile URL, or null if expired/missing.
   */
  private getCachedUrn(profileUrl: string): CachedProfile | null {
    const cached = this.urnCache.get(profileUrl);
    if (!cached) return null;
    if (Date.now() - cached.extractedAt > LinkedInBrowser.URN_CACHE_TTL) {
      this.urnCache.delete(profileUrl);
      return null;
    }
    return cached;
  }

  // ---------------------------------------------------------------------------
  // URN Extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract the member URN from the current page's HTML source.
   *
   * LinkedIn embeds URNs in JSON-LD and preloaded data within the page source.
   * This works even when profile header buttons don't render in headless mode.
   */
  private async extractMemberUrn(
    profileUrl: string,
  ): Promise<{ memberUrn: string; name: string | null } | null> {
    // Check cache first
    const cached = this.getCachedUrn(profileUrl);
    if (cached) {
      this.log(`URN cache hit: ${cached.memberUrn}`);
      return { memberUrn: cached.memberUrn, name: cached.name };
    }

    // Primary: extract fsd_profile URN from page source
    try {
      const urn = this.exec(
        `eval "document.body.innerHTML.match(/urn:li:fsd_profile:([A-Za-z0-9_-]+)/)?.[1] || ''"`,
      );

      if (urn && urn.length > 0) {
        // Also try to extract name from page title
        let name: string | null = null;
        try {
          const title = this.exec("get title");
          // LinkedIn title format: "First Last | LinkedIn"
          const nameMatch = title.match(/^(.+?)(?:\s*[-|])/);
          if (nameMatch) {
            name = nameMatch[1].trim();
          }
        } catch {
          // Name extraction is best-effort
        }

        this.urnCache.set(profileUrl, {
          memberUrn: urn,
          name,
          extractedAt: Date.now(),
        });
        this.log(`Extracted URN: ${urn}, name: ${name}`);
        return { memberUrn: urn, name };
      }
    } catch (error) {
      this.log(`Primary URN extraction failed: ${error}`);
    }

    // Fallback: try data-member-id attribute
    try {
      const memberId = this.exec(
        `eval "document.querySelector('[data-member-id]')?.dataset?.memberId || ''"`,
      );

      if (memberId && memberId.length > 0) {
        this.urnCache.set(profileUrl, {
          memberUrn: memberId,
          name: null,
          extractedAt: Date.now(),
        });
        this.log(`Extracted member ID (fallback): ${memberId}`);
        return { memberUrn: memberId, name: null };
      }
    } catch {
      // Fallback failed
    }

    // Second fallback: try fs_miniProfile URN
    try {
      const miniUrn = this.exec(
        `eval "document.body.innerHTML.match(/urn:li:fs_miniProfile:([A-Za-z0-9_-]+)/)?.[1] || ''"`,
      );

      if (miniUrn && miniUrn.length > 0) {
        this.urnCache.set(profileUrl, {
          memberUrn: miniUrn,
          name: null,
          extractedAt: Date.now(),
        });
        this.log(`Extracted miniProfile URN (fallback 2): ${miniUrn}`);
        return { memberUrn: miniUrn, name: null };
      }
    } catch {
      // All extraction methods failed
    }

    this.log("All URN extraction methods failed");
    return null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Launch the browser session and navigate to LinkedIn feed.
   *
   * Loads the named session (which preserves cookies from prior logins).
   * Verifies the session is valid by checking we land on /feed/.
   */
  async launch(): Promise<void> {
    this.log("Launching agent-browser session...");

    try {
      // Navigate to the feed to validate the session
      const url = await this.navigateTo("https://www.linkedin.com/feed/");

      if (this.isLoginPage(url)) {
        throw new Error(
          "LinkedIn session is expired or invalid -- landed on login page",
        );
      }

      this.launched = true;
      this.log("Launch complete -- session is valid");
    } catch (error) {
      this.log(`Launch failed: ${error}`);
      throw error;
    }
  }

  /**
   * Set the session name based on sender ID.
   * Must be called before launch() to isolate sessions per sender.
   */
  setSenderId(senderId: string): void {
    this.session = `sender-${senderId}`;
  }

  /**
   * Tear down the browser session.
   */
  async close(): Promise<void> {
    try {
      this.exec("close");
    } catch {
      // close may fail if browser already terminated
    }
    this.launched = false;
    this.urnCache.clear();
    this.log("Closed");
  }

  // ---------------------------------------------------------------------------
  // Session validation
  // ---------------------------------------------------------------------------

  /**
   * Check if the current session is valid (logged into LinkedIn).
   */
  async isSessionValid(): Promise<boolean> {
    try {
      const url = await this.navigateTo("https://www.linkedin.com/feed/");
      const valid = url.includes("/feed");
      this.log(`Session check: ${valid ? "valid" : "invalid"} (url: ${url})`);
      return valid;
    } catch (error) {
      this.log(`Session check failed: ${error}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Visit a LinkedIn profile (counts as a profile view).
   *
   * Also extracts and caches the member URN for subsequent actions.
   */
  async viewProfile(profileUrl: string): Promise<ActionResult> {
    if (!this.launched) return { success: false, error: "Browser not launched" };

    try {
      this.log(`Viewing profile: ${profileUrl}`);

      const landedUrl = await this.navigateTo(profileUrl);

      if (this.isLoginPage(landedUrl)) {
        return {
          success: false,
          error: "Session expired -- redirected to login",
        };
      }

      if (landedUrl.includes("/404") || landedUrl.includes("page-not-found")) {
        return { success: false, error: "Profile not found (404)" };
      }

      // Wait for profile content to render
      await this.sleep(2000 + Math.random() * 2000);

      // Extract and cache URN while we're on the profile
      const urnResult = await this.extractMemberUrn(profileUrl);

      return {
        success: true,
        details: {
          landedUrl,
          memberUrn: urnResult?.memberUrn ?? null,
          name: urnResult?.name ?? null,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send a connection request to a LinkedIn profile.
   *
   * Strategy:
   * 1. Navigate to profile
   * 2. Look for Connect button in accessibility snapshot
   * 3. If not found, try More dropdown
   * 4. Handle the connection modal (with or without note)
   *
   * Falls back gracefully when profile buttons don't render
   * (known headless Chrome issue with LinkedIn SPA).
   */
  async sendConnectionRequest(
    profileUrl: string,
    note?: string,
  ): Promise<ActionResult> {
    try {
      this.log(`Sending connection request: ${profileUrl}`);

      // Navigate to profile
      const landedUrl = await this.navigateTo(profileUrl);

      if (this.isLoginPage(landedUrl)) {
        return {
          success: false,
          error: "Session expired -- redirected to login",
        };
      }

      if (!landedUrl.includes("/in/")) {
        return {
          success: false,
          error: `Navigation failed -- landed on ${landedUrl}`,
        };
      }

      // Wait for profile to render
      await this.sleep(2000 + Math.random() * 1000);

      // Get interactive elements
      let snapshot: string;
      let elements: SnapshotElement[];

      try {
        snapshot = this.exec("snapshot -i");
        elements = this.parseSnapshot(snapshot);
      } catch (error) {
        return {
          success: false,
          error: `Failed to get page snapshot: ${error}`,
        };
      }

      // Check if already connected (Message button present)
      const messageBtn = this.findElementExact(elements, "Message", "button");
      if (messageBtn) {
        this.log("Already connected -- Message button found");
        return { success: true, details: { already_connected: true } };
      }

      // Check if already pending
      const pendingBtn = this.findElement(elements, "Pending");
      if (pendingBtn) {
        this.log("Connection request already pending");
        return { success: true, details: { already_pending: true } };
      }

      // Look for Connect button
      let connectClicked = false;
      const connectBtn = this.findElementExact(elements, "Connect", "button");

      if (connectBtn) {
        this.log(`Found Connect button: ${connectBtn.ref}`);
        this.exec(`click ${connectBtn.ref}`);
        connectClicked = true;
      } else {
        // Try the More dropdown
        this.log("Connect not found directly, trying More dropdown...");
        const moreBtn = this.findElement(elements, "More", "button");

        if (moreBtn) {
          this.exec(`click ${moreBtn.ref}`);
          await this.sleep(1500);

          // Re-snapshot to find Connect in dropdown
          const dropdownSnapshot = this.exec("snapshot -i");
          const dropdownElements = this.parseSnapshot(dropdownSnapshot);

          const connectInMenu = this.findElement(dropdownElements, "Connect");
          if (connectInMenu) {
            this.log(`Found Connect in dropdown: ${connectInMenu.ref}`);
            this.exec(`click ${connectInMenu.ref}`);
            connectClicked = true;
          }
        }
      }

      if (!connectClicked) {
        // Final retry: wait for rendering and try snapshot again
        this.log(
          "No Connect button found -- waiting 5s for rendering retry...",
        );
        await this.sleep(5000);

        const retrySnapshot = this.exec("snapshot -i");
        const retryElements = this.parseSnapshot(retrySnapshot);

        const retryConnect = this.findElementExact(
          retryElements,
          "Connect",
          "button",
        );
        if (retryConnect) {
          this.exec(`click ${retryConnect.ref}`);
          connectClicked = true;
        } else {
          return {
            success: false,
            error:
              "Connect button not found -- may already be connected or profile not rendered",
            details: { profile_not_rendered: true, retry: true },
          };
        }
      }

      // Handle connection modal
      await this.sleep(2000);

      const modalSnapshot = this.exec("snapshot -i");
      const modalElements = this.parseSnapshot(modalSnapshot);

      if (note) {
        // Click "Add a note" if available
        const addNoteBtn = this.findElement(modalElements, "Add a note");
        if (addNoteBtn) {
          this.exec(`click ${addNoteBtn.ref}`);
          await this.sleep(1000);

          // Find the note text input
          const noteSnapshot = this.exec("snapshot -i");
          const noteElements = this.parseSnapshot(noteSnapshot);
          const noteInput = noteElements.find(
            (el) => el.role === "textbox" || el.role === "textarea",
          );

          if (noteInput) {
            const safeNote = note.replace(/"/g, '\\"');
            this.exec(`fill ${noteInput.ref} "${safeNote}"`);
            await this.sleep(500);
          }
        }

        // Click Send button (re-snapshot since modal may have changed)
        const sendSnapshot = this.exec("snapshot -i");
        const sendElements = this.parseSnapshot(sendSnapshot);
        const sendBtn =
          this.findElement(sendElements, "Send") ??
          this.findElement(modalElements, "Send");
        if (sendBtn) {
          this.exec(`click ${sendBtn.ref}`);
        }
      } else {
        // No note -- click "Send without a note" or just "Send"
        const sendWithoutNote = this.findElement(
          modalElements,
          "Send without a note",
        );
        const sendBtn =
          sendWithoutNote ??
          this.findElementExact(modalElements, "Send", "button");

        if (sendBtn) {
          this.exec(`click ${sendBtn.ref}`);
        } else {
          // Try pressing Enter as fallback
          this.log("Send button not found in modal -- trying Enter key");
          this.exec("press Enter");
        }
      }

      await this.sleep(2000);
      this.log("Connection request sent");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send a message to a LinkedIn profile.
   *
   * Uses the hybrid approach from the rewrite brief:
   * 1. Navigate to profile to extract member URN (or use cache)
   * 2. Navigate to compose URL with ?recipientUrn=urn:li:fsd_profile:{urn}
   * 3. Type message in the compose input
   * 4. Press Enter to send (NOT clicking the Send button)
   *
   * This avoids the broken compose-autocomplete approach entirely.
   * The profile URL is the identity. The URN is the key to direct messaging.
   */
  async sendMessage(profileUrl: string, message: string): Promise<ActionResult> {
    if (!profileUrl.includes("/in/")) {
      return {
        success: false,
        error: `Invalid profile URL (missing /in/): ${profileUrl}`,
      };
    }

    try {
      this.log(`Sending message to: ${profileUrl}`);

      // Step 1: Get the member URN (from cache or by visiting profile)
      let urnData = this.getCachedUrn(profileUrl);

      if (!urnData) {
        this.log("URN not cached -- visiting profile to extract...");
        const landedUrl = await this.navigateTo(profileUrl);

        if (this.isLoginPage(landedUrl)) {
          return {
            success: false,
            error: "Session expired -- redirected to login",
          };
        }

        // Wait for profile page to load
        await this.sleep(2000 + Math.random() * 1000);

        const extracted = await this.extractMemberUrn(profileUrl);
        if (!extracted || !extracted.memberUrn) {
          return {
            success: false,
            error: `Failed to extract member URN from profile: ${profileUrl}`,
          };
        }
        urnData = { ...extracted, extractedAt: Date.now() };
      }

      const { memberUrn, name: recipientName } = urnData;
      this.log(
        `Using URN: ${memberUrn} for recipient: ${recipientName ?? "unknown"}`,
      );

      // Step 2: Navigate to compose URL with recipient pre-filled
      // This is the key insight: the compose URL pre-fills the recipient
      // without needing to click the Message button on the profile page
      // (which often doesn't render in headless Chrome)
      const composeUrl = `https://www.linkedin.com/messaging/compose/?recipientUrn=urn:li:fsd_profile:${memberUrn}`;
      const composeResult = await this.navigateTo(composeUrl);

      if (this.isLoginPage(composeResult)) {
        return {
          success: false,
          error: "Session expired -- redirected to login",
        };
      }

      if (!composeResult.includes("/messaging")) {
        return {
          success: false,
          error: `Compose page did not load -- landed on: ${composeResult}`,
        };
      }

      // Wait for compose UI to fully render
      await this.sleep(3000);

      // Step 3: Find the message input and type
      const snapshot = this.exec("snapshot -i");
      const elements = this.parseSnapshot(snapshot);

      // Look for the message textbox
      let messageInput = elements.find(
        (el) =>
          el.role === "textbox" ||
          el.role === "textarea" ||
          el.text.toLowerCase().includes("message") ||
          el.raw.toLowerCase().includes("contenteditable"),
      );

      if (!messageInput) {
        // Check if "can't message this person" is displayed
        const cantMessage = this.findElement(elements, "can't message");
        if (cantMessage) {
          return {
            success: false,
            error: "Cannot message this person -- not connected or blocked",
            details: { should_connect_first: true },
          };
        }

        // Retry once after a short wait
        this.log("Message input not found -- retrying after 3s...");
        await this.sleep(3000);
        const retrySnapshot = this.exec("snapshot -i");
        const retryElements = this.parseSnapshot(retrySnapshot);
        messageInput = retryElements.find(
          (el) => el.role === "textbox" || el.role === "textarea",
        );

        if (!messageInput) {
          return {
            success: false,
            error: "Message input not found in compose view",
          };
        }
      }

      // Click to focus, then fill
      this.exec(`click ${messageInput.ref}`);
      await this.sleep(500);
      const safeMessage = message.replace(/"/g, '\\"');
      this.exec(`fill ${messageInput.ref} "${safeMessage}"`);

      await this.sleep(1000);

      // Step 4: Press Enter to send
      // CRITICAL: Do NOT try to find/click a "Send" button. LinkedIn's Send
      // button is a compound split button with accessible label "Open send
      // options", not "Send". Enter key sends reliably. This was proven
      // in Railway debugging 2026-02-27.
      this.log("Pressing Enter to send message...");
      this.exec("press Enter");

      await this.sleep(2000);

      // Verify: check we're still on messaging page
      const finalUrl = this.exec("get url");
      if (!finalUrl.includes("/messaging")) {
        this.log(
          `Warning: after send, URL is ${finalUrl} (expected /messaging/)`,
        );
      }

      this.log("Message sent successfully");
      return {
        success: true,
        details: { memberUrn, recipientName },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Check the connection status with a profile.
   *
   * Navigates to the profile and reads the button state from the
   * accessibility snapshot. Falls back to "unknown" when buttons
   * don't render (known headless rendering issue).
   */
  async checkConnectionStatus(
    profileUrl: string,
  ): Promise<ConnectionStatus> {
    try {
      this.log(`Checking connection status: ${profileUrl}`);

      const landedUrl = await this.navigateTo(profileUrl);

      if (this.isLoginPage(landedUrl)) {
        this.log("Session expired during connection check");
        return "unknown";
      }

      // Wait for profile to render
      await this.sleep(2000 + Math.random() * 1000);

      let elements: SnapshotElement[];

      try {
        const snapshot = this.exec("snapshot -i");
        elements = this.parseSnapshot(snapshot);
      } catch {
        return "unknown";
      }

      // Check for Message button -> connected
      if (this.findElementExact(elements, "Message", "button")) {
        return "connected";
      }

      // Check for Pending -> pending
      if (this.findElement(elements, "Pending")) {
        return "pending";
      }

      // Check for Connect -> not connected
      if (this.findElementExact(elements, "Connect", "button")) {
        return "not_connected";
      }

      // Check for Follow only (creator mode, no Connect available)
      if (
        this.findElementExact(elements, "Follow", "button") &&
        !this.findElement(elements, "Connect")
      ) {
        return "not_connectable";
      }

      // No action buttons found -- retry once after waiting
      this.log("No action buttons found -- retrying after 3s...");
      await this.sleep(3000);

      try {
        const retrySnapshot = this.exec("snapshot -i");
        const retryElements = this.parseSnapshot(retrySnapshot);

        if (this.findElementExact(retryElements, "Message", "button"))
          return "connected";
        if (this.findElement(retryElements, "Pending")) return "pending";
        if (this.findElementExact(retryElements, "Connect", "button"))
          return "not_connected";
      } catch {
        // Retry failed
      }

      this.log("Could not determine connection status -- returning unknown");
      return "unknown";
    } catch (error) {
      this.log(`Connection status check failed: ${error}`);
      return "unknown";
    }
  }

  // ---------------------------------------------------------------------------
  // Post engagement (new actions)
  // ---------------------------------------------------------------------------

  /**
   * Like the most recent post by a person.
   *
   * Navigates to the person's recent activity page and clicks the
   * Like button on their first post.
   */
  async likePost(profileUrl: string): Promise<ActionResult> {
    try {
      const slug = this.extractSlug(profileUrl);
      if (!slug) {
        return { success: false, error: "Invalid profile URL" };
      }

      const activityUrl = `https://www.linkedin.com/in/${slug}/recent-activity/all/`;
      this.log(`Liking post: ${activityUrl}`);

      const landedUrl = await this.navigateTo(activityUrl);

      if (this.isLoginPage(landedUrl)) {
        return { success: false, error: "Session expired" };
      }

      // Wait for activity feed to render
      await this.sleep(3000);

      const snapshot = this.exec("snapshot -i");
      const elements = this.parseSnapshot(snapshot);

      // Find the first Like button
      const likeBtn = this.findElement(elements, "Like", "button");

      if (!likeBtn) {
        return {
          success: false,
          error: "No Like button found -- person may have no recent posts",
        };
      }

      this.exec(`click ${likeBtn.ref}`);
      await this.sleep(1500);

      this.log("Post liked successfully");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Comment on the most recent post by a person.
   *
   * Navigates to the person's recent activity page, clicks Comment
   * on the first post, types the comment, and submits.
   */
  async commentOnPost(
    profileUrl: string,
    comment: string,
  ): Promise<ActionResult> {
    try {
      const slug = this.extractSlug(profileUrl);
      if (!slug) {
        return { success: false, error: "Invalid profile URL" };
      }

      const activityUrl = `https://www.linkedin.com/in/${slug}/recent-activity/all/`;
      this.log(`Commenting on post: ${activityUrl}`);

      const landedUrl = await this.navigateTo(activityUrl);

      if (this.isLoginPage(landedUrl)) {
        return { success: false, error: "Session expired" };
      }

      // Wait for activity feed to render
      await this.sleep(3000);

      const snapshot = this.exec("snapshot -i");
      const elements = this.parseSnapshot(snapshot);

      // Find the first Comment button
      const commentBtn = this.findElement(elements, "Comment", "button");

      if (!commentBtn) {
        return {
          success: false,
          error: "No Comment button found -- person may have no recent posts",
        };
      }

      // Click Comment to open the comment input
      this.exec(`click ${commentBtn.ref}`);
      await this.sleep(2000);

      // Find the comment input
      const commentSnapshot = this.exec("snapshot -i");
      const commentElements = this.parseSnapshot(commentSnapshot);

      const commentInput = commentElements.find(
        (el) => el.role === "textbox" || el.role === "textarea",
      );

      if (!commentInput) {
        return { success: false, error: "Comment input not found" };
      }

      // Type the comment
      this.exec(`click ${commentInput.ref}`);
      await this.sleep(500);
      const safeComment = comment.replace(/"/g, '\\"');
      this.exec(`fill ${commentInput.ref} "${safeComment}"`);
      await this.sleep(1000);

      // Find and click the Post/Submit button for the comment
      const postSnapshot = this.exec("snapshot -i");
      const postElements = this.parseSnapshot(postSnapshot);

      const postBtn =
        this.findElementExact(postElements, "Post", "button") ??
        this.findElement(postElements, "Submit", "button") ??
        this.findElement(postElements, "Post comment", "button");

      if (postBtn) {
        this.exec(`click ${postBtn.ref}`);
      } else {
        // Fallback: press Enter to submit
        this.log("Post button not found -- trying Enter key");
        this.exec("press Enter");
      }

      await this.sleep(2000);

      this.log("Comment posted successfully");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ---------------------------------------------------------------------------
  // Safety checks
  // ---------------------------------------------------------------------------

  /**
   * Check if LinkedIn is showing a CAPTCHA or verification challenge.
   */
  async checkForCaptcha(): Promise<boolean> {
    try {
      const url = this.exec("get url");
      if (url.includes("/checkpoint") || url.includes("/challenge")) {
        return true;
      }

      const title = this.exec("get title");
      if (title.toLowerCase().includes("security verification")) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if LinkedIn is showing a restriction warning.
   */
  async checkForRestriction(): Promise<boolean> {
    try {
      const snapshot = this.exec("snapshot -i");
      const lower = snapshot.toLowerCase();
      return lower.includes("restriction") || lower.includes("you've reached");
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Cookie management (compatibility)
  // ---------------------------------------------------------------------------

  /**
   * Export current cookies.
   *
   * With agent-browser, session state is managed internally via named sessions.
   * This method is kept for API compatibility with worker.ts but returns
   * cookies extracted via JavaScript execution in the browser context.
   */
  async exportCookies(): Promise<
    Array<{ name: string; value: string; domain: string }>
  > {
    try {
      const cookieStr = this.exec(
        `eval "JSON.stringify(document.cookie.split('; ').map(c => { const [n,...v] = c.split('='); return {name:n, value:v.join('='), domain:'.linkedin.com'}; }))"`,
      );

      try {
        return JSON.parse(cookieStr);
      } catch {
        return [];
      }
    } catch {
      this.log("Failed to export cookies");
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Session state management
  // ---------------------------------------------------------------------------

  /**
   * Save the current session state to a file for backup.
   */
  async saveSessionState(): Promise<void> {
    try {
      this.exec(`state save ${this.session}.json`);
      this.log("Session state saved");
    } catch (error) {
      this.log(`Failed to save session state: ${error}`);
    }
  }

  /**
   * Load session state from a backup file.
   */
  async loadSessionState(): Promise<boolean> {
    try {
      this.exec(`state load ${this.session}.json`);
      this.log("Session state loaded");
      return true;
    } catch {
      this.log("No saved session state found");
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Login flow
  // ---------------------------------------------------------------------------

  /**
   * Log into LinkedIn with email, password, and optional TOTP 2FA.
   *
   * Uses agent-browser to drive the login flow:
   * 1. Navigate to LinkedIn login page
   * 2. Fill email and password via accessibility refs
   * 3. Click sign in
   * 4. Handle TOTP 2FA if challenged
   * 5. Verify redirect to /feed/
   * 6. Save session state
   */
  async login(
    email: string,
    password: string,
    totpSecret?: string,
  ): Promise<boolean> {
    try {
      this.log("Starting login flow...");

      // Navigate to login page
      await this.navigateTo("https://www.linkedin.com/login");
      await this.sleep(2000);

      // Get login form elements
      const snapshot = this.exec("snapshot -i");
      const elements = this.parseSnapshot(snapshot);

      // Find email field
      const emailInput = elements.find(
        (el) =>
          el.role === "textbox" &&
          (el.text.toLowerCase().includes("email") ||
            el.text.toLowerCase().includes("phone") ||
            el.raw.toLowerCase().includes("username")),
      );

      if (!emailInput) {
        this.log("Email input not found on login page");
        return false;
      }

      // Find password field
      const passwordInput = elements.find((el) =>
        el.raw.toLowerCase().includes("password"),
      );

      if (!passwordInput) {
        this.log("Password input not found on login page");
        return false;
      }

      // Fill credentials
      const safeEmail = email.replace(/"/g, '\\"');
      const safePassword = password.replace(/"/g, '\\"');

      this.exec(`fill ${emailInput.ref} "${safeEmail}"`);
      await this.sleep(500);
      this.exec(`fill ${passwordInput.ref} "${safePassword}"`);
      await this.sleep(500);

      // Find and click sign-in button
      const signInBtn =
        this.findElement(elements, "Sign in", "button") ??
        this.findElement(elements, "Log in", "button");

      if (signInBtn) {
        this.exec(`click ${signInBtn.ref}`);
      } else {
        this.exec("press Enter");
      }

      // Wait for navigation
      await this.sleep(5000);

      // Check URL for 2FA challenge
      const postLoginUrl = this.exec("get url");
      this.log(`Post-login URL: ${postLoginUrl}`);

      if (
        postLoginUrl.includes("/checkpoint") ||
        postLoginUrl.includes("/challenge")
      ) {
        if (!totpSecret) {
          this.log("2FA challenge detected but no TOTP secret provided");
          return false;
        }

        this.log("Handling 2FA challenge...");

        // Generate TOTP code
        const { TOTP } = await import("otpauth");
        const totp = new TOTP({
          secret: totpSecret,
          digits: 6,
          period: 30,
          algorithm: "SHA1",
        });
        const code = totp.generate();
        this.log(`TOTP code generated: ${code}`);

        await this.sleep(2000);

        // Find the verification input
        const tfaSnapshot = this.exec("snapshot -i");
        const tfaElements = this.parseSnapshot(tfaSnapshot);

        const pinInput = tfaElements.find(
          (el) =>
            el.role === "textbox" ||
            el.raw.toLowerCase().includes("pin") ||
            el.raw.toLowerCase().includes("verification"),
        );

        if (pinInput) {
          this.exec(`fill ${pinInput.ref} "${code}"`);
          await this.sleep(500);

          // Find submit button
          const submitBtn =
            this.findElement(tfaElements, "Submit", "button") ??
            this.findElement(tfaElements, "Verify", "button");

          if (submitBtn) {
            this.exec(`click ${submitBtn.ref}`);
          } else {
            this.exec("press Enter");
          }

          await this.sleep(5000);
        } else {
          this.log("2FA input not found");
          return false;
        }
      }

      // Verify we're logged in
      const finalUrl = this.exec("get url");
      const loggedIn =
        finalUrl.includes("/feed") ||
        finalUrl.includes("/mynetwork") ||
        finalUrl.includes("/messaging") ||
        finalUrl.includes("/in/");

      if (loggedIn) {
        this.log("Login successful");
        await this.saveSessionState();
        this.launched = true;
        return true;
      }

      this.log(`Login failed -- final URL: ${finalUrl}`);
      return false;
    } catch (error) {
      this.log(`Login error: ${error}`);
      return false;
    }
  }
}
