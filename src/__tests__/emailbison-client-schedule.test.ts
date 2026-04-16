/**
 * BL-061 Phase A — schedule + attach-tags client methods.
 *
 * Covers the 4 methods added to EmailBisonClient:
 *   - createSchedule (POST /campaigns/{id}/schedule)
 *   - updateSchedule (PUT  /campaigns/{id}/schedule)
 *   - getSchedule    (GET  /campaigns/{id}/schedule, null on 404)
 *   - attachTagsToCampaigns (POST /tags/attach-to-campaigns, empty-array guards)
 *
 * Mirrors the mocking pattern in emailbison-client.test.ts — `global.fetch`
 * is replaced with a vi.fn() per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";

const BASE_URL = "https://app.outsignal.ai/api";
const TEST_TOKEN = "test-token-schedule";

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
    text: () =>
      Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe("EmailBisonClient schedule + attach-tags methods", () => {
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

  // ---------------------------------------------------------------------
  // createSchedule
  // ---------------------------------------------------------------------
  describe("createSchedule", () => {
    // BL-090 + BL-087: save_as_template required (EB v1.1 POST rejects 422
    // if absent). Always send `false` so per-campaign schedules don't
    // pollute the workspace template list — same default DEFAULT_SCHEDULE
    // uses in email-adapter Step 5.
    const schedule = {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
      start_time: "09:00",
      end_time: "17:00",
      timezone: "Europe/London",
      save_as_template: false,
    };

    it("POSTs to /campaigns/{id}/schedule with the schedule body", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({ data: { id: 1 } }));

      const result = await client.createSchedule(42, schedule);

      expect(result).toEqual({ id: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/campaigns/42/schedule`);
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({
        Authorization: `Bearer ${TEST_TOKEN}`,
      });
      expect(JSON.parse(options.body)).toEqual(schedule);
    });

    it("returns an empty object when EB omits the data envelope", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({}));
      const result = await client.createSchedule(42, schedule);
      expect(result).toEqual({});
    });
  });

  // ---------------------------------------------------------------------
  // updateSchedule
  // ---------------------------------------------------------------------
  describe("updateSchedule", () => {
    const schedule = {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
      start_time: "08:00",
      end_time: "18:00",
      timezone: "Europe/London",
      save_as_template: true,
    };

    it("PUTs to /campaigns/{id}/schedule with save_as_template required", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({ data: { updated: true } }),
      );

      const result = await client.updateSchedule(7, schedule);

      expect(result).toEqual({ updated: true });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/campaigns/7/schedule`);
      expect(options.method).toBe("PUT");
      expect(JSON.parse(options.body)).toEqual(schedule);
    });
  });

  // ---------------------------------------------------------------------
  // getSchedule
  // ---------------------------------------------------------------------
  describe("getSchedule", () => {
    it("GETs /campaigns/{id}/schedule and returns data", async () => {
      fetchMock.mockResolvedValueOnce(
        mockFetchResponse({ data: { timezone: "Europe/London" } }),
      );

      const result = await client.getSchedule(42);

      expect(result).toEqual({ timezone: "Europe/London" });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/campaigns/42/schedule`);
      expect(options.method).toBeUndefined(); // default GET
    });

    it("returns null when EB responds 404", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse("not found", 404));

      const result = await client.getSchedule(999);

      expect(result).toBeNull();
    });

    it("re-throws non-404 errors (e.g. 500)", async () => {
      // Client retries 5xx 3 times — mock all 3 attempts.
      fetchMock
        .mockResolvedValueOnce(mockFetchResponse("boom", 500))
        .mockResolvedValueOnce(mockFetchResponse("boom", 500))
        .mockResolvedValueOnce(mockFetchResponse("boom", 500));

      await expect(client.getSchedule(42)).rejects.toThrow(
        /Email Bison API error 500/,
      );
    });
  });

  // ---------------------------------------------------------------------
  // attachTagsToCampaigns
  // ---------------------------------------------------------------------
  describe("attachTagsToCampaigns", () => {
    it("POSTs to /tags/attach-to-campaigns with snake_case body", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({}));

      await client.attachTagsToCampaigns({
        tagIds: [11, 12],
        campaignIds: [100, 200],
        skipWebhooks: true,
      });

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/tags/attach-to-campaigns`);
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        tag_ids: [11, 12],
        campaign_ids: [100, 200],
        skip_webhooks: true,
      });
    });

    it("omits skip_webhooks when not provided", async () => {
      fetchMock.mockResolvedValueOnce(mockFetchResponse({}));

      await client.attachTagsToCampaigns({
        tagIds: [11],
        campaignIds: [100],
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ tag_ids: [11], campaign_ids: [100] });
      expect(body).not.toHaveProperty("skip_webhooks");
    });

    it("throws EMPTY_TAG_LIST before calling fetch when tagIds is empty", async () => {
      await expect(
        client.attachTagsToCampaigns({ tagIds: [], campaignIds: [1] }),
      ).rejects.toMatchObject({
        name: "EmailBisonError",
        code: "EMPTY_TAG_LIST",
        statusCode: 400,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws EMPTY_CAMPAIGN_LIST before calling fetch when campaignIds is empty", async () => {
      await expect(
        client.attachTagsToCampaigns({ tagIds: [1], campaignIds: [] }),
      ).rejects.toMatchObject({
        name: "EmailBisonError",
        code: "EMPTY_CAMPAIGN_LIST",
        statusCode: 400,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses the exported EmailBisonError class", async () => {
      await expect(
        client.attachTagsToCampaigns({ tagIds: [], campaignIds: [] }),
      ).rejects.toBeInstanceOf(EmailBisonError);
    });
  });
});
