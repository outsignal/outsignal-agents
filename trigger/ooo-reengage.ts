import { task } from "@trigger.dev/sdk";
import { emailBisonQueue } from "./queues";

export interface OooReengagePayload {
  personEmail: string;
  workspaceSlug: string;
  oooReason: "holiday" | "illness" | "conference" | "generic";
  eventName: string | null;
  originalCampaignId: string | null;
  ebLeadId: number | null;
  reengagementId: string;
}

// Stub — full Welcome Back campaign implementation in Plan 02
export const oooReengage = task({
  id: "ooo-reengage",
  queue: emailBisonQueue,
  maxDuration: 120,

  run: async (payload: OooReengagePayload) => {
    console.log("[ooo-reengage] task triggered", {
      personEmail: payload.personEmail,
      workspaceSlug: payload.workspaceSlug,
      oooReason: payload.oooReason,
      reengagementId: payload.reengagementId,
    });

    // Full implementation in Plan 02:
    // - Fetch original campaign step copy from EB API
    // - Pass to writer agent for OOO-aware personalisation
    // - Enroll lead into welcome-back campaign via EB API
    // - Update OooReengagement record status → "sent"
    // - Send Slack notification to workspace reply channel

    return payload;
  },
});
