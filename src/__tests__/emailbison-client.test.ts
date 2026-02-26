import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmailBisonClient } from "@/lib/emailbison/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "https://app.outsignal.ai/api";
const TEST_TOKEN = "test-api-token-abc123";

/**
 * Build a paginated API response matching the EmailBison PaginatedResponse<T>
 * shape. Callers supply the `data` array, the current page, and the total
 * number of pages; everything else is derived.
 */
function makePaginatedResponse<T>(
  data: T[],
  currentPage: number,
  lastPage: number,
): {
  data: T[];
  links: { first: string; last: string; prev: string | null; next: string | null };
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    per_page: number;
    to: number;
    total: number;
  };
} {
  return {
    data,
    links: {
      first: `${BASE_URL}?page=1`,
      last: `${BASE_URL}?page=${lastPage}`,
      prev: currentPage > 1 ? `${BASE_URL}?page=${currentPage - 1}` : null,
      next: currentPage < lastPage ? `${BASE_URL}?page=${currentPage + 1}` : null,
    },
    meta: {
      current_page: currentPage,
      from: (currentPage - 1) * data.length + 1,
      last_page: lastPage,
      per_page: 15,
      to: currentPage * data.length,
      total: lastPage * data.length,
    },
  };
}

/** Convenience: create a minimal mock Response that `fetch` would return. */
function mockFetchResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmailBisonClient", () => {
  let client: EmailBisonClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new EmailBisonClient(TEST_TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Constructor & auth
  // -----------------------------------------------------------------------
  describe("constructor & auth", () => {
    it("sends Authorization header as Bearer <token>", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse([], 1, 1)),
      );

      await client.getCampaigns();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain(BASE_URL);
      expect(options.headers).toMatchObject({
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      });
    });
  });

  // -----------------------------------------------------------------------
  // 2. getCampaigns – single page
  // -----------------------------------------------------------------------
  describe("getCampaigns", () => {
    it("returns campaigns from a single-page response", async () => {
      const campaigns = [
        { id: 1, name: "Campaign A" },
        { id: 2, name: "Campaign B" },
      ];

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse(campaigns, 1, 1)),
      );

      const result = await client.getCampaigns();

      expect(result).toEqual(campaigns);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${BASE_URL}/campaigns?page=1`,
      );
    });

    // ---------------------------------------------------------------------
    // 3. getCampaigns – multi-page pagination (2 pages)
    // ---------------------------------------------------------------------
    it("aggregates data across multiple pages", async () => {
      const page1 = [{ id: 1, name: "Campaign A" }];
      const page2 = [{ id: 2, name: "Campaign B" }];

      fetchMock
        .mockResolvedValueOnce(
          mockFetchResponse(makePaginatedResponse(page1, 1, 2)),
        )
        .mockResolvedValueOnce(
          mockFetchResponse(makePaginatedResponse(page2, 2, 2)),
        );

      const result = await client.getCampaigns();

      expect(result).toEqual([...page1, ...page2]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${BASE_URL}/campaigns?page=1`,
      );
      expect(fetchMock.mock.calls[1][0]).toBe(
        `${BASE_URL}/campaigns?page=2`,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 4. getReplies
  // -----------------------------------------------------------------------
  describe("getReplies", () => {
    it("returns replies array", async () => {
      const replies = [
        { id: 10, from_email_address: "alice@example.com", subject: "Re: Hello" },
        { id: 11, from_email_address: "bob@example.com", subject: "Re: Hi" },
      ];

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse(replies, 1, 1)),
      );

      const result = await client.getReplies();

      expect(result).toEqual(replies);
      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/replies?page=1`);
    });
  });

  // -----------------------------------------------------------------------
  // 5. getLeads
  // -----------------------------------------------------------------------
  describe("getLeads", () => {
    it("returns leads array", async () => {
      const leads = [
        { id: 100, email: "lead1@example.com", first_name: "Alice" },
        { id: 101, email: "lead2@example.com", first_name: "Bob" },
      ];

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse(leads, 1, 1)),
      );

      const result = await client.getLeads();

      expect(result).toEqual(leads);
      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/leads?page=1`);
    });
  });

  // -----------------------------------------------------------------------
  // 6. getSenderEmails
  // -----------------------------------------------------------------------
  describe("getSenderEmails", () => {
    it("returns sender emails array", async () => {
      const senders = [
        { id: 50, email: "sender@company.com", name: "Sales Team" },
      ];

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse(senders, 1, 1)),
      );

      const result = await client.getSenderEmails();

      expect(result).toEqual(senders);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${BASE_URL}/sender-emails?page=1`,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 7. getTags
  // -----------------------------------------------------------------------
  describe("getTags", () => {
    it("returns tags array", async () => {
      const tags = [
        { id: 1, name: "hot-lead", created_at: "2025-01-01T00:00:00Z" },
        { id: 2, name: "follow-up", created_at: "2025-02-01T00:00:00Z" },
      ];

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse(tags, 1, 1)),
      );

      const result = await client.getTags();

      expect(result).toEqual(tags);
      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/tags?page=1`);
    });
  });

  // -----------------------------------------------------------------------
  // 8. getSequenceSteps – passes campaignId as query param
  // -----------------------------------------------------------------------
  describe("getSequenceSteps", () => {
    it("passes campaignId as query parameter and returns steps", async () => {
      const campaignId = 42;
      const steps = [
        { id: 1, campaign_id: 42, position: 1, subject: "Intro", delay_days: 0 },
        { id: 2, campaign_id: 42, position: 2, subject: "Follow-up", delay_days: 3 },
      ];

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse(steps, 1, 1)),
      );

      const result = await client.getSequenceSteps(campaignId);

      expect(result).toEqual(steps);
      // The endpoint already contains "?campaign_id=42", so pagination
      // should append with "&page=1" (not "?page=1").
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${BASE_URL}/campaigns/sequence-steps?campaign_id=${campaignId}&page=1`,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 9. testConnection – returns true on success
  // -----------------------------------------------------------------------
  describe("testConnection", () => {
    it("returns true when the API responds successfully", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse([], 1, 1)),
      );

      const result = await client.testConnection();

      expect(result).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${BASE_URL}/campaigns?page=1`,
      );
    });

    // ---------------------------------------------------------------------
    // 10. testConnection – returns false on error
    // ---------------------------------------------------------------------
    it("returns false when the API responds with an error", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse("Unauthorized", 401),
      );

      const result = await client.testConnection();

      expect(result).toBe(false);
    });

    it("returns false when fetch itself rejects (network error)", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const result = await client.testConnection();

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Rate limiting – throws RateLimitError on 429
  // -----------------------------------------------------------------------
  describe("rate limiting", () => {
    it("throws RateLimitError with retry-after header value on 429", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse("Too Many Requests", 429, { "retry-after": "30" }),
      );

      await expect(client.getCampaigns()).rejects.toThrow(
        /Rate limited/,
      );

      try {
        // Reset mock for a second call to inspect the error shape
        fetchMock.mockResolvedValueOnce(
          mockFetchResponse("Too Many Requests", 429, { "retry-after": "30" }),
        );
        await client.getCampaigns();
      } catch (error: unknown) {
        expect((error as any).name).toBe("RateLimitError");
        expect((error as any).retryAfter).toBe(30);
        expect((error as any).status).toBe(429);
      }
    });

    it("defaults retryAfter to 60 when retry-after header is missing", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse("Too Many Requests", 429),
      );

      try {
        await client.getCampaigns();
      } catch (error: unknown) {
        expect((error as any).name).toBe("RateLimitError");
        expect((error as any).retryAfter).toBe(60);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 12. API errors – throws EmailBisonApiError on non-ok response
  // -----------------------------------------------------------------------
  describe("API errors", () => {
    it("throws EmailBisonApiError on 500 response", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse("Internal Server Error", 500),
      );

      await expect(client.getCampaigns()).rejects.toThrow(
        /Email Bison API error 500/,
      );

      // Verify the error properties
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse("Internal Server Error", 500),
      );
      try {
        await client.getCampaigns();
      } catch (error: unknown) {
        expect((error as any).name).toBe("EmailBisonApiError");
        expect((error as any).status).toBe(500);
        expect((error as any).body).toBe("Internal Server Error");
      }
    });

    it("throws EmailBisonApiError on 403 response", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse("Forbidden", 403),
      );

      await expect(client.getReplies()).rejects.toThrow(
        /Email Bison API error 403/,
      );
    });

    it("throws EmailBisonApiError on 404 response", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse("Not Found", 404),
      );

      await expect(client.getLeads()).rejects.toThrow(
        /Email Bison API error 404/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 13. Pagination with query params – uses & when endpoint already has ?
  // -----------------------------------------------------------------------
  describe("pagination with existing query params", () => {
    it("uses & for page param when endpoint already contains ?", async () => {
      const steps = [
        { id: 1, campaign_id: 99, position: 1 },
      ];

      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse(steps, 1, 1)),
      );

      await client.getSequenceSteps(99);

      // The endpoint is /campaigns/sequence-steps?campaign_id=99
      // so the paginator must append &page=1, not ?page=1
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        `${BASE_URL}/campaigns/sequence-steps?campaign_id=99&page=1`,
      );
      // Ensure there is exactly one "?" in the URL
      expect(calledUrl.split("?").length).toBe(2);
    });

    it("uses & for page param on subsequent pages when endpoint has ?", async () => {
      const page1 = [{ id: 1, campaign_id: 7, position: 1 }];
      const page2 = [{ id: 2, campaign_id: 7, position: 2 }];

      fetchMock
        .mockResolvedValueOnce(
          mockFetchResponse(makePaginatedResponse(page1, 1, 2)),
        )
        .mockResolvedValueOnce(
          mockFetchResponse(makePaginatedResponse(page2, 2, 2)),
        );

      const result = await client.getSequenceSteps(7);

      expect(result).toEqual([...page1, ...page2]);

      const url1 = fetchMock.mock.calls[0][0] as string;
      const url2 = fetchMock.mock.calls[1][0] as string;

      expect(url1).toBe(
        `${BASE_URL}/campaigns/sequence-steps?campaign_id=7&page=1`,
      );
      expect(url2).toBe(
        `${BASE_URL}/campaigns/sequence-steps?campaign_id=7&page=2`,
      );

      // Both URLs should have exactly one "?"
      expect(url1.split("?").length).toBe(2);
      expect(url2.split("?").length).toBe(2);
    });

    it("uses ? for page param when endpoint has no query string", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse(makePaginatedResponse([], 1, 1)),
      );

      await client.getCampaigns();

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${BASE_URL}/campaigns?page=1`);
    });
  });
});
