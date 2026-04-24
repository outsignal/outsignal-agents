import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyDomainLive, resolveCompanyDomain, resolveCompanyDomains } from "../domain-resolver";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    company: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// Mock serper adapter
vi.mock("../adapters/serper", () => ({
  serperAdapter: {
    searchCompanyDomains: vi.fn(),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma } from "@/lib/db";
import { serperAdapter } from "../adapters/serper";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyDomainLive", () => {
  it("returns true for 200 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.com",
    });
    expect(await verifyDomainLive("acme.com")).toBe(true);
  });

  it("returns false for 404 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      url: "https://acme.com",
    });
    expect(await verifyDomainLive("acme.com")).toBe(false);
  });

  it("returns false for network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    expect(await verifyDomainLive("doesnt-exist.xyz")).toBe(false);
  });

  it("returns false for redirect to parking service (sedo.com)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://sedo.com/parked/acme.com",
    });
    expect(await verifyDomainLive("parked-domain.com")).toBe(false);
  });

  it("returns false for redirect to godaddy parking", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://godaddy.com/parked",
    });
    expect(await verifyDomainLive("parked2.com")).toBe(false);
  });
});

describe("resolveCompanyDomain", () => {
  it("returns DB result when company found in Company table", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValueOnce({
      domain: "acme.com",
      name: "Acme Corp",
    } as never);

    const result = await resolveCompanyDomain("Acme Corp", { location: "UK" });
    expect(result.source).toBe("db");
    expect(result.domain).toBe("acme.com");
    expect(result.httpVerified).toBe(true);
    expect(result.costUsd).toBe(0);
    // Should NOT call serper
    expect(serperAdapter.searchCompanyDomains).not.toHaveBeenCalled();
  });

  it("falls back to Serper when not in DB and HTTP verifies", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValueOnce(null);
    vi.mocked(serperAdapter.searchCompanyDomains).mockResolvedValueOnce({
      candidates: [
        {
          domain: "acme.com",
          domainRoot: "acme",
          score: 88,
          fuzzyScore: 70,
          tokenScore: 70,
          keywordHits: ["tech"],
          titleMatchScore: 10,
          tldScore: 8,
          distinctiveTokenMatches: ["acme"],
          attempt: 1,
          query: "\"Acme Corp\" \"UK\" (tech) -site:linkedin.com -site:facebook.com",
          result: {
            title: "Acme Corp",
            link: "https://www.acme.com/about",
            snippet: "Acme Corp official site",
            position: 1,
          },
        },
      ],
      costUsd: 0.001,
      queries: [],
      rawResponses: [],
    });
    // Mock HTTP verification success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://acme.com",
    });
    vi.mocked(prisma.company.upsert).mockResolvedValueOnce({} as never);

    const result = await resolveCompanyDomain("Acme Corp", { location: "UK", industry: "tech" });
    expect(result.source).toBe("serper");
    expect(result.domain).toBe("acme.com");
    expect(result.httpVerified).toBe(true);
    expect(result.costUsd).toBe(0.001);
    expect(prisma.company.upsert).toHaveBeenCalled();
  });

  it("includes ICP context in Serper query", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValueOnce(null);
    vi.mocked(serperAdapter.searchCompanyDomains).mockResolvedValueOnce({
      candidates: [],
      costUsd: 0.001,
      queries: [],
      rawResponses: [],
    });

    await resolveCompanyDomain("Acme Corp", {
      location: "West Midlands",
      industry: "recruitment",
      contextKeywords: ["haulage", "logistics"],
      gl: "uk",
      hl: "en-GB",
    });

    expect(serperAdapter.searchCompanyDomains).toHaveBeenCalledWith({
      companyName: "Acme Corp",
      contextKeywords: ["haulage", "logistics"],
      location: "West Midlands",
      gl: "uk",
      hl: "en-GB",
    });
  });

  it("returns failed when no Serper results", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValueOnce(null);
    vi.mocked(serperAdapter.searchCompanyDomains).mockResolvedValueOnce({
      candidates: [],
      costUsd: 0.001,
      queries: [],
      rawResponses: [],
    });

    const result = await resolveCompanyDomain("Unknown Corp", {});
    expect(result.source).toBe("failed");
    expect(result.domain).toBe(null);
    expect(result.httpVerified).toBe(false);
  });

  it("returns failed when the ranked candidates do not pass HTTP verification", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValueOnce(null);
    vi.mocked(serperAdapter.searchCompanyDomains).mockResolvedValueOnce({
      candidates: [
        {
          domain: "acme.com",
          domainRoot: "acme",
          score: 90,
          fuzzyScore: 70,
          tokenScore: 70,
          keywordHits: ["logistics"],
          titleMatchScore: 10,
          tldScore: 8,
          distinctiveTokenMatches: ["acme"],
          attempt: 1,
          query: "\"Acme Corp\" (logistics) -site:linkedin.com -site:facebook.com",
          result: {
            title: "Acme Logistics",
            link: "https://acme.com",
            snippet: "",
            position: 1,
          },
        },
      ],
      costUsd: 0.001,
      queries: [],
      rawResponses: [],
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      url: "https://acme.com",
    });

    const result = await resolveCompanyDomain("Acme Corp", {});
    expect(result.source).toBe("failed");
    expect(result.domain).toBe(null);
  });

  it("tries the next ranked candidate when the first one fails HTTP verification", async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValueOnce(null);
    vi.mocked(serperAdapter.searchCompanyDomains).mockResolvedValueOnce({
      candidates: [
        {
          domain: "bad-domain.xyz",
          domainRoot: "bad-domain",
          score: 84,
          fuzzyScore: 66,
          tokenScore: 66,
          keywordHits: ["haulage"],
          titleMatchScore: 10,
          tldScore: 2,
          distinctiveTokenMatches: ["good"],
          attempt: 1,
          query: "\"Good Corp\" (haulage) -site:linkedin.com -site:facebook.com",
          result: {
            title: "Bad Domain",
            link: "https://bad-domain.xyz/about",
            snippet: "",
            position: 1,
          },
        },
        {
          domain: "good-domain.com",
          domainRoot: "good-domain",
          score: 82,
          fuzzyScore: 64,
          tokenScore: 64,
          keywordHits: ["haulage"],
          titleMatchScore: 10,
          tldScore: 8,
          distinctiveTokenMatches: ["good"],
          attempt: 1,
          query: "\"Good Corp\" (haulage) -site:linkedin.com -site:facebook.com",
          result: {
            title: "Good Domain",
            link: "https://www.good-domain.com",
            snippet: "",
            position: 2,
          },
        },
      ],
      costUsd: 0.001,
      queries: [],
      rawResponses: [],
    });
    // First HTTP check fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      url: "https://bad-domain.xyz",
    });
    // Second HTTP check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://good-domain.com",
    });
    vi.mocked(prisma.company.upsert).mockResolvedValueOnce({} as never);

    const result = await resolveCompanyDomain("Good Corp", {});
    expect(result.domain).toBe("good-domain.com");
    expect(result.httpVerified).toBe(true);
  });
});

describe("resolveCompanyDomains", () => {
  it("resolves batch of companies", async () => {
    // All found in DB
    vi.mocked(prisma.company.findFirst)
      .mockResolvedValueOnce({ domain: "alpha.com", name: "Alpha" } as never)
      .mockResolvedValueOnce({ domain: "beta.com", name: "Beta" } as never)
      .mockResolvedValueOnce({ domain: "gamma.com", name: "Gamma" } as never);

    const summary = await resolveCompanyDomains(
      ["Alpha Inc", "Beta Ltd", "Gamma Corp"],
      { location: "UK" },
    );

    expect(summary.total).toBe(3);
    expect(summary.resolved).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.failedCompanies).toEqual([]);
    expect(summary.results).toHaveLength(3);
  });

  it("reports failed companies in summary", async () => {
    vi.mocked(prisma.company.findFirst)
      .mockResolvedValueOnce({ domain: "alpha.com", name: "Alpha" } as never)
      .mockResolvedValueOnce(null); // Beta not found

    vi.mocked(serperAdapter.searchCompanyDomains).mockResolvedValueOnce({
      candidates: [],
      costUsd: 0.001,
      queries: [],
      rawResponses: [],
    });

    const summary = await resolveCompanyDomains(
      ["Alpha Inc", "Beta Ltd"],
      { location: "UK" },
    );

    expect(summary.total).toBe(2);
    expect(summary.resolved).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failedCompanies).toEqual(["Beta Ltd"]);
  });

  it("accumulates total cost from all resolutions", async () => {
    vi.mocked(prisma.company.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    vi.mocked(serperAdapter.searchCompanyDomains)
      .mockResolvedValueOnce({ candidates: [], costUsd: 0.001, queries: [], rawResponses: [] })
      .mockResolvedValueOnce({ candidates: [], costUsd: 0.001, queries: [], rawResponses: [] });

    const summary = await resolveCompanyDomains(["A", "B"], {});
    expect(summary.totalCostUsd).toBe(0.002);
  });
});
