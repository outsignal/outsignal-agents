import { beforeEach, describe, expect, it, vi } from "vitest";

const targetListPersonFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    targetListPerson: {
      findMany: (...args: unknown[]) => targetListPersonFindManyMock(...args),
    },
  },
}));

import { getListExportReadiness } from "../verification-gate";

function makeMember(enrichmentData: string | null) {
  return {
    person: {
      id: "person-1",
      email: "lead@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      jobTitle: "Founder",
      company: "Example Co",
      companyDomain: "example.com",
      linkedinUrl: "https://linkedin.com/in/example",
      phone: null,
      location: "London",
      vertical: "SaaS",
      enrichmentData,
    },
  };
}

describe("getListExportReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats valid-without-provider rows as needing re-verification", async () => {
    targetListPersonFindManyMock.mockResolvedValue([
      makeMember(
        JSON.stringify({
          emailVerificationStatus: "valid",
        }),
      ),
    ]);

    const result = await getListExportReadiness("list-1");

    expect(result.readyCount).toBe(0);
    expect(result.needsVerificationCount).toBe(1);
    expect(result.blockedCount).toBe(0);
  });

  it("marks valid-with-provider rows as ready", async () => {
    targetListPersonFindManyMock.mockResolvedValue([
      makeMember(
        JSON.stringify({
          emailVerificationStatus: "valid",
          emailVerificationProvider: "bounceban",
        }),
      ),
    ]);

    const result = await getListExportReadiness("list-1");

    expect(result.readyCount).toBe(1);
    expect(result.needsVerificationCount).toBe(0);
    expect(result.blockedCount).toBe(0);
  });
});
