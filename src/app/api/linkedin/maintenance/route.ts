import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { progressWarmup } from "@/lib/linkedin/rate-limiter";
import { recoverStuckActions, expireStaleActions } from "@/lib/linkedin/queue";
import { updateAcceptanceRate } from "@/lib/linkedin/sender";

/**
 * LinkedIn daily maintenance cron.
 * Runs once per day (06:00 UTC) before UK business hours.
 *
 * 1. progressWarmup — advance warm-up day & limits per sender
 * 2. updateAcceptanceRate — recalculate acceptance rate per sender
 * 3. recoverStuckActions — reset actions stuck in "running"
 * 4. expireStaleActions — expire pending requests older than 14 days
 */
export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[linkedin/maintenance] Starting daily maintenance");

  const results = {
    warmup: { processed: 0, errors: [] as string[] },
    acceptanceRate: { processed: 0, errors: [] as string[] },
    stuckRecovered: null as number | null,
    staleExpired: null as number | null,
  };

  const activeSenders = await prisma.sender.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
  });

  console.log(`[linkedin/maintenance] ${activeSenders.length} active sender(s)`);

  // Per-sender maintenance
  for (const sender of activeSenders) {
    try {
      await progressWarmup(sender.id);
      results.warmup.processed++;
    } catch (err) {
      const msg = `${sender.name}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[linkedin/maintenance] progressWarmup failed: ${msg}`);
      results.warmup.errors.push(msg);
    }

    try {
      await updateAcceptanceRate(sender.id);
      results.acceptanceRate.processed++;
    } catch (err) {
      const msg = `${sender.name}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[linkedin/maintenance] updateAcceptanceRate failed: ${msg}`);
      results.acceptanceRate.errors.push(msg);
    }
  }

  // Global maintenance
  try {
    results.stuckRecovered = await recoverStuckActions();
  } catch (err) {
    console.error("[linkedin/maintenance] recoverStuckActions failed:", err);
  }

  try {
    results.staleExpired = await expireStaleActions();
  } catch (err) {
    console.error("[linkedin/maintenance] expireStaleActions failed:", err);
  }

  console.log(
    `[linkedin/maintenance] Done: warmup=${results.warmup.processed}/${activeSenders.length}, ` +
      `acceptanceRate=${results.acceptanceRate.processed}/${activeSenders.length}, ` +
      `stuckRecovered=${results.stuckRecovered ?? "error"}, ` +
      `staleExpired=${results.staleExpired ?? "error"}`,
  );

  return NextResponse.json({
    activeSenders: activeSenders.length,
    ...results,
  });
}
