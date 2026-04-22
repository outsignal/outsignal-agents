import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSenderStateOverrides,
  senderStateOverrides,
} from "../../worker/src/sender-health-sync";

vi.mock("../../worker/src/voyager-client", () => ({
  VoyagerClient: class MockVoyagerClient {
    keepaliveFetchProfile = vi.fn().mockResolvedValue(false);
    keepaliveFetchNotifications = vi.fn().mockResolvedValue(false);
    keepaliveFetchMessaging = vi.fn().mockResolvedValue(false);
    keepaliveFetchFeed = vi.fn().mockResolvedValue(false);
  },
}));

describe("KeepaliveManager recent-activity branch", () => {
  beforeEach(() => {
    clearSenderStateOverrides();
    vi.restoreAllMocks();
  });

  it("does not heal stale sender health without a fresh LinkedIn keepalive proof", async () => {
    const updateKeepalive = vi.fn().mockResolvedValue(undefined);
    const updateSenderHealth = vi.fn().mockResolvedValue(undefined);

    const { KeepaliveManager } = await import("../../worker/src/keepalive");

    const manager = new KeepaliveManager({
      updateKeepalive,
      updateSenderHealth,
    } as never);

    const now = Date.now();
    await manager.checkAndRunKeepalives([
      {
        id: "sender-1",
        name: "Daniel",
        sessionStatus: "active",
        healthStatus: "session_expired",
        proxyUrl: null,
        lastActiveAt: new Date(now - 30 * 60 * 1000).toISOString(),
        lastKeepaliveAt: null,
      },
    ]);

    expect(updateKeepalive).toHaveBeenCalledWith("sender-1");
    expect(updateSenderHealth).not.toHaveBeenCalled();
  });

  it("fails closed locally when keepalive detects expiry but the health sync API write fails", async () => {
    const updateSenderHealth = vi.fn().mockRejectedValue(new Error("PATCH failed"));

    const { KeepaliveManager } = await import("../../worker/src/keepalive");

    const manager = new KeepaliveManager({
      getVoyagerCookies: vi.fn().mockResolvedValue({
        liAt: "li_at",
        jsessionId: "JSESSIONID",
      }),
      updateKeepalive: vi.fn().mockResolvedValue(undefined),
      updateSenderHealth,
    } as never);

    await manager.checkAndRunKeepalives([
      {
        id: "sender-1",
        name: "Lucy",
        sessionStatus: "active",
        healthStatus: "healthy",
        proxyUrl: null,
        lastActiveAt: null,
        lastKeepaliveAt: null,
      },
    ]);

    expect(updateSenderHealth).toHaveBeenCalledWith("sender-1", "session_expired");
    expect(senderStateOverrides.get("sender-1")).toEqual({
      healthStatus: "session_expired",
      sessionStatus: "expired",
    });
  });

  it("skips keepalive work for senders that are locally marked expired", async () => {
    senderStateOverrides.set("sender-1", {
      healthStatus: "session_expired",
      sessionStatus: "expired",
    });

    const getVoyagerCookies = vi.fn();
    const { KeepaliveManager } = await import("../../worker/src/keepalive");

    const manager = new KeepaliveManager({
      getVoyagerCookies,
      updateKeepalive: vi.fn().mockResolvedValue(undefined),
      updateSenderHealth: vi.fn().mockResolvedValue(undefined),
    } as never);

    await manager.checkAndRunKeepalives([
      {
        id: "sender-1",
        name: "Lucy",
        sessionStatus: "active",
        healthStatus: "healthy",
        proxyUrl: null,
        lastActiveAt: null,
        lastKeepaliveAt: null,
      },
    ]);

    expect(getVoyagerCookies).not.toHaveBeenCalled();
  });
});
