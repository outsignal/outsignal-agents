import { schedules } from "@trigger.dev/sdk";
import { notifyDeliverabilityDigest } from "@/lib/notifications";

export const deliverabilityDigestTask = schedules.task({
  id: "deliverability-digest",
  cron: "20 8 * * 1", // weekly Monday 8:20am UTC (staggered from domain-health/insights)
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    console.log("[deliverability-digest] Starting weekly deliverability digest");

    await notifyDeliverabilityDigest();

    console.log("[deliverability-digest] Digest complete");

    return { ok: true };
  },
});
