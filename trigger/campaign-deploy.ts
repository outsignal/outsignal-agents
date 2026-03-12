import { task } from "@trigger.dev/sdk";
import { executeDeploy, retryDeployChannel } from "@/lib/campaigns/deploy";

interface CampaignDeployPayload {
  campaignId: string;
  deployId: string;
  retryChannel?: "email" | "linkedin";
}

export const campaignDeployTask = task({
  id: "campaign-deploy",
  // No queue — campaign deploys are infrequent (a few per day at most)
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async (payload: CampaignDeployPayload) => {
    if (payload.retryChannel) {
      console.log(
        `[campaign-deploy] Retrying deploy ${payload.deployId} channel=${payload.retryChannel}`,
      );
      await retryDeployChannel(payload.deployId, payload.retryChannel);
      return { deployId: payload.deployId, action: "retry", channel: payload.retryChannel };
    } else {
      console.log(
        `[campaign-deploy] Executing deploy ${payload.deployId} for campaign ${payload.campaignId}`,
      );
      await executeDeploy(payload.campaignId, payload.deployId);
      return { deployId: payload.deployId, action: "deploy", campaignId: payload.campaignId };
    }
  },
});
