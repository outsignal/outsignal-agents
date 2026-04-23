import { beforeEach, describe, expect, it, vi } from "vitest";

const personFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findMany: (...args: unknown[]) => personFindManyMock(...args),
    },
  },
}));

import { validatePeopleForChannel } from "../channel-gate";

describe("validatePeopleForChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects valid-without-provider emails as not cleared", async () => {
    personFindManyMock.mockResolvedValue([
      {
        id: "person-1",
        email: "lead@example.com",
        linkedinUrl: null,
        enrichmentData: JSON.stringify({
          emailVerificationStatus: "valid",
        }),
      },
    ]);

    const result = await validatePeopleForChannel(["person-1"], "email");

    expect(result.valid).toBe(false);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      {
        personId: "person-1",
        reason:
          "email not cleared (missing verification provider provenance)",
      },
    ]);
  });

  it("accepts valid emails with provider provenance", async () => {
    personFindManyMock.mockResolvedValue([
      {
        id: "person-2",
        email: "lead@example.com",
        linkedinUrl: null,
        enrichmentData: JSON.stringify({
          emailVerificationStatus: "valid",
          emailVerificationProvider: "bounceban",
        }),
      },
    ]);

    const result = await validatePeopleForChannel(["person-2"], "email");

    expect(result.valid).toBe(true);
    expect(result.accepted).toEqual(["person-2"]);
    expect(result.rejected).toEqual([]);
  });
});
