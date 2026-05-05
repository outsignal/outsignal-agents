import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prospeoSearchAdapter } from "../adapters/prospeo-search";

describe("Prospeo search adapter format mapping", () => {
  const originalApiKey = process.env.PROSPEO_API_KEY;

  beforeEach(() => {
    process.env.PROSPEO_API_KEY = "test-prospeo-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [],
          pagination: { total_count: 0, total_page: 1, current_page: 1 },
        }),
      }),
    );
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.PROSPEO_API_KEY;
    } else {
      process.env.PROSPEO_API_KEY = originalApiKey;
    }
    vi.unstubAllGlobals();
  });

  it("sends Prospeo-formatted locations and decomposed company-size bands", async () => {
    await prospeoSearchAdapter.search(
      {
        locations: ["UK"],
        companySizes: ["5-100"],
      },
      25,
    );

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body.filters.person_location_search).toEqual({
      include: ["United Kingdom #GB"],
    });
    expect(body.filters.company_headcount_range).toEqual([
      "1-10",
      "11-20",
      "21-50",
      "51-100",
    ]);
  });
});
