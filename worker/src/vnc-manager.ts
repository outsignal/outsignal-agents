/**
 * VNC Manager — orchestrates Xvfb + Chromium + x11vnc for browser streaming.
 *
 * Only one VNC session can be active at a time (single display).
 * Used during the LinkedIn login flow so clients can log in
 * via a streamed browser without sharing credentials.
 */

import { spawn, ChildProcess } from "child_process";

interface VncSession {
  senderId: string;
  display: string;
  vncPort: number;
  cdpPort: number;
  xvfb: ChildProcess;
  chromium: ChildProcess;
  x11vnc: ChildProcess;
}

export class VncManager {
  private session: VncSession | null = null;
  private readonly display = ":99";
  private readonly vncPort = 5900;
  private readonly cdpPort = 9222;

  /**
   * Start a VNC session for a sender's LinkedIn login.
   * Launches Xvfb → Chromium → x11vnc in sequence.
   */
  async startSession(senderId: string, proxyUrl?: string): Promise<void> {
    if (this.session) {
      throw new Error(
        `VNC session already active for sender ${this.session.senderId}. ` +
        `Stop it first before starting a new one.`,
      );
    }

    console.log(`[VNC] Starting session for sender ${senderId}`);

    // 1. Start Xvfb (virtual framebuffer)
    const xvfb = spawn("Xvfb", [
      this.display,
      "-screen", "0", "1920x1080x24",
      "-ac",
    ], { stdio: "pipe" });

    xvfb.on("error", (err) => console.error("[VNC] Xvfb error:", err));
    xvfb.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.error(`[VNC] Xvfb exited with code ${code}`);
      }
    });

    await this.waitMs(1000); // Let Xvfb initialize

    // 2. Start Chromium with remote debugging
    const chromiumPath = process.env.CHROME_PATH ?? "chromium";
    const chromiumArgs = [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
      "--start-maximized",
      `--remote-debugging-port=${this.cdpPort}`,
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      // App mode — shows only the page content, no browser chrome
      "--app=https://www.linkedin.com/login",
      "--test-type",
      "--no-default-browser-check",
      "--no-first-run",
      "--disable-infobars",
      "--user-data-dir=/tmp/chromium-session",
    ];

    if (proxyUrl) {
      chromiumArgs.push(`--proxy-server=${proxyUrl}`);
    }

    const chromium = spawn(chromiumPath, chromiumArgs, {
      stdio: "pipe",
      env: { ...process.env, DISPLAY: this.display },
    });

    chromium.on("error", (err) => console.error("[VNC] Chromium error:", err));
    chromium.on("exit", (code) => {
      console.log(`[VNC] Chromium exited with code ${code}`);
    });

    await this.waitMs(3000); // Let Chromium start up

    // 3. Start x11vnc
    const x11vnc = spawn("x11vnc", [
      "-display", this.display,
      "-rfbport", String(this.vncPort),
      "-shared",
      "-forever",
      "-nopw",
      "-noxdamage",
      "-cursor", "arrow",
      "-ncache", "0",
    ], { stdio: "pipe" });

    x11vnc.on("error", (err) => console.error("[VNC] x11vnc error:", err));
    x11vnc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.error(`[VNC] x11vnc exited with code ${code}`);
      }
    });

    await this.waitMs(1000); // Let x11vnc bind

    this.session = {
      senderId,
      display: this.display,
      vncPort: this.vncPort,
      cdpPort: this.cdpPort,
      xvfb,
      chromium,
      x11vnc,
    };

    console.log(`[VNC] Session started — VNC on port ${this.vncPort}, CDP on port ${this.cdpPort}`);
  }

  /**
   * Stop the active VNC session and clean up all processes.
   */
  async stopSession(): Promise<void> {
    if (!this.session) return;

    console.log(`[VNC] Stopping session for sender ${this.session.senderId}`);

    const processes = [this.session.x11vnc, this.session.chromium, this.session.xvfb];
    for (const proc of processes) {
      try {
        if (!proc.killed) {
          proc.kill("SIGTERM");
        }
      } catch {
        // Process may already be dead
      }
    }

    // Give processes time to exit cleanly
    await this.waitMs(500);

    // Force kill if still running
    for (const proc of processes) {
      try {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      } catch {
        // Already dead
      }
    }

    this.session = null;
    console.log("[VNC] Session stopped");
  }

  isActive(): boolean {
    return this.session !== null;
  }

  getActiveSenderId(): string | null {
    return this.session?.senderId ?? null;
  }

  getVncPort(): number {
    return this.vncPort;
  }

  getCdpPort(): number {
    return this.cdpPort;
  }

  private waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
