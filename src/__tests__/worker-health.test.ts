import { describe, expect, it } from "vitest";

import { buildWorkerHealthSnapshot } from "../../worker/src/health";

describe("worker health snapshot", () => {
  it("reports healthy when the poll loop is fresh during business hours", () => {
    const now = new Date("2026-04-24T10:00:00.000Z");
    const snapshot = buildWorkerHealthSnapshot(
      {
        lastPollTickAt: now.getTime() - 2 * 60 * 1000,
        activeSleepUntil: null,
        activeSleepReason: null,
      },
      {
        now,
        businessHoursActive: true,
      },
    );

    expect(snapshot.workerHealthy).toBe(true);
    expect(snapshot.pollAgeSeconds).toBe(120);
    expect(snapshot.interpretation).toBe("Worker polling normally");
  });

  it("reports unhealthy when the poll loop is stale during business hours", () => {
    const now = new Date("2026-04-24T10:00:00.000Z");
    const snapshot = buildWorkerHealthSnapshot(
      {
        lastPollTickAt: now.getTime() - 6 * 60 * 1000,
        activeSleepUntil: null,
        activeSleepReason: null,
      },
      {
        now,
        businessHoursActive: true,
      },
    );

    expect(snapshot.workerHealthy).toBe(false);
    expect(snapshot.pollAgeSeconds).toBe(360);
    expect(snapshot.interpretation).toBe(
      "Worker loop stalled during business hours",
    );
  });

  it("treats outside-business-hours silence as healthy", () => {
    const now = new Date("2026-04-24T22:00:00.000Z");
    const snapshot = buildWorkerHealthSnapshot(
      {
        lastPollTickAt: now.getTime() - 10 * 60 * 1000,
        activeSleepUntil: null,
        activeSleepReason: null,
      },
      {
        now,
        businessHoursActive: false,
      },
    );

    expect(snapshot.workerHealthy).toBe(true);
    expect(snapshot.pollAgeSeconds).toBe(600);
    expect(snapshot.interpretation).toContain("Outside business hours");
  });

  it("treats intentional spread sleep as healthy during business hours", () => {
    const now = new Date("2026-04-24T10:00:00.000Z");
    const snapshot = buildWorkerHealthSnapshot(
      {
        lastPollTickAt: now.getTime() - 12 * 60 * 1000,
        activeSleepUntil: now.getTime() + 8 * 60 * 1000,
        activeSleepReason: "spread_delay",
      },
      {
        now,
        businessHoursActive: true,
      },
    );

    expect(snapshot.workerHealthy).toBe(true);
    expect(snapshot.pollAgeSeconds).toBe(720);
    expect(snapshot.interpretation).toBe(
      "Worker is in an intentional spread delay",
    );
  });

  it("surfaces a cold-start worker without a recorded poll tick", () => {
    const now = new Date("2026-04-24T10:00:00.000Z");
    const snapshot = buildWorkerHealthSnapshot(
      {
        lastPollTickAt: null,
        activeSleepUntil: null,
        activeSleepReason: null,
      },
      {
        now,
        businessHoursActive: true,
      },
    );

    expect(snapshot.workerHealthy).toBe(false);
    expect(snapshot.lastPollTickAt).toBeNull();
    expect(snapshot.pollAgeSeconds).toBeNull();
    expect(snapshot.interpretation).toBe(
      "Worker has not recorded its first poll tick yet",
    );
  });
});
