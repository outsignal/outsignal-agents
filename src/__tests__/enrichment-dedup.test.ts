import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { shouldEnrich } from "@/lib/enrichment/dedup";
import { recordEnrichment } from "@/lib/enrichment/log";

describe("shouldEnrich", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when no successful log exists for this provider", async () => {
    (prisma.enrichmentLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await shouldEnrich("person-1", "person", "prospeo");
    expect(result).toBe(true);
    expect(prisma.enrichmentLog.findFirst).toHaveBeenCalledWith({
      where: { entityId: "person-1", entityType: "person", provider: "prospeo", status: "success" },
      select: { id: true },
    });
  });

  it("returns false when a successful log exists for this provider", async () => {
    (prisma.enrichmentLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-1" });
    const result = await shouldEnrich("person-1", "person", "prospeo");
    expect(result).toBe(false);
  });

  it("returns true when only error logs exist (eligible for retry)", async () => {
    // findFirst with status: "success" returns null because only error logs exist
    (prisma.enrichmentLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await shouldEnrich("person-1", "person", "prospeo");
    expect(result).toBe(true);
  });

  it("checks the correct entity type (company vs person)", async () => {
    (prisma.enrichmentLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await shouldEnrich("company-1", "company", "firecrawl");
    expect(prisma.enrichmentLog.findFirst).toHaveBeenCalledWith({
      where: { entityId: "company-1", entityType: "company", provider: "firecrawl", status: "success" },
      select: { id: true },
    });
  });
});

describe("recordEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a success log with fieldsWritten as JSON", async () => {
    (prisma.enrichmentLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-new" });
    await recordEnrichment({
      entityId: "person-1",
      entityType: "person",
      provider: "prospeo",
      fieldsWritten: ["email", "linkedinUrl"],
      costUsd: 0.002,
    });
    expect(prisma.enrichmentLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: "person-1",
        entityType: "person",
        provider: "prospeo",
        status: "success",
        fieldsWritten: JSON.stringify(["email", "linkedinUrl"]),
        costUsd: 0.002,
        rawResponse: null,
        errorMessage: null,
      }),
    });
  });

  it("writes an error log with errorMessage", async () => {
    (prisma.enrichmentLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-err" });
    await recordEnrichment({
      entityId: "person-2",
      entityType: "person",
      provider: "leadmagic",
      status: "error",
      errorMessage: "API returned 429",
    });
    expect(prisma.enrichmentLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "error",
        errorMessage: "API returned 429",
        fieldsWritten: null,
        costUsd: null,
      }),
    });
  });

  it("serializes rawResponse as JSON when provided", async () => {
    (prisma.enrichmentLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-raw" });
    await recordEnrichment({
      entityId: "company-1",
      entityType: "company",
      provider: "firecrawl",
      rawResponse: { html: "<p>data</p>", crawledAt: "2026-02-26" },
    });
    expect(prisma.enrichmentLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rawResponse: JSON.stringify({ html: "<p>data</p>", crawledAt: "2026-02-26" }),
      }),
    });
  });
});
