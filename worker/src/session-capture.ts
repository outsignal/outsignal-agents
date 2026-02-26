/**
 * Session Capture — detects LinkedIn login and extracts cookies via CDP.
 *
 * Monitors Chrome DevTools Protocol to detect when the user has
 * successfully logged into LinkedIn (URL contains /feed or /mynetwork).
 * Extracts all LinkedIn cookies for encrypted storage.
 */

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

export interface CapturedSession {
  cookies: CdpCookie[];
  capturedAt: string;
}

export class SessionCapture {
  private cdpPort: number;
  private monitoring = false;

  constructor(cdpPort: number) {
    this.cdpPort = cdpPort;
  }

  /**
   * Wait for the user to log in to LinkedIn.
   * Polls CDP every 3 seconds to check the page URL.
   * Returns extracted cookies when login is detected.
   *
   * @param timeoutMs - Max time to wait (default 5 minutes)
   */
  async waitForLogin(timeoutMs: number = 300_000): Promise<CapturedSession> {
    this.monitoring = true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.monitoring = false;
        reject(new Error("Login timeout — user did not log in within the allowed time"));
      }, timeoutMs);

      const check = async () => {
        if (!this.monitoring) return;

        try {
          const loggedIn = await this.isLoggedIn();
          if (loggedIn) {
            clearTimeout(timeout);
            this.monitoring = false;

            // Wait a moment for cookies to settle
            await new Promise((r) => setTimeout(r, 2000));

            const cookies = await this.extractCookies();
            resolve({
              cookies,
              capturedAt: new Date().toISOString(),
            });
            return;
          }
        } catch {
          // CDP might not be ready, keep trying
        }

        if (this.monitoring) {
          setTimeout(check, 3000);
        }
      };

      check();
    });
  }

  /**
   * Stop monitoring (e.g., if the session is cancelled).
   */
  stopMonitoring(): void {
    this.monitoring = false;
  }

  /**
   * Check if any browser page shows a post-login LinkedIn URL.
   */
  private async isLoggedIn(): Promise<boolean> {
    const response = await fetch(`http://localhost:${this.cdpPort}/json`);
    const pages = (await response.json()) as Array<{ url: string }>;

    const loginIndicators = [
      "linkedin.com/feed",
      "linkedin.com/mynetwork",
      "linkedin.com/messaging",
      "linkedin.com/notifications",
      "linkedin.com/jobs",
    ];

    for (const page of pages) {
      const url = page.url ?? "";
      if (loginIndicators.some((indicator) => url.includes(indicator))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract all LinkedIn cookies from the browser via CDP.
   */
  private async extractCookies(): Promise<CdpCookie[]> {
    // Get the debugger WebSocket URL for the first page
    const response = await fetch(`http://localhost:${this.cdpPort}/json`);
    const pages = (await response.json()) as Array<{ webSocketDebuggerUrl: string }>;

    if (pages.length === 0) {
      throw new Error("No browser pages found for cookie extraction");
    }

    const wsUrl = pages[0].webSocketDebuggerUrl;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("CDP cookie extraction timed out"));
      }, 10_000);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: "Network.getAllCookies",
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(String(event.data));
        if (data.id === 1) {
          clearTimeout(timer);
          ws.close();

          const allCookies: CdpCookie[] = data.result?.cookies ?? [];

          // Filter to LinkedIn-related cookies only
          const linkedinCookies = allCookies.filter(
            (c) => c.domain.includes("linkedin"),
          );

          console.log(
            `[SessionCapture] Extracted ${linkedinCookies.length} LinkedIn cookies ` +
            `(of ${allCookies.length} total)`,
          );

          resolve(linkedinCookies);
        }
      };

      ws.onerror = () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error("CDP WebSocket connection failed"));
      };
    });
  }
}
