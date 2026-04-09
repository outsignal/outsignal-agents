/**
 * DB-backed async job queue for batch enrichment.
 * Jobs are processed in chunks to stay within Vercel's 30-second timeout.
 *
 * Usage:
 *   const jobId = await enqueueJob({ entityType: "person", provider: "prospeo", entityIds: [...] });
 *   // Then call processNextChunk() repeatedly (via cron or manual trigger) until complete
 */
import { prisma } from "@/lib/db";
import { isCreditExhaustion } from "@/lib/enrichment/credit-exhaustion";
import { notifyCreditExhaustion } from "@/lib/notifications";
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
/**
 * Optional batch callback for processing multiple entities at once.
 * When provided, called instead of per-entity onProcess for chunks with >1 entities.
 */
export type OnProcessBatch = (
  entityIds: string[],
  job: { entityType: string; provider: string; workspaceSlug?: string | null },
) => Promise<void>;

export async function processNextChunk(
  onProcess?: (
    entityId: string,
    job: { entityType: string; provider: string; workspaceSlug?: string | null },
  ) => Promise<void>,
  onProcessBatch?: OnProcessBatch,
): Promise<ChunkResult | null> {
  // Pick up the oldest pending job, or a paused job whose resumeAt is in the past
  const job = await prisma.enrichmentJob.findFirst({
    where: {
      OR: [
        { status: "pending" },
        { status: "paused", resumeAt: { lte: new Date() } },
      ],
    },
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
    let processedInChunk = 0;

    // Batch mode: when onProcessBatch is available and chunk has >1 entities
    if (onProcessBatch && chunk.length > 1) {
      try {
        await onProcessBatch(chunk, {
          entityType: job.entityType,
          provider: job.provider,
          workspaceSlug: job.workspaceSlug,
        });
        processedInChunk = chunk.length;
      } catch (err) {
        // Credit exhaustion — pause the job with 1-hour resume
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as any).provider,
            httpStatus: (err as any).httpStatus,
            context: `enrichment queue batch processing (job ${job.id})`,
          });
          const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
          await prisma.enrichmentJob.update({
            where: { id: job.id },
            data: {
              status: "paused",
              resumeAt: oneHourFromNow,
              processedCount: chunkStart + processedInChunk,
            },
          });
          return {
            jobId: job.id,
            processed: processedInChunk,
            total: job.totalCount,
            done: false,
            status: "paused",
          };
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg === "DAILY_CAP_HIT") {
          const tomorrow = new Date();
          tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
          tomorrow.setUTCHours(0, 0, 0, 0);
          await prisma.enrichmentJob.update({
            where: { id: job.id },
            data: {
              status: "paused",
              resumeAt: tomorrow,
              processedCount: chunkStart + processedInChunk,
            },
          });
          return {
            jobId: job.id,
            processed: processedInChunk,
            total: job.totalCount,
            done: false,
            status: "paused",
          };
        }
        // Generic batch error — fall back to individual processing if onProcess is available
        if (onProcess) {
          console.warn(
            `[enrichment-queue] Batch failed for job ${job.id}, falling back to individual processing: ${errMsg}`,
          );
          // Reset processedInChunk (was 0) and let the individual loop below handle each entity
          processedInChunk = 0;
        } else {
          // No single-entity callback available — log error but mark as processed to avoid infinite loop
          errors.push({ entityId: "batch", error: errMsg });
          processedInChunk = chunk.length;
        }
      }
    }

    // Single mode: process entities one at a time.
    // Runs when: (a) no batch callback, (b) chunk has 1 entity, or
    // (c) batch callback failed with generic error and fell back (processedInChunk === 0).
    if (processedInChunk === 0 && onProcess) {
      for (const entityId of chunk) {
        try {
          await onProcess(entityId, {
            entityType: job.entityType,
            provider: job.provider,
            workspaceSlug: job.workspaceSlug,
          });
          processedInChunk++;
        } catch (err) {
          // Credit exhaustion — notify admin and pause the job with 1-hour resume
          if (isCreditExhaustion(err)) {
            await notifyCreditExhaustion({
              provider: (err as any).provider,
              httpStatus: (err as any).httpStatus,
              context: `enrichment queue processing (job ${job.id})`,
            });
            // Pause the job — resume in 1 hour (credits may be replenished or
            // a different provider in the waterfall may succeed)
            const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
            await prisma.enrichmentJob.update({
              where: { id: job.id },
              data: {
                status: "paused",
                resumeAt: oneHourFromNow,
                processedCount: chunkStart + processedInChunk,
              },
            });
            return {
              jobId: job.id,
              processed: processedInChunk,
              total: job.totalCount,
              done: false,
              status: "paused",
            };
          }
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg === "DAILY_CAP_HIT") {
            // Pause the job — resume at midnight UTC tomorrow
            const tomorrow = new Date();
            tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            tomorrow.setUTCHours(0, 0, 0, 0);
            await prisma.enrichmentJob.update({
              where: { id: job.id },
              data: {
                status: "paused",
                resumeAt: tomorrow,
                processedCount: chunkStart + processedInChunk,
              },
            });
            return {
              jobId: job.id,
              processed: processedInChunk,
              total: job.totalCount,
              done: false,
              status: "paused",
            };
          }
          errors.push({ entityId, error: errMsg });
          processedInChunk++;
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
