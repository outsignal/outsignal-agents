import { describe, expect, it, vi } from "vitest";

describe("KeepaliveManager recent-activity branch", () => {
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
});
