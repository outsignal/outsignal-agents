/**
 * DB-backed async job queue for batch enrichment.
 * Jobs are processed in chunks to stay within Vercel's 30-second timeout.
 *
 * Usage:
 *   const jobId = await enqueueJob({ entityType: "person", provider: "prospeo", entityIds: [...] });
 *   // Then call processNextChunk() repeatedly (via cron or manual trigger) until complete
 */
import { prisma } from "@/lib/db";
import type { EntityType, Provider } from "./types";

export interface EnqueueJobParams {
  entityType: EntityType;
  provider: Provider;
  entityIds: string[];
  chunkSize?: number;
  workspaceSlug?: string;
}

export interface ChunkResult {
  jobId: string;
  processed: number;
  total: number;
  done: boolean;
  status: string;
}

/**
 * Create a new enrichment job. Returns the job ID.
 * The job starts in "pending" status and will be picked up by processNextChunk.
 */
export async function enqueueJob(params: EnqueueJobParams): Promise<string> {
  const { entityType, provider, entityIds, chunkSize = 50, workspaceSlug } = params;

  if (entityIds.length === 0) {
    throw new Error("Cannot enqueue job with empty entityIds");
  }

  const job = await prisma.enrichmentJob.create({
    data: {
      entityType,
      provider,
      status: "pending",
      totalCount: entityIds.length,
      processedCount: 0,
      chunkSize,
      entityIds: JSON.stringify(entityIds),
      workspaceSlug: workspaceSlug ?? null,
    },
  });

  return job.id;
}

/**
 * Pick up the oldest pending job and process its next chunk.
 * Returns null if no pending jobs exist.
 *
 * The actual enrichment logic is a no-op in Phase 1 — the chunk processor
 * just increments processedCount. Phase 2 will wire in provider adapters
 * via the onProcess callback.
 *
 * @param onProcess - Optional callback to process each entity ID in the chunk.
 *   If not provided, the chunk is marked as processed without doing any work.
 *   This allows Phase 1 to test the queue mechanics independently of provider logic.
 */
export async function processNextChunk(
  onProcess?: (entityId: string, job: { entityType: string; provider: string }) => Promise<void>,
): Promise<ChunkResult | null> {
  // Pick up the oldest pending job
  const job = await prisma.enrichmentJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) return null;

  // Mark as running (prevents other workers from picking it up)
  await prisma.enrichmentJob.update({
    where: { id: job.id },
    data: { status: "running" },
  });

  try {
    // Parse entity IDs and slice the next chunk
    const allIds: string[] = JSON.parse(job.entityIds);
    const chunkStart = job.processedCount;
    const chunk = allIds.slice(chunkStart, chunkStart + job.chunkSize);

    // Process each entity in the chunk
    const errors: Array<{ entityId: string; error: string }> = [];

    for (const entityId of chunk) {
      if (onProcess) {
        try {
          await onProcess(entityId, {
            entityType: job.entityType,
            provider: job.provider,
          });
        } catch (err) {
          errors.push({
            entityId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Update progress
    const newProcessedCount = chunkStart + chunk.length;
    const done = newProcessedCount >= job.totalCount;

    // Merge errors into existing error log
    let existingErrors: Array<{ entityId: string; error: string }> = [];
    if (job.errorLog) {
      try {
        existingErrors = JSON.parse(job.errorLog);
      } catch {
        // ignore malformed errorLog
      }
    }
    const allErrors = [...existingErrors, ...errors];

    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        processedCount: newProcessedCount,
        status: done ? "complete" : "pending",
        errorLog: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
      },
    });

    return {
      jobId: job.id,
      processed: chunk.length,
      total: job.totalCount,
      done,
      status: done ? "complete" : "pending",
    };
  } catch (error) {
    // If chunk processing fails entirely, mark job as failed
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorLog: JSON.stringify([
          { entityId: "system", error: error instanceof Error ? error.message : String(error) },
        ]),
      },
    });

    throw error;
  }
}
