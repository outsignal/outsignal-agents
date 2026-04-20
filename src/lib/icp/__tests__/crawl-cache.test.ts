import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const upsertMock = vi.fn();
const findManyMock = vi.fn();
const scrapeUrlMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    company: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

vi.mock("@/lib/firecrawl/client", () => ({
  scrapeUrl: (...args: unknown[]) => scrapeUrlMock(...args),
}));

import { getCrawlMarkdown, prefetchDomains } from "../crawl-cache";

describe("crawl-cache TTL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("returns a fresh cached crawl without re-fetching", async () => {
    findUniqueMock.mockResolvedValue({
      domain: "acme.com",
      crawlMarkdown: "fresh cached markdown",
      crawledAt: new Date("2026-04-15T12:00:00Z"),
    });

    const result = await getCrawlMarkdown("acme.com");

    expect(result).toBe("fresh cached markdown");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("re-crawls when the cached crawl is older than 7 days", async () => {
    findUniqueMock.mockResolvedValue({
      domain: "acme.com",
      crawlMarkdown: "old markdown",
      crawledAt: new Date("2026-04-01T12:00:00Z"),
    });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      text: async () => "<html><body><h1>Acme</h1><p>Fresh website copy</p></body></html>",
    } as Response);

    const result = await getCrawlMarkdown("acme.com");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://acme.com",
      expect.objectContaining({
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OutsignalBot/1.0)" },
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: "acme.com" },
        data: expect.objectContaining({
          crawlMarkdown: expect.stringContaining("Acme"),
          crawledAt: expect.any(Date),
        }),
      }),
    );
    expect(result).toContain("Fresh website copy");
  });

  it("falls back to stale cached markdown if refresh fails", async () => {
    findUniqueMock.mockResolvedValue({
      domain: "acme.com",
      crawlMarkdown: "old but usable markdown",
      crawledAt: new Date("2026-04-01T12:00:00Z"),
      linkedinUrl: null,
      name: "Acme",
    });
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"));

    const result = await getCrawlMarkdown("acme.com");

    expect(result).toBe("old but usable markdown");
    expect(updateMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("prefetchDomains only counts fresh crawls as cached", async () => {
    findManyMock.mockResolvedValue([{ domain: "fresh.com" }]);
    findUniqueMock.mockResolvedValue(null);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      text: async () => "<html><body><p>Fetched now</p></body></html>",
    } as Response);
    upsertMock.mockResolvedValue(undefined);

    await prefetchDomains(["fresh.com", "stale.com"]);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          domain: { in: ["fresh.com", "stale.com"] },
          crawledAt: { gte: expect.any(Date) },
          crawlMarkdown: { not: null },
        }),
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://stale.com",
      expect.any(Object),
    );
  });
});
