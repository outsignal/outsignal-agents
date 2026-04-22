/**
 * KeepaliveManager — keeps LinkedIn Voyager sessions alive by making
 * lightweight API calls that mimic natural browsing patterns.
 *
 * Key design:
 * - Runs 24/7 including weekends (not restricted to business hours)
 * - 4-6hr interval with ±2hr jitter on weekdays, 6-10hr on weekends
 * - Rotates through 4 different endpoints to avoid detection patterns
 * - Skips if sender had real activity within the keepalive window
 * - On auth failure (401/403): marks session expired via API
 * - On success: reports lastKeepaliveAt to API
 */

import { VoyagerClient } from "./voyager-client.js";
import { ApiClient } from "./api-client.js";
import {
  isKeepaliveEligible,
  syncSenderHealth,
} from "./sender-health-sync.js";

type KeepaliveEndpoint = "profile" | "notifications" | "messaging" | "feed";

const ENDPOINTS: KeepaliveEndpoint[] = ["profile", "notifications", "messaging", "feed"];

interface SenderKeepaliveState {
  nextKeepaliveAt: number; // epoch ms
  lastEndpoint: KeepaliveEndpoint;
}

interface SenderInfo {
  id: string;
  name: string;
  sessionStatus: string;
  healthStatus: string;
  proxyUrl: string | null;
  lastActiveAt: string | null;
  lastKeepaliveAt: string | null;
}

export class KeepaliveManager {
  private state = new Map<string, SenderKeepaliveState>();
  private api: ApiClient;

  constructor(api: ApiClient) {
    this.api = api;
  }

  /**
   * Check all senders and run keepalives for any that are due.
   * Called from the worker tick loop BEFORE business hours check
   * so keepalives fire 24/7.
   */
  async checkAndRunKeepalives(senders: SenderInfo[]): Promise<void> {
    const now = Date.now();
    const activeSenders = senders.filter((s) => isKeepaliveEligible(s));

    for (const sender of activeSenders) {
      // Initialize state for new senders (e.g. after worker restart)
      if (!this.state.has(sender.id)) {
        const lastKeepaliveAge = sender.lastKeepaliveAt
          ? now - new Date(sender.lastKeepaliveAt).getTime()
          : Infinity;
        const needsImmediateKeepalive = lastKeepaliveAge > 4 * 60 * 60 * 1000; // >4h or never

        this.state.set(sender.id, {
          nextKeepaliveAt: needsImmediateKeepalive ? 0 : now + this.getInterval(),
          lastEndpoint: ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)],
        });

        if (!needsImmediateKeepalive) {
          continue; // Recent keepalive — schedule normally
        }
        // Fall through to run keepalive immediately
      }

      const senderState = this.state.get(sender.id)!;

      // Not due yet
      if (now < senderState.nextKeepaliveAt) continue;

      // Skip if sender had real activity recently (within keepalive window)
      const recentActivityMs = sender.lastActiveAt
        ? now - new Date(sender.lastActiveAt).getTime()
        : Infinity;
      if (recentActivityMs < 3 * 60 * 60 * 1000) {
        // Activity within 3 hours — reschedule keepalive
        senderState.nextKeepaliveAt = now + this.getInterval();
        // Also report the keepalive timestamp since session is clearly alive
        this.api.updateKeepalive(sender.id).catch(() => {});
        continue;
      }

      // Run keepalive
      await this.runKeepalive(sender, senderState);
    }

    // Clean up state for senders no longer in the list
    const senderIds = new Set(senders.map((s) => s.id));
    for (const id of this.state.keys()) {
      if (!senderIds.has(id)) this.state.delete(id);
    }
  }

  private async runKeepalive(
    sender: SenderInfo,
    state: SenderKeepaliveState,
  ): Promise<void> {
    // Pick next endpoint (different from last)
    const endpoint = this.pickEndpoint(state.lastEndpoint);

    try {
      // Load cookies for this sender
      const cookies = await this.api.getVoyagerCookies(sender.id);
      if (!cookies) {
        console.log(`[Keepalive] No cookies for ${sender.name}, skipping`);
        state.nextKeepaliveAt = Date.now() + this.getInterval();
        return;
      }

      const client = new VoyagerClient(cookies.liAt, cookies.jsessionId, sender.proxyUrl ?? undefined);

      // Execute the keepalive call
      let success = false;
      switch (endpoint) {
        case "profile":
          success = await client.keepaliveFetchProfile();
          break;
        case "notifications":
          success = await client.keepaliveFetchNotifications();
          break;
        case "messaging":
          success = await client.keepaliveFetchMessaging();
          break;
        case "feed":
          success = await client.keepaliveFetchFeed();
          break;
      }

      if (success) {
        console.log(`[Keepalive] ${sender.name}: ${endpoint} — OK`);
        await this.api.updateKeepalive(sender.id);

        // Clear stale session_expired health flag on successful keepalive
        if (sender.healthStatus === "session_expired") {
          console.log(`[Keepalive] ${sender.name}: clearing stale session_expired flag`);
          await syncSenderHealth(
            this.api,
            sender,
            "healthy",
            `keepalive ${endpoint} recovery`,
          );
        }
      } else {
        console.warn(`[Keepalive] ${sender.name}: ${endpoint} — SESSION EXPIRED`);
        await syncSenderHealth(
          this.api,
          sender,
          "session_expired",
          `keepalive ${endpoint} expiry`,
        );
      }
    } catch (err) {
      console.error(
        `[Keepalive] ${sender.name}: ${endpoint} — error:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Schedule next keepalive regardless of outcome
    state.lastEndpoint = endpoint;
    state.nextKeepaliveAt = Date.now() + this.getInterval();
  }

  /**
   * Pick a random endpoint that's different from the last one used.
   */
  private pickEndpoint(lastEndpoint: KeepaliveEndpoint): KeepaliveEndpoint {
    const available = ENDPOINTS.filter((e) => e !== lastEndpoint);
    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * Get keepalive interval with jitter.
   * Weekdays: 4-6 hours. Weekends: 6-10 hours.
   */
  private getInterval(): number {
    const day = new Date().getUTCDay();
    const isWeekend = day === 0 || day === 6;

    if (isWeekend) {
      // 6-10 hours (lighter weekend pattern)
      return (6 + Math.random() * 4) * 60 * 60 * 1000;
    }
    // 4-6 hours (weekday)
    return (4 + Math.random() * 2) * 60 * 60 * 1000;
  }
}
