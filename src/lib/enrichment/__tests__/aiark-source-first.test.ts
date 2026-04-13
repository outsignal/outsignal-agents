import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Set API key
vi.stubEnv("AIARK_API_KEY", "test-api-key");

import { bulkEnrichByAiArkId } from "../providers/aiark-source-first";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function mockResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("bulkEnrichByAiArkId", () => {
  it("returns email when export/single succeeds", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, {
        email: "john@acme.com",
        profile: {
          first_name: "John",
          last_name: "Doe",
          title: "CTO",
        },
      }),
    );

    const results = await bulkEnrichByAiArkId([
      { personId: "p1", aiarkPersonId: "aiark-123" },
    ]);

    expect(results.size).toBe(1);
    const result = results.get("p1")!;
    expect(result.email).toBe("john@acme.com");
    expect(result.firstName).toBe("John");
    expect(result.lastName).toBe("Doe");
    expect(result.jobTitle).toBe("CTO");
    expect(result.costUsd).toBe(0.005);
    expect(result.source).toBe("aiark");

    // Verify request body
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody).toEqual({ id: "aiark-123" });
  });

  it("returns null email when 200 but no email in response", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, {
        profile: {
          first_name: "John",
          last_name: "Doe",
          title: "CTO",
        },
      }),
    );

    const results = await bulkEnrichByAiArkId([
      { personId: "p1", aiarkPersonId: "aiark-123" },
    ]);

    const result = results.get("p1")!;
    expect(result.email).toBeNull();
    expect(result.costUsd).toBe(0); // no email found = no cost
  });

  it("handles 404 gracefully (no cost)", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404));

    const results = await bulkEnrichByAiArkId([
      { personId: "p1", aiarkPersonId: "aiark-123" },
    ]);

    const result = results.get("p1")!;
    expect(result.email).toBeNull();
    expect(result.costUsd).toBe(0);
  });

  it("throws CreditExhaustionError on 402", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(402));

    await expect(
      bulkEnrichByAiArkId([
        { personId: "p1", aiarkPersonId: "aiark-123" },
      ]),
    ).rejects.toThrow("AI Ark source-first credits exhausted");
  });

  it("stops on 429 and returns partial results", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(200, { email: "john@acme.com" }),
      )
      .mockResolvedValueOnce(mockResponse(429));

    const results = await bulkEnrichByAiArkId([
      { personId: "p1", aiarkPersonId: "aiark-1" },
      { personId: "p2", aiarkPersonId: "aiark-2" },
      { personId: "p3", aiarkPersonId: "aiark-3" },
    ]);

    // p1 succeeded, p2 hit 429, p3 was never attempted
    expect(results.size).toBe(1);
    expect(results.get("p1")!.email).toBe("john@acme.com");
    expect(results.has("p3")).toBe(false);
  });

  it("skips individual errors and continues", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        mockResponse(200, { email: "jane@beta.com" }),
      );

    const results = await bulkEnrichByAiArkId([
      { personId: "p1", aiarkPersonId: "aiark-1" },
      { personId: "p2", aiarkPersonId: "aiark-2" },
    ]);

    // p1 errored, p2 succeeded
    expect(results.has("p1")).toBe(false);
    expect(results.get("p2")!.email).toBe("jane@beta.com");
  });
});
