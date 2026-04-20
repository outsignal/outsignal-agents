import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueActionMock = vi.fn();
const applyTimingJitterMock = vi.fn();

vi.mock("@/lib/linkedin/queue", () => ({
  enqueueAction: (...args: unknown[]) => enqueueActionMock(...args),
}));

vi.mock("@/lib/linkedin/jitter", () => ({
  applyTimingJitter: (...args: unknown[]) => applyTimingJitterMock(...args),
}));

describe("chainActions business-hours normalization", () => {
  beforeEach(() => {
    enqueueActionMock.mockReset();
    enqueueActionMock
      .mockResolvedValueOnce("lia-1")
      .mockResolvedValueOnce("lia-2");
    applyTimingJitterMock.mockReset();
  });

  it("carries a chained step that spills past 18:00 London into the next business day", async () => {
    applyTimingJitterMock.mockReturnValue(0);

    const { chainActions } = await import("@/lib/linkedin/chain");

    await chainActions({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "lime-recruitment",
      baseScheduledFor: new Date("2026-04-20T15:35:12.862Z"),
      priority: 5,
      sequence: [
        { position: 0, type: "profile_view" },
        { position: 1, type: "connection_request", delayDays: 0 },
      ],
    });

    expect(enqueueActionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionType: "profile_view",
        scheduledFor: new Date("2026-04-20T15:35:12.862Z"),
      }),
    );
    expect(enqueueActionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionType: "connection_request",
        scheduledFor: new Date("2026-04-21T09:35:12.862Z"),
      }),
    );
  });

  it("clamps a first step scheduled before London business hours to the opening bell", async () => {
    const { chainActions } = await import("@/lib/linkedin/chain");

    await chainActions({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "lime-recruitment",
      baseScheduledFor: new Date("2026-04-20T06:45:00.000Z"),
      priority: 5,
      sequence: [{ position: 0, type: "profile_view" }],
    });

    expect(enqueueActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "profile_view",
        scheduledFor: new Date("2026-04-20T07:00:00.000Z"),
      }),
    );
  });

  it("preserves overflow across a Friday spill without reordering later chained steps", async () => {
    enqueueActionMock
      .mockReset()
      .mockResolvedValueOnce("lia-1")
      .mockResolvedValueOnce("lia-2")
      .mockResolvedValueOnce("lia-3");
    applyTimingJitterMock.mockReturnValue(0);

    const { chainActions } = await import("@/lib/linkedin/chain");

    await chainActions({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "blanktag",
      baseScheduledFor: new Date("2026-04-24T15:30:00.000Z"),
      priority: 5,
      sequence: [
        { position: 0, type: "profile_view" },
        { position: 1, type: "connection_request", delayDays: 0 },
        { position: 2, type: "message", delayDays: 0 },
      ],
    });

    expect(enqueueActionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionType: "profile_view",
        scheduledFor: new Date("2026-04-24T15:30:00.000Z"),
      }),
    );
    expect(enqueueActionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionType: "connection_request",
        scheduledFor: new Date("2026-04-27T09:30:00.000Z"),
      }),
    );
    expect(enqueueActionMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        actionType: "message",
        scheduledFor: new Date("2026-04-27T13:30:00.000Z"),
      }),
    );
  });
});

describe("normalizeToLondonBusinessHours", () => {
  it("rolls a Friday evening spill into Monday while preserving overflow", async () => {
    const { normalizeToLondonBusinessHours } = await import(
      "@/lib/linkedin/business-hours"
    );

    expect(
      normalizeToLondonBusinessHours(
        new Date("2026-04-24T19:30:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-27T09:30:00.000Z"));
  });

  it("treats the 18:00 London cutoff as exclusive and pushes to the next business start", async () => {
    const { normalizeToLondonBusinessHours } = await import(
      "@/lib/linkedin/business-hours"
    );

    expect(
      normalizeToLondonBusinessHours(
        new Date("2026-04-20T17:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-21T07:00:00.000Z"));
  });

  it("clamps pre-08:00 weekday timestamps to the same-day London opening bell", async () => {
    const { normalizeToLondonBusinessHours } = await import(
      "@/lib/linkedin/business-hours"
    );

    expect(
      normalizeToLondonBusinessHours(
        new Date("2026-04-20T06:45:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-20T07:00:00.000Z"));
  });

  it("preserves the within-window offset for weekend timestamps", async () => {
    const { normalizeToLondonBusinessHours } = await import(
      "@/lib/linkedin/business-hours"
    );

    expect(
      normalizeToLondonBusinessHours(
        new Date("2026-04-26T09:15:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-27T09:15:00.000Z"));
  });

  it("stays stable across the BST spring-forward weekend", async () => {
    const { normalizeToLondonBusinessHours } = await import(
      "@/lib/linkedin/business-hours"
    );

    expect(
      normalizeToLondonBusinessHours(
        new Date("2026-03-29T09:15:00.000Z"),
      ),
    ).toEqual(new Date("2026-03-30T09:15:00.000Z"));
  });

  it("stays stable across the GMT fall-back weekend", async () => {
    const { normalizeToLondonBusinessHours } = await import(
      "@/lib/linkedin/business-hours"
    );

    expect(
      normalizeToLondonBusinessHours(
        new Date("2026-10-25T10:15:00.000Z"),
      ),
    ).toEqual(new Date("2026-10-26T10:15:00.000Z"));
  });
});
