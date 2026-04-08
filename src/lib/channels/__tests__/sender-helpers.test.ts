/**
 * Unit tests for sender query helpers (sender-helpers.ts).
 *
 * Tests the pure senderChannelFilter function and the Prisma-backed
 * getActiveSendersForChannel / countActiveSenders helpers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockFindMany = vi.fn().mockResolvedValue([]);
const mockCount = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/db", () => ({
  prisma: {
    sender: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import {
  senderChannelFilter,
  getActiveSendersForChannel,
  countActiveSenders,
} from "../sender-helpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("senderChannelFilter", () => {
  it("returns linkedin and both for linkedin channel", () => {
    expect(senderChannelFilter("linkedin")).toEqual({
      in: ["linkedin", "both"],
    });
  });

  it("returns email and both for email channel", () => {
    expect(senderChannelFilter("email")).toEqual({
      in: ["email", "both"],
    });
  });
});

describe("getActiveSendersForChannel", () => {
  beforeEach(() => {
    mockFindMany.mockClear();
  });

  it("queries Prisma with correct where clause", async () => {
    await getActiveSendersForChannel("test-workspace", "linkedin");

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.workspaceSlug).toBe("test-workspace");
    expect(where.status).toBe("active");
    expect(where.channel).toEqual({ in: ["linkedin", "both"] });
  });

  it("queries with email channel filter correctly", async () => {
    await getActiveSendersForChannel("my-workspace", "email");

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.workspaceSlug).toBe("my-workspace");
    expect(where.status).toBe("active");
    expect(where.channel).toEqual({ in: ["email", "both"] });
  });
});

describe("countActiveSenders", () => {
  beforeEach(() => {
    mockCount.mockClear();
  });

  it("queries Prisma with correct where clause", async () => {
    await countActiveSenders("test-workspace", "linkedin");

    expect(mockCount).toHaveBeenCalledTimes(1);
    const where = mockCount.mock.calls[0][0].where;
    expect(where.workspaceSlug).toBe("test-workspace");
    expect(where.status).toBe("active");
    expect(where.channel).toEqual({ in: ["linkedin", "both"] });
  });

  it("returns the count from Prisma", async () => {
    mockCount.mockResolvedValueOnce(5);
    const count = await countActiveSenders("test-workspace", "email");
    expect(count).toBe(5);
  });
});
