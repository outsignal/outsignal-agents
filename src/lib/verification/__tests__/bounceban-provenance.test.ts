import { beforeEach, describe, expect, it, vi } from "vitest";

const personFindUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: (...args: unknown[]) => personFindUniqueMock(...args),
    },
  },
}));

import { getVerificationStatus } from "../bounceban";

describe("bounceban.getVerificationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for valid rows without provider provenance", async () => {
    personFindUniqueMock.mockResolvedValue({
      enrichmentData: JSON.stringify({
        emailVerificationStatus: "valid",
      }),
    });

    await expect(getVerificationStatus("person-1")).resolves.toBeNull();
  });

  it("returns exportable valid rows when provider provenance exists", async () => {
    personFindUniqueMock.mockResolvedValue({
      enrichmentData: JSON.stringify({
        emailVerificationStatus: "valid",
        emailVerificationProvider: "bounceban",
      }),
    });

    await expect(getVerificationStatus("person-2")).resolves.toEqual({
      status: "valid",
      isExportable: true,
    });
  });
});
