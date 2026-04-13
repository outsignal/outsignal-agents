import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock credit exhaustion module
vi.mock("@/lib/enrichment/credit-exhaustion", () => ({
  CreditExhaustionError: class CreditExhaustionError extends Error {
    provider: string;
    httpStatus: number;
    constructor(provider: string, httpStatus: number, message: string) {
      super(message);
      this.provider = provider;
      this.httpStatus = httpStatus;
    }
  },
}));

// Set env before import
process.env.AIARK_API_KEY = "test-key";

import { bulkEnrichByAiArkId } from "@/lib/enrichment/providers/aiark-source-first";

describe("bulkEnrichByAiArkId", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("handles fetch timeout gracefully", async () => {
    // Mock fetch to throw AbortError immediately (simulating timeout)
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const error = new DOMException("The operation was aborted.", "AbortError");
      return Promise.reject(error);
    });

    const people = [
      { personId: "p1", aiarkPersonId: "aiark-1" },
      { personId: "p2", aiarkPersonId: "aiark-2" },
    ];

    // Should not throw — errors are caught per-person and function continues
    const results = await bulkEnrichByAiArkId(people);

    // Both requests failed with AbortError, so no successful results
    // But the function should have completed without throwing
    expect(results.size).toBe(0);
    // Verify both fetch calls were attempted (function continued past first error)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns email from successful response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        email: "john@acme.com",
        profile: {
          first_name: "John",
          last_name: "Doe",
          title: "CTO",
        },
      }),
    });

    const results = await bulkEnrichByAiArkId([
      { personId: "p1", aiarkPersonId: "aiark-1" },
    ]);

    expect(results.size).toBe(1);
    const result = results.get("p1");
    expect(result?.email).toBe("john@acme.com");
    expect(result?.source).toBe("aiark");
    expect(result?.costUsd).toBe(0.005);
  });

  it("rejects non-string email values at runtime", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        email: 12345, // non-string
        profile: {
          first_name: ["John"], // non-string
          last_name: null,
          title: "CTO",
        },
      }),
    });

    const results = await bulkEnrichByAiArkId([
      { personId: "p1", aiarkPersonId: "aiark-1" },
    ]);

    const result = results.get("p1");
    // email should be null because 12345 is not a string
    expect(result?.email).toBeNull();
    // firstName should be undefined because ["John"] is not a string
    expect(result?.firstName).toBeUndefined();
    // costUsd should be 0 since email is null
    expect(result?.costUsd).toBe(0);
  });
});
