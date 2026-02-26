import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { enqueueJob, processNextChunk } from "@/lib/enrichment/queue";

describe("enqueueJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a pending job with serialized entity IDs", async () => {
    (prisma.enrichmentJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
    });

    const id = await enqueueJob({
      entityType: "person",
      provider: "prospeo",
      entityIds: ["p1", "p2", "p3"],
      chunkSize: 2,
    });

    expect(id).toBe("job-1");
    expect(prisma.enrichmentJob.create).toHaveBeenCalledWith({
      data: {
        entityType: "person",
        provider: "prospeo",
        status: "pending",
        totalCount: 3,
        processedCount: 0,
        chunkSize: 2,
        entityIds: JSON.stringify(["p1", "p2", "p3"]),
        workspaceSlug: null,
      },
    });
  });

  it("throws on empty entityIds", async () => {
    await expect(
      enqueueJob({
        entityType: "person",
        provider: "prospeo",
        entityIds: [],
      }),
    ).rejects.toThrow("Cannot enqueue job with empty entityIds");
  });

  it("uses default chunkSize of 50", async () => {
    (prisma.enrichmentJob.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-2",
    });

    await enqueueJob({
      entityType: "company",
      provider: "firecrawl",
      entityIds: ["c1"],
    });

    expect(prisma.enrichmentJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ chunkSize: 50 }),
    });
  });
});

describe("processNextChunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no pending jobs exist", async () => {
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await processNextChunk();
    expect(result).toBeNull();
  });

  it("processes a chunk and transitions to complete when done", async () => {
    const mockJob = {
      id: "job-1",
      entityType: "person",
      provider: "prospeo",
      status: "pending",
      totalCount: 2,
      processedCount: 0,
      chunkSize: 50,
      entityIds: JSON.stringify(["p1", "p2"]),
      errorLog: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await processNextChunk();

    expect(result).toEqual({
      jobId: "job-1",
      processed: 2,
      total: 2,
      done: true,
      status: "complete",
    });

    // First update: status -> running
    expect(prisma.enrichmentJob.update).toHaveBeenNthCalledWith(1, {
      where: { id: "job-1" },
      data: { status: "running" },
    });

    // Second update: processedCount + status -> complete
    expect(prisma.enrichmentJob.update).toHaveBeenNthCalledWith(2, {
      where: { id: "job-1" },
      data: {
        processedCount: 2,
        status: "complete",
        errorLog: null,
      },
    });
  });

  it("processes a partial chunk and returns to pending", async () => {
    const mockJob = {
      id: "job-2",
      entityType: "person",
      provider: "leadmagic",
      status: "pending",
      totalCount: 5,
      processedCount: 0,
      chunkSize: 2,
      entityIds: JSON.stringify(["p1", "p2", "p3", "p4", "p5"]),
      errorLog: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await processNextChunk();

    expect(result).toEqual({
      jobId: "job-2",
      processed: 2,
      total: 5,
      done: false,
      status: "pending",
    });
  });

  it("calls onProcess callback for each entity in chunk", async () => {
    const mockJob = {
      id: "job-3",
      entityType: "company",
      provider: "firecrawl",
      status: "pending",
      totalCount: 2,
      processedCount: 0,
      chunkSize: 50,
      entityIds: JSON.stringify(["c1", "c2"]),
      errorLog: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const onProcess = vi.fn().mockResolvedValue(undefined);
    await processNextChunk(onProcess);

    expect(onProcess).toHaveBeenCalledTimes(2);
    expect(onProcess).toHaveBeenCalledWith("c1", { entityType: "company", provider: "firecrawl" });
    expect(onProcess).toHaveBeenCalledWith("c2", { entityType: "company", provider: "firecrawl" });
  });

  it("records individual entity errors without failing the job", async () => {
    const mockJob = {
      id: "job-4",
      entityType: "person",
      provider: "prospeo",
      status: "pending",
      totalCount: 2,
      processedCount: 0,
      chunkSize: 50,
      entityIds: JSON.stringify(["p1", "p2"]),
      errorLog: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const onProcess = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("API 404"));

    const result = await processNextChunk(onProcess);

    expect(result!.done).toBe(true);
    // Second update should include error log
    expect(prisma.enrichmentJob.update).toHaveBeenNthCalledWith(2, {
      where: { id: "job-4" },
      data: expect.objectContaining({
        errorLog: JSON.stringify([{ entityId: "p2", error: "API 404" }]),
      }),
    });
  });

  it("resumes from processedCount offset on subsequent chunks", async () => {
    const mockJob = {
      id: "job-5",
      entityType: "person",
      provider: "prospeo",
      status: "pending",
      totalCount: 4,
      processedCount: 2, // Already processed first 2
      chunkSize: 2,
      entityIds: JSON.stringify(["p1", "p2", "p3", "p4"]),
      errorLog: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const onProcess = vi.fn().mockResolvedValue(undefined);
    const result = await processNextChunk(onProcess);

    // Should process p3 and p4 (offset from processedCount)
    expect(onProcess).toHaveBeenCalledTimes(2);
    expect(onProcess).toHaveBeenCalledWith("p3", expect.anything());
    expect(onProcess).toHaveBeenCalledWith("p4", expect.anything());
    expect(result!.done).toBe(true);
  });

  it("pauses job when onProcess throws DAILY_CAP_HIT", async () => {
    const mockJob = {
      id: "job-cap",
      entityType: "person",
      provider: "prospeo",
      status: "pending",
      totalCount: 3,
      processedCount: 0,
      chunkSize: 50,
      entityIds: JSON.stringify(["p1", "p2", "p3"]),
      errorLog: null,
      workspaceSlug: null,
      resumeAt: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const onProcess = vi.fn()
      .mockResolvedValueOnce(undefined)    // p1 succeeds
      .mockRejectedValueOnce(new Error("DAILY_CAP_HIT"));  // p2 hits cap

    const result = await processNextChunk(onProcess);

    expect(result).toMatchObject({
      jobId: "job-cap",
      processed: 1,
      total: 3,
      done: false,
      status: "paused",
    });

    // Should have called update with paused status and processedCount = 1
    // (first update is status -> running, second is the pause)
    const pauseCall = (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).data && ((call[0] as Record<string, Record<string, unknown>>).data.status === "paused")
    );
    expect(pauseCall).toBeDefined();
    expect(pauseCall![0]).toMatchObject({
      where: { id: "job-cap" },
      data: expect.objectContaining({
        status: "paused",
        processedCount: 1,
      }),
    });
    // resumeAt should be set to a future date
    expect(pauseCall![0].data.resumeAt).toBeInstanceOf(Date);
    expect(pauseCall![0].data.resumeAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("pauses immediately when first entity hits DAILY_CAP_HIT (0 processed)", async () => {
    const mockJob = {
      id: "job-cap-zero",
      entityType: "person",
      provider: "prospeo",
      status: "pending",
      totalCount: 2,
      processedCount: 0,
      chunkSize: 50,
      entityIds: JSON.stringify(["p1", "p2"]),
      errorLog: null,
      workspaceSlug: null,
      resumeAt: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const onProcess = vi.fn().mockRejectedValue(new Error("DAILY_CAP_HIT"));

    const result = await processNextChunk(onProcess);

    expect(result).toMatchObject({
      jobId: "job-cap-zero",
      processed: 0,
      total: 2,
      done: false,
      status: "paused",
    });
    // onProcess called once (first entity), then threw DAILY_CAP_HIT
    expect(onProcess).toHaveBeenCalledTimes(1);
  });

  it("pauses mid-chunk when DAILY_CAP_HIT fires after partial progress", async () => {
    const mockJob = {
      id: "job-cap-mid",
      entityType: "company",
      provider: "firecrawl",
      status: "pending",
      totalCount: 5,
      processedCount: 2, // resuming from offset 2
      chunkSize: 3,
      entityIds: JSON.stringify(["c1", "c2", "c3", "c4", "c5"]),
      errorLog: null,
      workspaceSlug: null,
      resumeAt: null,
    };
    (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
    (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const onProcess = vi.fn()
      .mockResolvedValueOnce(undefined)    // c3 succeeds
      .mockResolvedValueOnce(undefined)    // c4 succeeds
      .mockRejectedValueOnce(new Error("DAILY_CAP_HIT"));  // c5 hits cap

    const result = await processNextChunk(onProcess);

    expect(result).toMatchObject({
      processed: 2,  // c3 and c4 succeeded before cap
      total: 5,
      done: false,
      status: "paused",
    });
    // processedCount in DB should be chunkStart(2) + processedInChunk(2) = 4
    const pauseCall = (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).data && ((call[0] as Record<string, Record<string, unknown>>).data.status === "paused")
    );
    expect(pauseCall).toBeDefined();
    expect(pauseCall![0].data.processedCount).toBe(4);
  });
});
