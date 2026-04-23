import { schedules } from "@trigger.dev/sdk";
import { reconcileEmailBisonCampaignStatuses } from "@/lib/campaigns/emailbison-reconcile";

const LOG_PREFIX = "[emailbison-campaign-reconcile]";

export const emailBisonCampaignReconcileTask = schedules.task({
  id: "emailbison-campaign-reconcile",
  cron: "0 */2 * * *", // every 2 hours
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const startedAt = new Date().toISOString();
    console.log(`${LOG_PREFIX} Starting run at ${startedAt}`);

    const summary = await reconcileEmailBisonCampaignStatuses();

    console.log(
      `${LOG_PREFIX} Complete: checked=${summary.checked}, reconciled=${summary.reconciled}, ` +
        `aligned=${summary.alreadyAligned}, noToken=${summary.skippedNoToken}, ` +
        `unexpected=${summary.skippedUnexpectedStatus}, missingVendor=${summary.skippedMissingVendorCampaign}, ` +
        `concurrent=${summary.skippedConcurrentUpdate}, errors=${summary.errors.length}`,
    );

    return summary;
  },
});
