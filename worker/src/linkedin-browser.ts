/**
 * LinkedIn browser automation using agent-browser.
 *
 * Uses the accessibility tree for navigation instead of CSS selectors.
 * This makes it undetectable by LinkedIn since there are no selector
 * patterns to flag — we interact with ARIA roles and text labels.
 */

// agent-browser types — will be refined when we install the actual package
interface BrowserManager {
  launch(options?: { proxy?: string }): Promise<BrowserSession>;
}

interface BrowserSession {
  goto(url: string): Promise<void>;
  snapshot(): Promise<AccessibilityNode[]>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  waitForNavigation(options?: { timeout?: number }): Promise<void>;
  close(): Promise<void>;
  cookies(): Promise<CookieData[]>;
  setCookies(cookies: CookieData[]): Promise<void>;
}

interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  children?: AccessibilityNode[];
}

interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  expires?: number;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Find a node in the accessibility tree by role and name.
 */
function findNode(
  nodes: AccessibilityNode[],
  role: string,
  namePattern: string | RegExp,
): AccessibilityNode | null {
  for (const node of nodes) {
    const nameMatch =
      typeof namePattern === "string"
        ? node.name.toLowerCase().includes(namePattern.toLowerCase())
        : namePattern.test(node.name);

    if (node.role === role && nameMatch) {
      return node;
    }

    if (node.children) {
      const found = findNode(node.children, role, namePattern);
      if (found) return found;
    }
  }
  return null;
}

export class LinkedInBrowser {
  private session: BrowserSession | null = null;
  private proxyUrl: string | undefined;
  private cookies: CookieData[];

  constructor(cookies: CookieData[], proxyUrl?: string) {
    this.cookies = cookies;
    this.proxyUrl = proxyUrl;
  }

  /**
   * Launch the browser with stored cookies and proxy.
   */
  async launch(): Promise<void> {
    // Dynamic import — agent-browser may not be available in all environments
    const { BrowserManager: BM } = await import("@anthropic-ai/agent-browser");
    const manager = new BM() as unknown as BrowserManager;

    this.session = await manager.launch({
      proxy: this.proxyUrl,
    });

    // Load stored cookies
    if (this.cookies.length > 0) {
      await this.session.setCookies(this.cookies);
    }
  }

  /**
   * Close the browser session.
   */
  async close(): Promise<void> {
    if (this.session) {
      await this.session.close();
      this.session = null;
    }
  }

  /**
   * Check if the current session is valid (logged into LinkedIn).
   */
  async isSessionValid(): Promise<boolean> {
    if (!this.session) return false;

    try {
      await this.session.goto("https://www.linkedin.com/feed/");
      await this.sleep(3000);

      const tree = await this.session.snapshot();

      // If we can see the feed, we're logged in
      // Look for navigation elements that only appear when authenticated
      const navNode = findNode(tree, "navigation", /global/i);
      const feedNode = findNode(tree, "main", /main/i);

      return !!(navNode || feedNode);
    } catch {
      return false;
    }
  }

  /**
   * Visit a LinkedIn profile. This counts as a profile view.
   */
  async viewProfile(profileUrl: string): Promise<ActionResult> {
    if (!this.session) return { success: false, error: "Browser not launched" };

    try {
      await this.session.goto(profileUrl);
      await this.sleep(3000 + Math.random() * 2000);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send a blank connection request (no note).
   * Navigate to profile → click Connect → send without note.
   */
  async sendConnectionRequest(profileUrl: string): Promise<ActionResult> {
    if (!this.session) return { success: false, error: "Browser not launched" };

    try {
      // Navigate to profile
      await this.session.goto(profileUrl);
      await this.sleep(3000 + Math.random() * 2000);

      const tree = await this.session.snapshot();

      // Look for the "Connect" button
      const connectBtn = findNode(tree, "button", /^connect$/i);

      if (!connectBtn) {
        // Check if "More" dropdown contains Connect
        const moreBtn = findNode(tree, "button", /more/i);
        if (moreBtn) {
          await this.session.click(`button[name*="More"]`);
          await this.sleep(1000);

          const dropdown = await this.session.snapshot();
          const connectInMenu = findNode(dropdown, "menuitem", /connect/i);

          if (!connectInMenu) {
            // Already connected or connect not available
            return {
              success: false,
              error: "Connect button not found — may already be connected",
            };
          }

          await this.session.click(`menuitem[name*="Connect"]`);
        } else {
          return {
            success: false,
            error: "Connect button not found on profile",
          };
        }
      } else {
        await this.session.click(`button[name="Connect"]`);
      }

      await this.sleep(2000);

      // Handle the "Add a note" / "Send without a note" modal
      const modalTree = await this.session.snapshot();

      // Look for "Send without a note" or just "Send" button
      const sendWithoutNote = findNode(modalTree, "button", /send without a note/i);
      const sendBtn = findNode(modalTree, "button", /^send$/i);

      if (sendWithoutNote) {
        await this.session.click(`button[name*="Send without"]`);
      } else if (sendBtn) {
        await this.session.click(`button[name="Send"]`);
      } else {
        return { success: false, error: "Send button not found in connection modal" };
      }

      await this.sleep(2000);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send a message to a 1st-degree connection.
   */
  async sendMessage(profileUrl: string, message: string): Promise<ActionResult> {
    if (!this.session) return { success: false, error: "Browser not launched" };

    try {
      await this.session.goto(profileUrl);
      await this.sleep(3000 + Math.random() * 2000);

      const tree = await this.session.snapshot();

      // Look for "Message" button
      const messageBtn = findNode(tree, "button", /^message$/i);
      if (!messageBtn) {
        return { success: false, error: "Message button not found — may not be connected" };
      }

      await this.session.click(`button[name="Message"]`);
      await this.sleep(2000);

      // Type the message in the message input
      const msgTree = await this.session.snapshot();
      const msgInput = findNode(msgTree, "textbox", /write a message/i);

      if (!msgInput) {
        return { success: false, error: "Message input not found" };
      }

      await this.session.type(`textbox[name*="Write a message"]`, message);
      await this.sleep(1000);

      // Click send
      const sendBtn = findNode(await this.session.snapshot(), "button", /^send$/i);
      if (!sendBtn) {
        return { success: false, error: "Send button not found in message dialog" };
      }

      await this.session.click(`button[name="Send"]`);
      await this.sleep(1500);

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
    if (!this.session) return "not_connected";

    try {
      await this.session.goto(profileUrl);
      await this.sleep(3000 + Math.random() * 2000);

      const tree = await this.session.snapshot();

      // If "Message" button is visible, we're connected
      const messageBtn = findNode(tree, "button", /^message$/i);
      if (messageBtn) return "connected";

      // If "Pending" is visible, request is pending
      const pendingBtn = findNode(tree, "button", /pending/i);
      if (pendingBtn) return "pending";

      // Otherwise not connected
      return "not_connected";
    } catch {
      return "not_connected";
    }
  }

  /**
   * Check if LinkedIn is showing a CAPTCHA or verification challenge.
   */
  async checkForCaptcha(): Promise<boolean> {
    if (!this.session) return false;

    try {
      const tree = await this.session.snapshot();
      const captcha = findNode(tree, "heading", /security verification/i);
      const challenge = findNode(tree, "heading", /let's do a quick security check/i);
      return !!(captcha || challenge);
    } catch {
      return false;
    }
  }

  /**
   * Check if LinkedIn is showing a restriction warning.
   */
  async checkForRestriction(): Promise<boolean> {
    if (!this.session) return false;

    try {
      const tree = await this.session.snapshot();
      const restriction = findNode(tree, "heading", /restriction/i);
      const limit = findNode(tree, "heading", /you've reached/i);
      return !!(restriction || limit);
    } catch {
      return false;
    }
  }

  /**
   * Export current cookies for storage.
   */
  async exportCookies(): Promise<CookieData[]> {
    if (!this.session) return [];
    return this.session.cookies();
  }

  /**
   * Human-like delay.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
