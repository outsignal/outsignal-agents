import { beforeEach, describe, expect, it, vi } from "vitest";
import { serperAdapter } from "../adapters/serper";
import {
  SERPER_1210_FAIL_CASES,
  SERPER_1210_PASS_CASES,
} from "../__fixtures__/serper-1210-regressions";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(organic: Array<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ organic }),
  };
}

function expectedPassResults(companyName: string, domain: string) {
  return [
    {
      title: `${companyName} | LinkedIn`,
      link: `https://www.linkedin.com/company/${domain.replace(/\./g, "-")}`,
      snippet: `${companyName} on LinkedIn`,
      position: 1,
    },
    {
      title: `${companyName} | Haulage, logistics and transport`,
      link: `https://${domain}`,
      snippet: `${companyName} provides haulage, logistics, transport and freight services across the UK.`,
      position: 2,
    },
  ];
}

function expectedFailResults(companyName: string, domain: string) {
  const root = domain
    .replace(/^www\./, "")
    .split(".")
    .slice(0, -1)
    .join(".");
  return [
    {
      title: `${root} | Official site`,
      link: `https://${domain}`,
      snippet: `Transport and logistics services`,
      position: 1,
    },
  ];
}

describe("serperAdapter.searchWeb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERPER_API_KEY = "test-serper-key";
  });

  it("passes gl and hl through to Serper", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse([]));

    await serperAdapter.searchWeb("Acme Logistics", {
      num: 10,
      gl: "uk",
      hl: "en-GB",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = mockFetch.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.body))).toMatchObject({
      q: "Acme Logistics",
      type: "search",
      num: 10,
      gl: "uk",
      hl: "en-GB",
    });
  });
});

describe("serperAdapter.searchLinkedInCompanyPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERPER_API_KEY = "test-serper-key";
  });

  it("builds a LinkedIn company query with geo defaults", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse([]));

    await serperAdapter.searchLinkedInCompanyPages({
      companyName: "Acme Ltd",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = mockFetch.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.body))).toMatchObject({
      q: 'site:linkedin.com/company "Acme Ltd"',
      type: "search",
      num: 10,
      gl: "uk",
      hl: "en-GB",
    });
  });

  it("allows explicit gl, hl, and num overrides", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse([]));

    await serperAdapter.searchLinkedInCompanyPages({
      companyName: "Acme Ltd",
      gl: "us",
      hl: "en",
      num: 3,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = mockFetch.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.body))).toMatchObject({
      q: 'site:linkedin.com/company "Acme Ltd"',
      type: "search",
      num: 3,
      gl: "us",
      hl: "en",
    });
  });
});

describe("serperAdapter.searchCompanyDomains", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERPER_API_KEY = "test-serper-key";
  });

  it("retries once with relaxed context when the first attempt returns no valid candidates", async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse([
        {
          title: "Acme Logistics | LinkedIn",
          link: "https://linkedin.com/company/acme-logistics",
          snippet: "Profile page",
          position: 1,
        },
      ]))
      .mockResolvedValueOnce(makeResponse(expectedPassResults("Acme Logistics Ltd", "acmelogistics.co.uk")));

    const result = await serperAdapter.searchCompanyDomains({
      companyName: "Acme Logistics Ltd",
      contextKeywords: ["haulage", "logistics", "transport", "freight"],
      location: "West Midlands",
      gl: "uk",
      hl: "en-GB",
    });

    expect(result.queries).toEqual([
      "\"Acme Logistics Ltd\" \"West Midlands\" (haulage OR logistics OR transport OR freight) -site:linkedin.com -site:facebook.com",
      "\"Acme Logistics Ltd\" (haulage OR logistics OR transport OR freight) -site:linkedin.com -site:facebook.com",
    ]);
    expect(result.candidates[0]?.domain).toBe("acmelogistics.co.uk");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects the curated 1210 false-positive cases instead of force-picking a domain", async () => {
    for (const testCase of SERPER_1210_FAIL_CASES) {
      mockFetch.mockResolvedValueOnce(makeResponse(expectedFailResults(testCase.companyName, testCase.domain)));

      const result = await serperAdapter.searchCompanyDomains({
        companyName: testCase.companyName,
        contextKeywords: ["haulage", "logistics", "transport", "freight"],
        gl: "uk",
        hl: "en-GB",
      });

      expect(result.candidates, `${testCase.companyName} -> ${testCase.domain}`).toHaveLength(0);
    }
  });

  it("keeps resolving the curated 1210 known-good matches", async () => {
    for (const testCase of SERPER_1210_PASS_CASES) {
      mockFetch.mockResolvedValueOnce(makeResponse(expectedPassResults(testCase.companyName, testCase.domain)));

      const result = await serperAdapter.searchCompanyDomains({
        companyName: testCase.companyName,
        contextKeywords: ["haulage", "logistics", "transport", "freight"],
        gl: "uk",
        hl: "en-GB",
      });

      expect(result.candidates[0]?.domain, `${testCase.companyName} -> ${testCase.domain}`).toBe(testCase.domain);
    }
  });
});
