// worker-signals entry point
// Called by Railway cron every 6 hours (see railway.toml: cronSchedule = "0 */6 * * *")
// Runs the full signal poll cycle then triggers signal campaign processing in the main app.

import { runCycle } from "./cycle.js";
import { prisma } from "./db.js";

/**
 * Trigger signal campaign processing in the main app.
 * Best-effort — failure is logged but doesn't crash the worker.
 * Signal events are already written by the time this fires.
 */
async function triggerSignalPipeline(): Promise<void> {
  const appUrl = process.env.MAIN_APP_URL;
  const secret = process.env.PIPELINE_INTERNAL_SECRET;

  if (!appUrl || !secret) {
    console.log("[SignalWorker] MAIN_APP_URL or PIPELINE_INTERNAL_SECRET not set — skipping pipeline trigger");
    return;
  }

  const url = `${appUrl}/api/pipeline/signal-campaigns/process`;
  console.log(`[SignalWorker] Triggering signal campaign pipeline: ${url}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-pipeline-secret": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ triggeredAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(55_000), // 55s timeout (just under Vercel's limit)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[SignalWorker] Pipeline trigger failed (${res.status}): ${body}`);
    } else {
      const result = await res.json().catch(() => ({})) as {
        campaignsProcessed?: number;
        totalLeadsAdded?: number;
      };
      console.log(
        `[SignalWorker] Pipeline complete — campaigns: ${result.campaignsProcessed ?? 0}, ` +
        `leads added: ${result.totalLeadsAdded ?? 0}`
      );
    }
  } catch (error) {
    // Log but don't crash — signal events are already written
    console.error("[SignalWorker] Pipeline trigger error:", error);
  }
}

async function main() {
  console.log(`[SignalWorker] Starting cycle at ${new Date().toISOString()}`);
  try {
    await runCycle();
    console.log(`[SignalWorker] Cycle complete at ${new Date().toISOString()}`);

    // Trigger signal campaign processing after signals are written
    await triggerSignalPipeline();
  } catch (error) {
    console.error("[SignalWorker] Fatal error:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  }
}

main();
