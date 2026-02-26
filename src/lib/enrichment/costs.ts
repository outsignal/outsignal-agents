/**
 * Cost tracking and daily cap enforcement for enrichment pipeline.
 * Provider costs are fixed values updated manually when pricing changes.
 */
import { prisma } from "@/lib/db";

/** Fixed cost per API call by provider. Update when pricing changes. */
export const PROVIDER_COSTS: Record<string, number> = {
  prospeo: 0.002,
  leadmagic: 0.005,
  findymail: 0.001,
  aiark: 0.003,
  firecrawl: 0.001,
};

const DEFAULT_DAILY_CAP_USD = 10.0;

function getDailyCap(): number {
  return parseFloat(process.env.ENRICHMENT_DAILY_CAP_USD ?? String(DEFAULT_DAILY_CAP_USD));
}

/** Returns "YYYY-MM-DD" in UTC for today. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Check if the daily enrichment spending cap has been reached. */
export async function checkDailyCap(): Promise<boolean> {
  const today = todayUtc();
  const record = await prisma.dailyCostTotal.findUnique({ where: { date: today } });
  return (record?.totalUsd ?? 0) >= getDailyCap();
}

/**
 * Increment today's spend by costUsd for the given provider.
 * Uses upsert — creates today's row if it doesn't exist.
 * Note: check + increment is NOT atomic. Accepts small overspend risk
 * (one chunk worth) rather than adding transaction overhead.
 */
export async function incrementDailySpend(provider: string, costUsd: number): Promise<void> {
  const today = todayUtc();

  // Upsert the daily total
  await prisma.dailyCostTotal.upsert({
    where: { date: today },
    update: { totalUsd: { increment: costUsd } },
    create: { date: today, totalUsd: costUsd },
  });
}
