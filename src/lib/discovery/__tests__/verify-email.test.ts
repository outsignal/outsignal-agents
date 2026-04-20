import { beforeEach, describe, expect, it, vi } from "vitest";

const bouncebanVerifyMock = vi.fn();
const kittVerifyMock = vi.fn();

vi.mock("@/lib/verification/bounceban", () => ({
  verifyEmail: (...args: unknown[]) => bouncebanVerifyMock(...args),
}));

vi.mock("@/lib/verification/kitt", () => ({
  verifyEmail: (...args: unknown[]) => kittVerifyMock(...args),
}));

vi.mock("@/lib/enrichment/credit-exhaustion", () => ({
  isCreditExhaustion: vi.fn(() => false),
}));

vi.mock("@/lib/notifications", () => ({
  notifyCreditExhaustion: vi.fn().mockResolvedValue(undefined),
}));

import { verifyDiscoveredEmails } from "../verify-email";

describe("verifyDiscoveredEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects valid_catch_all emails instead of treating them as verified", async () => {
    const people = [
      {
        email: "maybe@catchall.example",
        firstName: "Casey",
        lastName: "Jones",
      },
    ];

    bouncebanVerifyMock.mockResolvedValue({ status: "valid_catch_all" });

    const result = await verifyDiscoveredEmails(people);

    expect(result.validCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(people[0].email).toBeUndefined();
    expect(kittVerifyMock).not.toHaveBeenCalled();
  });
});
