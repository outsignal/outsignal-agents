/**
 * Trigger.dev Scheduled Task: Credit Monitor
 *
 * Checks all provider credit balances hourly and upserts results into
 * the ProviderCreditBalance table. The Radar health endpoint reads from
 * this table instead of making live external API calls on every poll.
 *
 * Scheduled hourly at :30 past (e.g. 00:30, 01:30, 02:30, ...).
 */

import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { checkAllProviderBalances } from "@/lib/credits/provider-balances";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

const LOG_PREFIX = "[credit-monitor]";

export const creditMonitorTask = schedules.task({
  id: "credit-monitor",
  cron: "30 * * * *", // hourly at :30 past
  maxDuration: 60,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`${LOG_PREFIX} Starting credit balance check at ${timestamp}`);

    const balances = await checkAllProviderBalances();
    const now = new Date();
    const errors: string[] = [];

    for (const balance of balances) {
      try {
        await prisma.providerCreditBalance.upsert({
          where: { provider: balance.provider },
          create: {
            provider: balance.provider,
            status: balance.status,
            creditsRemaining: balance.creditsRemaining ?? null,
            details: balance.details,
            checkedAt: now,
          },
          update: {
            status: balance.status,
            creditsRemaining: balance.creditsRemaining ?? null,
            details: balance.details,
            checkedAt: now,
          },
        });
      } catch (err) {
        const msg = `Failed to upsert balance for ${balance.provider}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`${LOG_PREFIX} ${msg}`);
        errors.push(msg);
      }
    }

    console.log(
      `${LOG_PREFIX} Upserted ${balances.length - errors.length} of ${balances.length} provider balances. Errors: ${errors.length}`,
    );

    return {
      providersChecked: balances.length,
      providersUpserted: balances.length - errors.length,
      errors,
      providers: balances.map((b) => ({
        provider: b.provider,
        status: b.status,
        creditsRemaining: b.creditsRemaining,
      })),
    };
  },
});
