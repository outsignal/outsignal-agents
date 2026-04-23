import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const personFindUniqueMock = vi.fn();
const personUpdateMock = vi.fn();
const recordEnrichmentMock = vi.fn();
const incrementDailySpendMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: (...args: unknown[]) => personFindUniqueMock(...args),
      update: (...args: unknown[]) => personUpdateMock(...args),
    },
  },
}));

vi.mock("@/lib/enrichment/log", () => ({
  recordEnrichment: (...args: unknown[]) => recordEnrichmentMock(...args),
}));

vi.mock("@/lib/enrichment/costs", () => ({
  incrementDailySpend: (...args: unknown[]) => incrementDailySpendMock(...args),
}));

import { verifyEmail } from "../kitt";

describe("kitt.verifyEmail", () => {
  const fetchMock = vi.fn();
  const originalApiKey = process.env.KITT_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KITT_API_KEY = "test-kitt-key";
    vi.stubGlobal("fetch", fetchMock);

    personFindUniqueMock.mockResolvedValue({
      enrichmentData: JSON.stringify({ existing: true }),
    });
    personUpdateMock.mockResolvedValue(undefined);
    recordEnrichmentMock.mockResolvedValue(undefined);
    incrementDailySpendMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.KITT_API_KEY;
    } else {
      process.env.KITT_API_KEY = originalApiKey;
    }
    vi.unstubAllGlobals();
  });

  it("writes the canonical provider field alongside emailVerifiedBy", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "verify-1",
        status: "completed",
        result: {
          email: "lead@example.com",
          valid: true,
          deliverable: true,
        },
      }),
    });

    await verifyEmail("lead@example.com", "person-1");

    expect(personUpdateMock).toHaveBeenCalledTimes(1);
    const updateArg = personUpdateMock.mock.calls[0][0];
    const enrichmentData = JSON.parse(updateArg.data.enrichmentData);

    expect(enrichmentData.emailVerificationStatus).toBe("valid");
    expect(enrichmentData.emailVerificationProvider).toBe("kitt");
    expect(enrichmentData.emailVerifiedBy).toBe("kitt");
  });
});
