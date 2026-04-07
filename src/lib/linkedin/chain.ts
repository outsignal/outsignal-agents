import { enqueueAction } from "./queue";
import type { LinkedInActionType } from "./types";

/**
 * Connection note convention:
 *
 * For "connect" action steps, the `body` field serves as the **connection note**
 * (the short message attached to a LinkedIn connection request).
 *
 * - If `body` is undefined or empty, the connection request is sent with NO note.
 *   This is the **recommended default** — blank connection requests have higher
 *   accept rates in cold outreach.
 * - If `body` is a non-empty string, it is sent as the connection note (max 300 chars
 *   enforced by LinkedIn).
 *
 * This is a deliberate design choice: a separate `connectionNote` field is unnecessary
 * because the `body`/`messageBody` field is contextually appropriate for both message
 * and connect actions. The LinkedIn API treats both as text payloads.
 */

/** Type alias documenting that messageBody doubles as the connection note for connect actions. */
export type ConnectionNote = string | undefined;

export interface ChainActionsParams {
  senderId: string;
  personId: string;
  workspaceSlug: string;
  sequence: Array<{
    position: number;
    type: string;
    /** For "message" actions: the message text. For "connect" actions: the connection note (blank = no note, recommended). */
    body?: ConnectionNote;
    delayDays?: number;
  }>;
  baseScheduledFor: Date;
  priority: number;
  campaignName?: string;
  emailBisonLeadId?: string;
}

/**
 * Schedule actions in a LinkedIn sequence with forward time offsets.
 *
 * IMPORTANT: This function should only receive steps UP TO and including
 * the connection request. Post-connection follow-up messages must be
 * handled via CampaignSequenceRules (triggerEvent: "connection_accepted")
 * and NOT pre-scheduled here. The deploy engine (deploy.ts) enforces
 * this split at the connection gate.
 *
 * The first action fires at baseScheduledFor (T).
 * Each subsequent action fires at the previous action's time + a random 0-2 day delay.
 * Minimum inter-step gap: 4 hours (avoids bursts when random() produces near-zero values).
 *
 * Returns an array of created action IDs.
 */
export async function chainActions(params: ChainActionsParams): Promise<string[]> {
  const { sequence, baseScheduledFor, ...common } = params;
  const sorted = [...sequence].sort((a, b) => a.position - b.position);
  const actionIds: string[] = [];
  let cumulativeMs = 0;
  let previousActionId: string | undefined;

  const MIN_GAP_MS = 4 * 60 * 60 * 1000; // 4 hours minimum between steps
  const MAX_DELAY_DAYS = 2;

  for (const step of sorted) {
    if (step.position > sorted[0].position) {
      // Random delay between steps: 4 hours to 2 days (or step.delayDays if specified)
      const delayDays = step.delayDays ?? Math.random() * MAX_DELAY_DAYS;
      const delayMs = delayDays * 24 * 60 * 60 * 1000;
      cumulativeMs += Math.max(delayMs, MIN_GAP_MS);
    }

    const scheduledFor = new Date(baseScheduledFor.getTime() + cumulativeMs);

    const actionId = await enqueueAction({
      ...common,
      actionType: step.type as LinkedInActionType,
      messageBody: step.body,
      scheduledFor,
      sequenceStepRef: `linkedin_${step.position}`,
      parentActionId: previousActionId,
    });

    actionIds.push(actionId);
    previousActionId = actionId;
  }

  return actionIds;
}
