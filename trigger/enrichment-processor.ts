import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { processNextChunk } from "@/lib/enrichment/queue";
import { enrichEmail, enrichEmailBatch, enrichCompany, createCircuitBreaker } from "@/lib/enrichment/waterfall";
import type { PersonForEnrichment } from "@/lib/enrichment/waterfall";
import { postMessage } from "@/lib/slack";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

const LOG_PREFIX = "[enrichment-processor]";
const OPS_CHANNEL = process.env.OPS_SLACK_CHANNEL_ID;

export const enrichmentProcessorTask = schedules.task({
  id: "enrichment-processor",
  cron: "*/5 * * * *", // every 5 minutes
  maxDuration: 300,
  // Prevent overlapping runs picking up the same job
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`${LOG_PREFIX} Starting enrichment processor run at ${timestamp}`);

    // Recover jobs stuck in "running" for >10 minutes (crashed previous run)
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const recovered = await prisma.enrichmentJob.updateMany({
      where: { status: "running", updatedAt: { lt: staleThreshold } },
      data: { status: "pending" },
    });
    if (recovered.count > 0) {
      console.log(`${LOG_PREFIX} Recovered ${recovered.count} stale "running" jobs to "pending"`);
    }

    // Fresh circuit breaker per run — shared across all jobs in this invocation
    const breaker = createCircuitBreaker();

    const onProcess = async (
      entityId: string,
      job: { entityType: string; provider: string; workspaceSlug?: string | null },
    ) => {
      if (job.entityType === "person") {
        const person = await prisma.person.findUniqueOrThrow({ where: { id: entityId } });
        await enrichEmail(
          entityId,
          {
            linkedinUrl: person.linkedinUrl ?? undefined,
            firstName: person.firstName ?? undefined,
            lastName: person.lastName ?? undefined,
            companyName: person.company ?? undefined,
            companyDomain: person.companyDomain ?? undefined,
          },
          breaker,
          job.workspaceSlug ?? undefined,
        );
      } else if (job.entityType === "company") {
        const company = await prisma.company.findUniqueOrThrow({ where: { id: entityId } });
        await enrichCompany(company.domain, breaker, job.workspaceSlug ?? undefined);
      }
    };

    // Batch callback for person enrichment — uses parallel bulk APIs
    const onProcessBatch = async (
      entityIds: string[],
      job: { entityType: string; provider: string; workspaceSlug?: string | null },
    ) => {
      if (job.entityType === "person") {
        // Load all person records for the batch
        const persons = await prisma.person.findMany({
          where: { id: { in: entityIds } },
        });

        const personMap = new Map(persons.map((p) => [p.id, p]));
        const batchInput: PersonForEnrichment[] = entityIds
          .filter((id) => personMap.has(id))
          .map((id) => {
            const p = personMap.get(id)!;
            return {
              personId: p.id,
              firstName: p.firstName,
              lastName: p.lastName,
              linkedinUrl: p.linkedinUrl,
              companyDomain: p.companyDomain,
              companyName: p.company,
              email: p.email,
            };
          });

        const summary = await enrichEmailBatch(batchInput, breaker, job.workspaceSlug ?? undefined);
        console.log(
          `${LOG_PREFIX} Batch enrichment: ${summary.total} total, ${summary.enriched} enriched, ${summary.verified} verified, ${summary.failed} failed`,
        );
      } else {
        // Company enrichment: no batch mode — process one by one
        for (const entityId of entityIds) {
          const company = await prisma.company.findUniqueOrThrow({ where: { id: entityId } });
          await enrichCompany(company.domain, breaker, job.workspaceSlug ?? undefined);
        }
      }
    };

    // Stats tracking
    let totalChunks = 0;
    let jobsCompleted = 0;
    let jobsFailed = 0;
    let jobsPaused = 0;

    // Elapsed-time guard: break at 240s to leave 60s buffer before maxDuration (300s) kills the task
    const startTime = Date.now();
    const MAX_RUN_MS = 240_000;

    // Process all pending jobs
    while (true) {
      if (Date.now() - startTime > MAX_RUN_MS) {
        console.log(`${LOG_PREFIX} Approaching maxDuration (${Math.round((Date.now() - startTime) / 1000)}s elapsed), exiting loop gracefully`);
        break;
      }
      let result;
      try {
        result = await processNextChunk(onProcess, onProcessBatch);
      } catch (err) {
        console.error(`${LOG_PREFIX} processNextChunk threw:`, err);
        jobsFailed++;
        break;
      }

      // No more pending jobs — exit
      if (!result) {
        console.log(`${LOG_PREFIX} No more pending jobs`);
        break;
      }

      totalChunks++;

      // Log progress for each chunk
      console.log(
        `${LOG_PREFIX} Job ${result.jobId}: ${result.processed}/${result.total} (${result.status})`,
      );

      if (result.done) {
        jobsCompleted++;
        console.log(
          `${LOG_PREFIX} Completed job ${result.jobId}: ${result.total} entities (${result.status})`,
        );
      } else if (result.status === "paused") {
        jobsPaused++;
        console.log(
          `${LOG_PREFIX} Paused job ${result.jobId}: ${result.processed}/${result.total} (${result.status})`,
        );
        // Daily cap hit — stop the entire run. Don't cascade-pause remaining jobs.
        break;
      }

      // If this job is done, loop to pick up the next one; otherwise keep processing chunks
      if (result.done) {
        continue;
      }

      // Throttle between chunks to avoid hammering enrichment APIs
      await new Promise((r) => setTimeout(r, 200));
    }

    // Slack summary for completed/failed jobs
    if ((jobsCompleted > 0 || jobsFailed > 0 || jobsPaused > 0) && OPS_CHANNEL) {
      const parts: string[] = [];
      if (jobsCompleted > 0) parts.push(`${jobsCompleted} completed`);
      if (jobsFailed > 0) parts.push(`${jobsFailed} failed`);
      if (jobsPaused > 0) parts.push(`${jobsPaused} paused`);

      const summary = `Enrichment processor: ${parts.join(", ")} (${totalChunks} chunks processed)`;

      try {
        await postMessage(OPS_CHANNEL, summary);
      } catch (slackErr) {
        console.error(`${LOG_PREFIX} Failed to send Slack summary:`, slackErr);
      }
    }

    console.log(
      `${LOG_PREFIX} Run complete: ${totalChunks} chunks, ${jobsCompleted} completed, ${jobsFailed} failed, ${jobsPaused} paused`,
    );

    return {
      totalChunks,
      jobsCompleted,
      jobsFailed,
      jobsPaused,
    };
  },
});
