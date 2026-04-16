/**
 * Email channel adapter — wraps EmailBisonClient behind the ChannelAdapter
 * interface.
 *
 * Stateless pattern: resolves workspace apiToken fresh inside each method.
 * Zero new business logic — only wraps existing client methods.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";
import {
  transformSenderNames,
  type SenderRoster,
} from "@/lib/emailbison/sender-name-transform";
import { getCampaign } from "@/lib/campaigns/operations";
import { withRetry } from "@/lib/utils/retry";
import { CHANNEL_TYPES } from "./constants";
import type {
  ChannelAdapter,
  CampaignChannelRef,
  DeployParams,
  DeployResult,
  UnifiedMetrics,
  UnifiedLead,
  UnifiedAction,
  UnifiedStep,
} from "./types";

/**
 * Deploy step numbering — matches the 10-step target flow in the Phase 3
 * handover (docs: handover-2026-04-15-deploy-rebuild.md §5).
 *
 * We encode the failing step number into CampaignDeploy.emailError as a
 * `[step:N]` prefix so operators can trace a partial-deploy failure to a
 * specific stage without needing a schema change. Phase 3 is refactor-only
 * (no Prisma migration), so we intentionally do NOT add a `failedAtStep`
 * column — see .monty/memory/decisions.md 2026-04-15T20:45:00Z.
 */
const DEPLOY_STEP = {
  CREATE_OR_REUSE_CAMPAIGN: 1,      // Step 1 — createCampaign or GET-verify existing
  PERSIST_EB_CAMPAIGN_ID: 2,        // Step 2 — mirror onto Campaign + CampaignDeploy
  UPSERT_SEQUENCE_STEPS: 3,         // Step 3 — GET existing steps → diff by position → POST missing
  ATTACH_LEADS: 4,                  // Step 4 — createLead per person + attach-leads batch
  UPSERT_SCHEDULE: 5,               // Step 5 — getSchedule → updateSchedule or createSchedule
  ATTACH_SENDERS: 6,                // Step 6 — attach-sender-emails
  UPDATE_SETTINGS: 7,               // Step 7 — PATCH /campaigns/{id}/update
  ATTACH_TAGS: 8,                   // Step 8 — POST /tags/attach-to-campaigns (no-op: see below)
  RESUME_LAUNCH: 9,                 // Step 9 — PATCH /campaigns/{id}/resume
  VERIFY_STATUS: 10,                // Step 10 — GET /campaigns/{id} → assert queued|launching|active
} as const;

/**
 * Zod guard for the EB campaign object subset we consume post-resume.
 *
 * BL-068 convention (Phase 2) — parse at the EB API boundary, no silent `as`
 * casts on response data. Status is coerced to lowercase at the consumer for
 * case-insensitive matching against the EB docs terminal set
 * {queued, launching, active}. Full Campaign shape stays typed upstream; we
 * only validate the fields we actually read here.
 */
const EbCampaignStatusSchema = z
  .object({
    id: z.number(),
    status: z.string(),
  })
  .passthrough();

/**
 * Case-insensitive set of EB statuses that indicate a successful launch
 * post-resume. Per docs/emailbison-dedi-api-reference.md — after
 * PATCH /campaigns/{id}/resume, a healthy transition is DRAFT → QUEUED →
 * LAUNCHING → ACTIVE. Any other state (paused, completed, draft, failed,
 * etc.) means the resume didn't take.
 */
const LAUNCHED_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "launching",
  "active",
]);

// ---------------------------------------------------------------------------
// Local types for email deploy
// ---------------------------------------------------------------------------

/**
 * Zod schema for a stored email sequence step read from Campaign.emailSequence
 * (Prisma `unknown[] | null`). Mirrors the Phase 2 `LinkedInSequenceStepSchema`
 * discipline: parse at the DB boundary, no silent `as` casts.
 *
 * BL-068 shape-drift guard — `position` is REQUIRED. The email Step 3 loop
 * keys idempotency on `step.position` via `existingPositions.has(...)`. If
 * a future writer drifts to `stepNumber` on the email side, `position`
 * would be undefined and `.has(undefined)` would always return false —
 * causing every step to be re-POSTed on every re-run (silent EB
 * duplication → double-send to every lead). By requiring `position` at
 * the parse boundary, we fail loud at deploy entry rather than silently
 * at the critical section.
 *
 * Fields validated are exactly those the Step 3 loop consumes; extras
 * survive via passthrough().
 */
const StoredEmailSequenceStepSchema = z
  .object({
    position: z.number().int(),
    subjectLine: z.string().optional(),
    subjectVariantB: z.string().optional(),
    body: z.string().optional(),
    bodyText: z.string().optional(),
    delayDays: z.number().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const StoredEmailSequenceSchema = z.array(StoredEmailSequenceStepSchema);

type EmailSequenceStep = z.infer<typeof StoredEmailSequenceStepSchema>;

/**
 * Default sending schedule for newly-deployed email campaigns: Mon-Fri
 * 09:00-17:00 Europe/London. No schema change — hardcoded constant to keep
 * Phase A scope tight. A future phase can expose this on Workspace.
 *
 * BL-087 (2026-04-16): `save_as_template` is REQUIRED on POST in EB v1.1
 * (the EB docs at docs/emailbison-dedi-api-reference.md lines 152-169 still
 * describe it as optional, but the live API rejected the fresh-deploy POST
 * for canary EB 83 with 422 "The save as template field is required."). Always
 * send `false` — per-campaign schedules are workspace-default and we don't
 * want them polluting the workspace's schedule-template list. Doc comment
 * updated to flag the drift; the docs file should be re-synced when EB ships
 * an updated reference.
 *
 * The PUT (updateSchedule) path requires save_as_template per the spec
 * (line 198), so the same value flows through both paths from this constant —
 * removes the inline override that previously lived at the call site.
 */
const DEFAULT_SCHEDULE = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
  start_time: "09:00",
  end_time: "17:00",
  timezone: "Europe/London",
  save_as_template: false,
} as const;

/**
 * Default campaign settings applied via PATCH /campaigns/{id}/update after
 * senders are attached — keeps EB state consistent with our deliverability
 * posture regardless of what createCampaign defaulted to.
 *
 * BL-093 (2026-04-16) — `can_unsubscribe` flipped true → false. Per the
 * Outsignal cold-outreach copy rules ("no links/images in cold" — see
 * writer-rules.md banned-pattern list), we MUST NOT include a one-click
 * unsubscribe link in cold sequence steps. The link is itself a link
 * (hurts deliverability + spam scores) and the prospect's relationship
 * with the sender is too cold for a formal unsub UX. Recipients who want
 * to opt out reply asking to be removed and the inbox monitor handles it.
 *
 * NB: the EB campaign-settings field is named `can_unsubscribe` (per
 * docs/emailbison-dedi-api-reference.md line 146 — "Whether recipients
 * can unsubscribe from the campaign using a one-click link. If nothing
 * sent, false is assumed."). We send `false` explicitly so the setting
 * is durable across re-deploys regardless of EB-side defaults drifting.
 */
const DEFAULT_CAMPAIGN_SETTINGS = {
  plain_text: true,
  open_tracking: false,
  reputation_building: true,
  can_unsubscribe: false,
} as const;

/**
 * BL-093 (2026-04-16) — per-campaign sender allocation map.
 *
 * Hardcoded round-robin allocation across the 1210-solutions workspace's
 * 58 healthy email senders, sorted by `Sender.emailBisonSenderId` ascending.
 * Each of the 5 1210 email campaigns gets a stable disjoint subset of
 * ~11-12 senders. The Allocation rule is `idx % 5 === bucketForCampaign`,
 * where the campaign-to-bucket mapping is captured here.
 *
 * Pragmatic stop-gap until `Campaign.allocatedSenderIds` schema field +
 * UI + migration land (BL-094). Add a campaignId here ONLY when an ops
 * decision has been made about which senders own that campaign.
 *
 * The mapping is keyed by EmailBison senderEmailId (the int that EB uses
 * for the attach-sender-emails API). Senders are pinned by EB-side ID so
 * the allocation is durable across DB row CUID changes (e.g. if a Sender
 * is deleted and recreated, its EB ID is preserved upstream).
 *
 * Verification: scripts/maintenance/_bl093-derive-allocation.ts reproduces
 * this map by querying the live DB sender pool and applying:
 *   ```
 *   ids.forEach((id, idx) => buckets[idx % 5].push(id));
 *   ```
 * Bucket order: Construction=0, Green=1, Healthcare=2, Industrial=3,
 * Facilities=4.
 *
 * Verified 2026-04-16 against live DB. Sender pool (58 EB IDs, EB-ID-asc):
 *   631..660, then 661, 662, 663, 666..690.
 * 664/665 are absent from the pool (not healthy / not channel-eligible /
 * no EB ID); 661/662/663 ARE present. F1 correction (monty-qa BL-093
 * review) — earlier draft of this map inverted buckets 0/1/2 by assuming
 * 663/664/665 were the round-robin members at idx 30/31/32; live DB shows
 * 661/662/663 instead. Run the derive script before editing this map.
 */
const CAMPAIGN_SENDER_ALLOCATION: Record<string, readonly number[]> = {
  // 1210 Solutions — Construction (bucket 0)
  cmneq92p20000p8p7dhqn8g42: [631, 636, 641, 646, 651, 656, 661, 668, 673, 678, 683, 688],
  // 1210 Solutions — Green List Priority (bucket 1)
  cmneq1sdj0001p8cg97lb9rhd: [632, 637, 642, 647, 652, 657, 662, 669, 674, 679, 684, 689],
  // 1210 Solutions — Healthcare (bucket 2)
  cmneqhwo50001p843r5hmsul3: [633, 638, 643, 648, 653, 658, 663, 670, 675, 680, 685, 690],
  // 1210 Solutions — Industrial/Warehouse (bucket 3)
  cmneqa5180001p8rkwyrrlkg8: [634, 639, 644, 649, 654, 659, 666, 671, 676, 681, 686],
  // 1210 Solutions — Facilities/Cleaning (bucket 4 — CANARY EB 88)
  cmneqixpv0001p8710bov1fga: [635, 640, 645, 650, 655, 660, 667, 672, 677, 682, 687],
};

/**
 * Resolve the per-campaign sender subset for a given campaign ID.
 *
 * - If the campaign is in CAMPAIGN_SENDER_ALLOCATION → return the
 *   intersection of (allocated EB IDs) ∩ (workspace's healthy senders).
 *   The intersection guards against allocations that reference a sender
 *   which has since been deleted, paused, or marked unhealthy — those
 *   senders are silently dropped from the wire payload.
 * - Else → return all workspace senders (pre-BL-093 behaviour). This is
 *   the safe fallback for workspaces / campaigns not yet ops-allocated.
 *
 * Exported for unit-test visibility; not called externally.
 */
export function resolveAllocatedSenders(
  campaignId: string,
  allWorkspaceSenderIds: readonly number[],
): number[] {
  const allocated = CAMPAIGN_SENDER_ALLOCATION[campaignId];
  if (!allocated) {
    // No allocation declared for this campaign — fall back to all senders.
    return [...allWorkspaceSenderIds];
  }
  const allowed = new Set(allWorkspaceSenderIds);
  return allocated.filter((id) => allowed.has(id));
}

/**
 * BL-100 (2026-04-16) — build a `SenderRoster` from a set of Sender rows.
 *
 * The roster is consumed by `transformSenderNames` in
 * `src/lib/emailbison/sender-name-transform.ts`. We split each Sender's
 * `name` field into first/last tokens so the transformer can match
 * either "Daniel Lazarus" (full) or "Daniel" / "Lazarus" (fragments) in
 * the signature region of a step body.
 *
 * Splitting rules:
 *   - Single-word names (e.g. "Cher") → contribute only firstNames +
 *     fullNames=[name]. lastNames gets nothing.
 *   - Two+ word names → firstNames=[first], lastNames=[rest.join(" ")],
 *     fullNames=[full]. The multi-word trailing path supports names
 *     like "Mary Jane Smith" where the effective last-name block is
 *     "Jane Smith"; the writer conventionally signs with "Mary" alone
 *     (first) or the full name, so this split covers the common cases.
 *   - Empty/null/whitespace-only names → silently skipped (no crash).
 *   - Duplicate names across senders are deduplicated — all three
 *     output arrays contain distinct values only.
 *
 * Exported for unit-test visibility; not used outside this module.
 */
export function buildSenderRoster(
  senders: readonly { name: string | null }[],
): SenderRoster {
  const firstNames = new Set<string>();
  const lastNames = new Set<string>();
  const fullNames = new Set<string>();

  for (const s of senders) {
    const raw = s.name?.trim();
    if (!raw) continue;
    // Collapse internal whitespace so "Daniel   Lazarus" → "Daniel Lazarus".
    const normalized = raw.replace(/\s+/g, " ");
    const parts = normalized.split(" ");
    if (parts.length === 0) continue;

    fullNames.add(normalized);
    firstNames.add(parts[0]);
    if (parts.length > 1) {
      lastNames.add(parts.slice(1).join(" "));
    }
  }

  return {
    firstNames: Array.from(firstNames),
    lastNames: Array.from(lastNames),
    fullNames: Array.from(fullNames),
  };
}

/**
 * Build the EB v1.1 `sequence_steps` wire shape from a stored
 * `emailSequence` array, applying the BL-093 thread_reply rules.
 *
 * Behaviour (verified 2026-04-16 against canary EB 87 + live Lime
 * production campaigns 26/31/32/42/43/44/45):
 *   - Step 1 (lowest `position`): `thread_reply=false`, populated subject
 *     verbatim. Empty subject → `(no subject)` placeholder + console.warn.
 *   - Follow-up step with empty `subjectLine`: `thread_reply=true`,
 *     `subject = firstStepSubject` (RAW; EB auto-prepends "Re: " server
 *     side). Sending "Re: <X>" yourself produces stored "Re: Re: <X>".
 *   - Follow-up step with populated `subjectLine`: `thread_reply=false`,
 *     own subject verbatim → fresh thread.
 *
 * Extracted into a shared helper (BL-093 monty-qa F2) so the two callers
 * — `EmailAdapter.deploy` Step 3 and `agents/campaign.ts` signal-campaign
 * pre-provisioning — produce identical wire payloads. Pre-extraction the
 * signal path skipped `thread_reply` entirely, so a follow-up step with
 * empty `subjectLine` 422'd EB on activation. Keep this helper in sync
 * with the per-step decision documented at email-adapter Step 3.
 *
 * Note: idempotency / GET-then-diff is the CALLER'S responsibility. The
 * caller passes the FULL stored sequence (so step 1 can be identified
 * and its subject reused for threaded follow-ups) and a separate filter
 * predicate identifying which steps to actually emit. The deploy-path
 * caller filters out steps already-present in EB; the signal-campaign
 * caller emits all steps. Filtering BEFORE this helper would lose the
 * step-1 anchor and silently mis-thread follow-ups when a partial
 * re-deploy sends only step 2.
 *
 * @param fullSequence - The complete stored sequence (used to identify
 *   step 1 by lowest position and capture its subject).
 * @param contextLabel - Human-readable label used in the "empty subject
 *   on FIRST step" warn — typically "Campaign cmXXX ('Name')" so
 *   operators can grep their logs.
 * @param shouldEmit - Optional predicate; when omitted, all steps are
 *   emitted. The deploy path passes a "not in EB yet" predicate.
 */
export function buildSequenceStepsForEB(
  fullSequence: readonly EmailSequenceStep[],
  contextLabel?: string,
  shouldEmit?: (step: EmailSequenceStep) => boolean,
): Array<{
  position: number;
  subject: string;
  body: string;
  delay_days: number;
  thread_reply: boolean;
}> {
  const sortedByPosition = [...fullSequence].sort(
    (a, b) => a.position - b.position,
  );
  const firstStepPosition = sortedByPosition[0]?.position;
  const firstStepSubjectRaw = sortedByPosition[0]?.subjectLine;
  const firstStepSubject =
    firstStepSubjectRaw && firstStepSubjectRaw.trim() !== ""
      ? firstStepSubjectRaw
      : "(no subject)";

  const emitFilter = shouldEmit ?? (() => true);

  return fullSequence.filter(emitFilter).map((step) => {
    const isEmptySubject =
      !step.subjectLine || step.subjectLine.trim() === "";
    const isFirstStep = step.position === firstStepPosition;

    if (isFirstStep) {
      // Initial step is always a fresh thread (there's nothing to thread
      // under). Empty subject is a defensive edge case — emit a placeholder
      // + warn so operators notice the upstream writer drift, but do NOT
      // thread.
      if (isEmptySubject) {
        console.warn(
          `[email-adapter] BL-093: ${contextLabel ?? "(no context)"} has empty subjectLine on its FIRST sequence step (position ${step.position}). Using placeholder '(no subject)' — review stored emailSequence shape.`,
        );
      }
      return {
        position: step.position,
        subject: isEmptySubject ? "(no subject)" : (step.subjectLine as string),
        body: step.body ?? step.bodyText ?? "",
        delay_days: step.delayDays ?? 1,
        thread_reply: false,
      };
    }

    // Follow-up step. EB v1.1 auto-prepends "Re: " when thread_reply=true,
    // so we send the RAW firstStepSubject to land on stored "Re: <X>"
    // (single Re:). Populated subject → fresh thread, no auto-prefix.
    return {
      position: step.position,
      subject: isEmptySubject
        ? firstStepSubject // EB will auto-prepend "Re: "
        : (step.subjectLine as string),
      body: step.body ?? step.bodyText ?? "",
      delay_days: step.delayDays ?? 1,
      thread_reply: isEmptySubject,
    };
  });
}

export class EmailAdapter implements ChannelAdapter {
  readonly channel = CHANNEL_TYPES.EMAIL;

  // ---------------------------------------------------------------------------
  // Private helper — resolve a fresh client per call (no caching)
  // ---------------------------------------------------------------------------

  private async getClient(workspaceSlug: string): Promise<EmailBisonClient> {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: workspaceSlug },
      select: { apiToken: true },
    });
    if (!ws.apiToken)
      throw new Error(`Workspace '${workspaceSlug}' has no API token`);
    return new EmailBisonClient(ws.apiToken);
  }

  // ---------------------------------------------------------------------------
  // deploy — full email channel deploy (moved from deploy.ts in Phase 73)
  // ---------------------------------------------------------------------------

  async deploy(params: DeployParams): Promise<void> {
    const { deployId, campaignId, campaignName, workspaceSlug } = params;
    const skipResume = params.skipResume === true;

    // Mark email channel as running
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: { emailStatus: "running" },
    });

    const ebClient = await this.getClient(workspaceSlug);

    // Track which step we're on so the `catch` block can encode the failure
    // step into emailError (`[step:N] <msg>`). This is the compensating-
    // transaction contract: on any throw, we record WHICH step failed so the
    // PM can decide whether to retry idempotently or roll back.
    let currentStep: number = DEPLOY_STEP.CREATE_OR_REUSE_CAMPAIGN;

    try {
      // -----------------------------------------------------------------
      // Step 1 — Create OR reuse EB campaign (idempotent)
      //
      // Load the full campaign detail FIRST so we can (a) read
      // emailBisonCampaignId for the idempotency check, and (b) reuse the
      // same loaded record for steps 3+ (sequence, targetListId). This
      // avoids an extra DB round-trip vs a dedicated findUnique, and
      // keeps the control flow linear.
      //
      // If campaign.emailBisonCampaignId is already set from a prior
      // deploy, GET it from EB to verify it still exists. Three outcomes:
      //   - GET succeeds → reuse the ID, skip createCampaign
      //   - GET returns 404 (isNotFoundError — covers both
      //     EmailBisonApiError with status=404/isRecordNotFound AND
      //     EmailBisonError with code=CAMPAIGN_NOT_FOUND/statusCode=404,
      //     BL-078): manual-delete case: FAIL with failedAtStep=1. Do NOT
      //     silently create a new one — the operator needs to explicitly
      //     decide (rollback emailBisonCampaignId on Campaign, or delete
      //     the CampaignDeploy row) before re-running.
      //   - Any other error → rethrow so it's captured in the outer catch.
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.CREATE_OR_REUSE_CAMPAIGN;
      const campaign = await getCampaign(campaignId);
      if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
      }
      const preExistingEbId: number | null = campaign.emailBisonCampaignId ?? null;

      let ebCampaignId: number;
      if (preExistingEbId != null) {
        // Idempotency path — verify the EB campaign still exists before
        // reusing. EmailBisonClient.getCampaign throws on any non-2xx so
        // we can distinguish 404 (record_not_found) from transient
        // failures.
        try {
          const existing = await withRetry(() =>
            ebClient.getCampaign(preExistingEbId),
          );
          ebCampaignId = existing.id;
          console.log(
            `[email-adapter] Reusing existing EB campaign ${ebCampaignId} for '${campaignName}' (idempotent re-run)`,
          );
        } catch (err) {
          // 404 / record_not_found → EB campaign was manually deleted.
          // Surface explicitly: the operator must roll back or decide.
          // isNotFoundError covers both EmailBisonApiError (HTTP 404) and
          // EmailBisonError (200-with-empty-data during EB's async DELETE
          // queue window) — BL-078 / Phase 6a-rollback QA F1.
          if (isNotFoundError(err)) {
            throw new Error(
              `EB campaign ${preExistingEbId} referenced by Campaign ${campaignId} no longer exists in EmailBison (manual delete?). Will not silently re-create — clear Campaign.emailBisonCampaignId first, then re-deploy.`,
            );
          }
          throw err;
        }
      } else {
        // Fresh deploy — create the EB campaign for the first time.
        //
        // BL-076 (Phase 6.5b Bundle C): DO NOT wrap createCampaign in
        // withRetry. Phase 6a root cause was a withRetry-induced duplicate —
        // if EB successfully creates the campaign but the client doesn't
        // see a 2xx response (timeout, transient 5xx, network flap),
        // withRetry's next attempt creates a SECOND EB draft, orphaning
        // the first. createCampaign is non-idempotent server-side so
        // client-level retry is unsafe. Transient failures are handled
        // instead by Trigger.dev's task-level retry — on re-entry,
        // executeDeploy restores Campaign.emailBisonCampaignId from
        // CampaignDeploy (see deploy.ts BL-076 restore block), and Step 1
        // takes the reuse path via preExistingEbId, so no duplicate EB
        // campaign is created on retry.
        const ebCampaign = await ebClient.createCampaign({ name: campaignName });
        ebCampaignId = ebCampaign.id;
      }

      // -----------------------------------------------------------------
      // Step 2 — Persist emailBisonCampaignId on BOTH CampaignDeploy and
      // Campaign records (idempotent write — same ID on every re-run).
      //
      // BL-076 (Phase 6.5b Bundle C): WRITE ORDER matters for Trigger.dev
      // retry recovery. We write CampaignDeploy FIRST, then Campaign. The
      // CampaignDeploy row is the durable anchor that survives Bundle B's
      // terminal-failure rollback (which clears Campaign.emailBisonCampaignId
      // but leaves CampaignDeploy fields untouched). On a retry re-entry
      // (deploy.ts executeDeploy), we read CampaignDeploy.emailBisonCampaignId
      // to restore Campaign state — if we wrote Campaign first and the
      // process died between the two writes, there'd be a window where the
      // EB ID lives on Campaign but not CampaignDeploy and the retry anchor
      // is missing. CampaignDeploy-first closes that window.
      //
      // BL-070 race guard — Campaign.emailBisonCampaignId is UNIQUE. Two
      // concurrent deploys of the same Campaign can both take the
      // fresh-deploy branch in Step 1 and each createCampaign on EB,
      // producing two EB drafts. When the loser tries to write back to
      // Campaign, Prisma raises P2002. We catch, re-read the winning ID
      // the other deploy persisted, delete our orphan EB campaign, and
      // re-write CampaignDeploy with the winner's ID before continuing.
      // If the EmailBison delete itself fails we surface a loud warning
      // rather than aborting the deploy — the write-back winner is the
      // correct campaign and subsequent steps are safe to run against it;
      // the orphan becomes a documented cleanup task (BL-072).
      //
      // The idempotent reuse branch in Step 1 can never trigger P2002
      // because it reuses the already-persisted ID — the update becomes a
      // no-op write of the same value. So when we reach the catch, we
      // know ebCampaignId is the one WE just created via createCampaign
      // and is therefore the orphan to delete.
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.PERSIST_EB_CAMPAIGN_ID;
      // CampaignDeploy first — retry anchor for BL-076. Idempotent re-runs
      // write the same ID; no unique constraint exists on this column.
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: { emailBisonCampaignId: ebCampaignId },
      });
      try {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { emailBisonCampaignId: ebCampaignId },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          preExistingEbId == null
        ) {
          // Concurrent-deploy race — another deploy won the write-back.
          const winningCampaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { emailBisonCampaignId: true },
          });
          const winningEbId = winningCampaign?.emailBisonCampaignId ?? null;
          const orphanEbId = ebCampaignId;
          console.warn(
            `[email-adapter] BL-070 race detected for Campaign ${campaignId}: tried to write EB campaign ${orphanEbId}, winner is EB campaign ${winningEbId ?? "unknown"}. Deleting orphan ${orphanEbId} and continuing with winner.`,
          );
          if (winningEbId == null) {
            // Defensive — P2002 implies a non-null row exists, but if the
            // re-read somehow returns null we must not proceed with an
            // unknown winner. Rethrow to surface via [step:2].
            throw new Error(
              `BL-070 race on Campaign ${campaignId} but re-read returned null emailBisonCampaignId after P2002. Refusing to proceed.`,
            );
          }
          try {
            await ebClient.deleteCampaign(orphanEbId);
            console.warn(
              `[email-adapter] BL-070 cleanup succeeded: deleted orphan EB campaign ${orphanEbId}.`,
            );
          } catch (deleteErr) {
            const dmsg =
              deleteErr instanceof Error
                ? deleteErr.message
                : String(deleteErr);
            console.warn(
              `[email-adapter] BL-070 ORPHAN CLEANUP FAILED — EB campaign ${orphanEbId} (workspace '${workspaceSlug}') must be deleted manually. See BL-072. Underlying error: ${dmsg}`,
            );
          }
          ebCampaignId = winningEbId;
          // Re-write CampaignDeploy with the winning ID — we wrote the
          // loser's orphan ID above, must correct to the winner.
          await prisma.campaignDeploy.update({
            where: { id: deployId },
            data: { emailBisonCampaignId: ebCampaignId },
          });
        } else {
          throw err;
        }
      }

      // Campaign was loaded in Step 1 (idempotency check). Validate
      // targetListId and pull sequence here — campaign is in scope from
      // the const above.
      if (!campaign.targetListId) {
        throw new Error("Campaign has no target list");
      }
      // Parse stored emailSequence at the DB boundary. Replaces the prior
      // silent `as EmailSequenceStep[]` cast — a Zod failure here throws
      // with a BL-068-tagged message identifying the campaign, which the
      // outer catch encodes onto emailError as `[step:2] <msg>` so the
      // operator can diagnose shape drift before EB state is touched.
      let emailSequence: EmailSequenceStep[];
      try {
        emailSequence = StoredEmailSequenceSchema.parse(
          campaign.emailSequence ?? [],
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[BL-068] Campaign ${campaignId} emailSequence failed shape validation: ${reason}. Stored JSON must match StoredEmailSequenceStepSchema (position required, body/subjectLine/etc optional).`,
        );
      }

      // -----------------------------------------------------------------
      // Step 3 — Upsert sequence steps (idempotent, batched)
      //
      // BL-074 (Phase 6.5a) — EB requires the v1.1 batched endpoint with
      // envelope `{title, sequence_steps:[{email_subject, email_body,
      // wait_in_days}]}`. Previous per-step POST to the deprecated v1 path
      // with a flat `{position, subject, body, delay_days}` body returned
      // 422 "title/sequence_steps required" on the Phase 6a canary and
      // blocked every deploy that reached Step 3. `createSequenceSteps`
      // (plural, batch) targets the v1.1 path and handles shape
      // transformation internally.
      //
      // Idempotency preserved from Phase 3 via GET-then-diff: fetch
      // existing steps, skip positions already present, include ONLY the
      // missing positions in the single batched POST. Zero missing →
      // `createSequenceSteps` short-circuits on empty input and skips the
      // HTTP call entirely so re-runs never POST an empty batch (EB would
      // 422). This preserves the Phase 3 integration-test idempotency
      // invariant "POST /sequence-steps count === 0 on re-run".
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.UPSERT_SEQUENCE_STEPS;
      const existingSteps = preExistingEbId != null
        ? await withRetry(() => ebClient.getSequenceSteps(ebCampaignId))
        : [];
      const existingPositions = new Set(existingSteps.map((s) => s.position));

      // BL-093 (2026-04-16) — reply-in-thread via EB `thread_reply` flag.
      //
      // The per-step decision logic (which steps thread, which carry
      // their own subject, when EB auto-prepends "Re: ") is shared
      // between this deploy path AND the signal-campaign pre-provision
      // path in `agents/campaign.ts`. Centralised in
      // `buildSequenceStepsForEB` so both callsites produce identical
      // wire payloads — see helper docstring for the verified rules and
      // monty-qa BL-093 F2 for the drift bug that triggered the extract.
      //
      // The diff against `existingPositions` (idempotency / GET-then-diff)
      // remains a local concern of this Step 3 — the helper takes the
      // FULL stored sequence (so it can identify step 1 even on partial
      // re-deploys) and a predicate that picks out the missing positions.
      const missingSteps = buildSequenceStepsForEB(
        emailSequence,
        `Campaign ${campaignId} ('${campaignName}')`,
        (step) => !existingPositions.has(step.position),
      );

      // -----------------------------------------------------------------
      // BL-100 (2026-04-16) — sender-name substitution at the signature.
      //
      // Writer prompts emit sender first/last/full names as literal text
      // in the body's signature region (e.g. `Daniel Lazarus` on its own
      // line). The canary EB 89 shipped that literal to EB verbatim;
      // recipients of any non-Daniel sender's inbox would have received
      // the wrong name. Fix: rewrite the signature-region name to the EB
      // sender built-ins (`{SENDER_FULL_NAME}` / `{SENDER_FIRST_NAME}`)
      // at the adapter boundary so EB substitutes the actual sender at
      // send time.
      //
      // Fix lives here (NOT in the writer) for the same reason as the
      // BL-093 lead variable transform: normalize at the vendor edge;
      // writer prompts stay human-readable.
      //
      // Roster sourcing — same allocation logic as Step 6 (attach
      // senders). We query the allocated-sender names now rather than
      // waiting until Step 6 because the transform has to run BEFORE
      // `createSequenceSteps` POSTs the body to EB. The query below is
      // the mirror of the Step 6 query with `name` added to the select;
      // the Step 6 block remains authoritative for the EB-IDs-to-attach
      // path and is left unchanged.
      //
      // Empty-roster semantics: if allocation returns zero senders
      // here (e.g. all senders were deleted between initiateDeploy and
      // the adapter running), the transformer is a no-op — the body
      // passes through verbatim and Step 6 will surface the zero-sender
      // error loudly. We deliberately do NOT throw here to keep the
      // existing Step 6 error path as the single point of truth for
      // missing senders.
      const rosterSenders = await prisma.sender.findMany({
        where: {
          workspaceSlug,
          channel: { in: ["email", "both"] },
          emailBisonSenderId: { not: null },
          healthStatus: { in: ["healthy", "warning"] },
        },
        select: { name: true, emailBisonSenderId: true },
        orderBy: { emailBisonSenderId: "asc" },
      });
      const rosterSenderIds = rosterSenders
        .map((s) => s.emailBisonSenderId)
        .filter((id): id is number => id != null);
      const allocatedRosterIds = new Set(
        resolveAllocatedSenders(campaignId, rosterSenderIds),
      );
      const senderRoster = buildSenderRoster(
        rosterSenders.filter(
          (s) =>
            s.emailBisonSenderId != null &&
            allocatedRosterIds.has(s.emailBisonSenderId),
        ),
      );

      // Apply sender-name transform to each step body before the POST.
      // The lead-variable transform happens INSIDE
      // `ebClient.createSequenceSteps` (per BL-093, 14bb69ba), so the
      // ordering on the wire is: [this] sender-name → [client-internal]
      // lead-variable → HTTP POST. Both transforms are idempotent;
      // already-transformed bodies (e.g. an idempotent re-deploy) are
      // no-ops with `matched=false`.
      for (const step of missingSteps) {
        const result = transformSenderNames(step.body, senderRoster, {
          campaignId,
          campaignName,
        });
        step.body = result.transformed;
      }

      if (missingSteps.length > 0) {
        // Title parameter — EB docs describe it as "The title for the
        // sequence." Use the Campaign name directly so operators can
        // trace the sequence back to its Outsignal Campaign via EB's UI
        // without further lookup. (Per spike notes the title is accepted
        // but currently always stored as null in the response — we still
        // send a meaningful value in case EB starts surfacing it.)
        //
        // BL-085 (2026-04-16) — NO withRetry wrap. Same reasoning as
        // BL-076 createCampaign (see Step 1 comment above). createSequenceSteps
        // is a POST and is NOT server-side idempotent by position — EB
        // appends every batch it receives, so a retry on any client-side
        // throw (Zod mismatch, timeout, transient 5xx) inserts the full
        // batch again. Phase 6.5c canary (Campaign cmneqixpv deploy
        // cmo1ig1yf, EB 82) produced 9 sequence steps from 3 steps ×
        // 3 retries when the v1.1 response shape failed client Zod parse
        // and withRetry looped. Fix A (client tolerant parse) removes the
        // Zod-throw trigger; Fix B (this change) removes the retry
        // amplifier so a future non-Zod transient failure cannot
        // recreate the same duplication. Transient failures now route
        // through Trigger.dev task-level retry → reuse path (preExistingEbId
        // is set by Step 2) → the GET-then-diff above finds the
        // already-inserted positions and posts only the missing ones,
        // or short-circuits with missingSteps=[] if the retry re-enters
        // after a successful first POST.
        await ebClient.createSequenceSteps(
          ebCampaignId,
          campaignName,
          missingSteps,
        );
      }

      const emailStepCount = existingSteps.length + missingSteps.length;

      // -----------------------------------------------------------------
      // Step 4 — Upsert leads + attach to campaign
      //
      // Load TargetList persons, dedup via WebhookEvent (EMAIL_SENT guard),
      // upsert ALL eligible leads in a SINGLE batch via the EB upsert
      // endpoint, capture returned EB IDs, then attach-leads in a single
      // batch.
      //
      // BL-088 (2026-04-16): switched from a per-lead `createLead` POST
      // loop to one batch `createOrUpdateLeadsMultiple` call. EB's lead
      // store is WORKSPACE-scoped, not campaign-scoped — leads from prior
      // canary runs persist across campaign deletions and `createLead`
      // returned 422 ("The email has already been taken") on every retry
      // attempt. The upsert endpoint accepts both new and existing emails
      // with `existing_lead_behavior: "patch"` and returns IDs for both.
      // EB itself recommends this (docs line 1527: "Instead of deleting,
      // simply re-upload the leads. We'll update the records in place.").
      //
      // attach-leads remains idempotent at the campaign link level so a
      // re-deploy that re-upserts the same leads is safe.
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.ATTACH_LEADS;
      const leads = await prisma.targetListPerson.findMany({
        where: { listId: campaign.targetListId },
        include: {
          person: {
            include: {
              workspaces: { where: { workspace: workspaceSlug } },
            },
          },
        },
      });

      // Pre-filter eligible leads (have email, not already deployed) BEFORE
      // building the batch — keeps the wire payload to only what EB needs
      // and preserves the existing per-lead WebhookEvent dedup semantics.
      const eligibleLeads: typeof leads = [];
      for (const entry of leads) {
        const person = entry.person;

        // Skip leads without a real email — cannot deploy to EmailBison
        if (!person.email) continue;

        // Outsignal-side dedup: skip if already has EMAIL_SENT event for
        // this workspace. Preserves the prior behaviour — a lead that has
        // already received an email in this workspace must not be re-sent
        // even if the EB upsert would happily accept the email again.
        const alreadyDeployed = await prisma.webhookEvent.findFirst({
          where: {
            workspace: workspaceSlug,
            eventType: "EMAIL_SENT",
            leadEmail: person.email,
          },
          select: { id: true },
        });
        if (alreadyDeployed) continue;

        eligibleLeads.push(entry);
      }

      const createdLeadIds: number[] = [];
      let leadCount = 0;
      if (eligibleLeads.length > 0) {
        // Single batch POST. withRetry stays — BL-086 made it status-aware
        // so transient 5xx still retries while non-retryable 4xx (e.g. a
        // wholly different 422 like personal-domain rejection on a stricter
        // EB instance) surfaces immediately.
        //
        // Note: EB caps this endpoint at 500 leads/request (docs line 1599).
        // Current canary TargetLists are well under that. If a future
        // workspace exceeds 500, chunk here in 500-lead batches; the
        // upsert is naturally idempotent so a partial-batch retry is safe.
        const upserted = await withRetry(() =>
          ebClient.createOrUpdateLeadsMultiple(
            eligibleLeads.map((entry) => ({
              email: entry.person.email!,
              firstName: entry.person.firstName ?? undefined,
              lastName: entry.person.lastName ?? undefined,
              jobTitle: entry.person.jobTitle ?? undefined,
              company: entry.person.company ?? undefined,
            })),
          ),
        );

        for (const lead of upserted) {
          createdLeadIds.push(lead.id);
          leadCount++;
        }
      }

      // Zero-leads early exit. attach-leads would 422 on an empty array
      // and launching a campaign with no leads is pointless. Mark the
      // deploy complete with an explanatory emailError and return — the
      // EB campaign stays in DRAFT for operator inspection.
      if (createdLeadIds.length === 0) {
        console.warn(
          `[email-adapter] Campaign '${campaignName}' has zero leads to deploy; skipping attach-leads + launch.`,
        );
        await prisma.campaignDeploy.update({
          where: { id: deployId },
          data: {
            emailStatus: "complete",
            emailStepCount,
            leadCount: 0,
            emailError: "no_leads_to_deploy",
          },
        });
        return;
      }

      // Attach all freshly-created leads to the campaign (batch).
      await withRetry(() =>
        ebClient.attachLeadsToCampaign(ebCampaignId, createdLeadIds),
      );

      // -----------------------------------------------------------------
      // Step 5 — Upsert schedule (GET → updateSchedule if exists, else
      // createSchedule)
      //
      // On a fresh deploy (emailBisonCampaignId was null on entry) we
      // know no schedule exists, so we skip the GET and go straight to
      // createSchedule — this keeps the happy-path test mocks minimal.
      // On idempotent re-run we GET first; if a schedule is already in
      // place we PUT (updateSchedule requires save_as_template per the
      // EB spec), else we create.
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.UPSERT_SCHEDULE;
      if (preExistingEbId != null) {
        const existingSchedule = await withRetry(() =>
          ebClient.getSchedule(ebCampaignId),
        );
        if (existingSchedule != null) {
          await withRetry(() =>
            ebClient.updateSchedule(ebCampaignId, { ...DEFAULT_SCHEDULE }),
          );
        } else {
          await withRetry(() =>
            ebClient.createSchedule(ebCampaignId, DEFAULT_SCHEDULE),
          );
        }
      } else {
        await withRetry(() =>
          ebClient.createSchedule(ebCampaignId, DEFAULT_SCHEDULE),
        );
      }

      // -----------------------------------------------------------------
      // Step 6 — Attach healthy EB-registered senders
      //
      // Channel filter includes "both" because dual-channel senders still
      // send email. attach-sender-emails is EB-side idempotent (dedupes).
      //
      // BL-093 (2026-04-16) — per-campaign sender allocation. The previous
      // implementation attached ALL workspace senders to every campaign,
      // which (a) violates the PM intent of dedicating sender subsets to
      // each campaign for better deliverability isolation and (b) breaks
      // sender rotation balance — a workspace running 5 campaigns
      // simultaneously would route every send through every sender,
      // saturating each inbox 5× the intended volume and inviting
      // bounce/spam flags.
      //
      // Pragmatic fix for the canary: hardcoded allocation map keyed by
      // campaignId. The allocation is deterministic round-robin over the
      // 1210-solutions workspace's 58 healthy email senders sorted by
      // emailBisonSenderId, with each campaign owning roughly 1/5 of the
      // pool (~11-12 senders each). Daniel Lazarus's other 1210 sending
      // domains are split evenly across the 5 campaigns.
      //
      // PROPER FIX (BL-094, deferred): add `Campaign.allocatedSenderIds`
      // (JSON array of Sender.id values) to prisma/schema.prisma + a
      // workspace UI for ops to assign per-campaign allocations + a
      // migration to backfill existing campaigns from this hardcoded map.
      // For today's canary the allocation is correct, deterministic, and
      // reversible.
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.ATTACH_SENDERS;
      const allSenders = await prisma.sender.findMany({
        where: {
          workspaceSlug,
          channel: { in: ["email", "both"] },
          emailBisonSenderId: { not: null },
          healthStatus: { in: ["healthy", "warning"] },
        },
        select: { emailBisonSenderId: true },
        // Stable order so the hardcoded allocation map below is reproducible.
        orderBy: { emailBisonSenderId: "asc" },
      });
      const allSenderEmailIds = allSenders
        .map((s) => s.emailBisonSenderId)
        .filter((id): id is number => id != null);

      // Resolve the per-campaign sender subset. If the campaign is in the
      // hardcoded allocation map, use the explicit subset; otherwise fall
      // back to all senders (preserves pre-BL-093 behaviour for
      // non-allocated workspaces and keeps the change surgical for the
      // 1210 canary cohort).
      const senderEmailIds = resolveAllocatedSenders(campaignId, allSenderEmailIds);

      if (senderEmailIds.length === 0) {
        throw new Error(
          `No EB-registered healthy senders found for workspace '${workspaceSlug}' (campaign ${campaignId}) — cannot attach senders. ${
            allSenderEmailIds.length > 0
              ? `Workspace has ${allSenderEmailIds.length} healthy senders but none are in this campaign's allocation map (BL-093 / BL-094).`
              : "Workspace has zero healthy senders."
          }`,
        );
      }

      console.log(
        `[email-adapter] BL-093: Campaign ${campaignId} allocated ${senderEmailIds.length}/${allSenderEmailIds.length} workspace senders.`,
      );

      await withRetry(() =>
        ebClient.attachSenderEmails(ebCampaignId, senderEmailIds),
      );

      // -----------------------------------------------------------------
      // Step 7 — Update campaign settings (PATCH /campaigns/{id}/update)
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.UPDATE_SETTINGS;
      await withRetry(() =>
        ebClient.updateCampaign(ebCampaignId, { ...DEFAULT_CAMPAIGN_SETTINGS }),
      );

      // -----------------------------------------------------------------
      // Step 8 — Attach tags (POST /tags/attach-to-campaigns)
      //
      // ESCALATION (Phase 3 gap 3b.iii): NO workspace-level tag-ID config
      // field exists in prisma/schema.prisma (grep confirmed — no
      // ebTagIds, emailBisonTagIds, defaultEbTags, or similar). Per the
      // Phase 3 hard rules, we must NOT silently invent a config field
      // and must NOT skip this silently. This step therefore remains a
      // documented no-op and is flagged to PM in the Phase 3 report for
      // schema follow-up. Client method is available when wired:
      //   ebClient.attachTagsToCampaigns({ tagIds, campaignIds: [ebCampaignId] })
      // -----------------------------------------------------------------
      // (intentional no-op — see above)

      // -----------------------------------------------------------------
      // Step 9 — Resume (launch) the EB campaign.
      //
      // PATCH /campaigns/{id}/resume transitions DRAFT → QUEUED →
      // LAUNCHING → ACTIVE. MUST be last so every prior step has
      // succeeded before control is handed to EB's sender. Any non-2xx
      // propagates via withRetry → outer catch → emailError tagged
      // `[step:9]`.
      //
      // skipResume path (stage-deploy): DO NOT call resumeCampaign and
      // DO NOT run Step 10 verify. Leave the EB campaign in DRAFT so
      // the PM can inspect it in the EB UI before launching manually.
      // CampaignDeploy.emailStatus is marked 'complete' with a narrative
      // note in emailError explaining the staged state (emailError is
      // the conventional free-form narrative field; we intentionally
      // co-opt it for the staged signal since no schema change is in
      // scope for this path). Campaign.status stays at 'deployed'
      // because the outer deploy.ts post-finalize auto-transition is
      // also gated by skipResume.
      // -----------------------------------------------------------------
      if (skipResume) {
        console.log(
          `[email-adapter] skipResume=true — Steps 9/10 skipped; EB campaign ${ebCampaignId} staged in DRAFT for manual PM review. deployId=${deployId}, campaign '${campaignName}'.`,
        );
        await prisma.campaignDeploy.update({
          where: { id: deployId },
          data: {
            emailStatus: "complete",
            emailStepCount,
            leadCount,
            emailError:
              "STAGED — resume pending PM review via EB UI or manual resumeCampaign call",
          },
        });
        return;
      }

      currentStep = DEPLOY_STEP.RESUME_LAUNCH;
      await withRetry(() => ebClient.resumeCampaign(ebCampaignId));

      // -----------------------------------------------------------------
      // Step 10 — Verify final EB status.
      //
      // GET /campaigns/{id} → assert status ∈ {queued, launching, active}
      // (case-insensitive). Response is parsed through a Zod schema — no
      // `as` cast — per the Phase 2 BL-068 boundary discipline.
      //
      // Unexpected status → compensating transaction: mark failed with
      // [step:10] prefix so PM can decide to retry or roll back. We
      // persist the observed status into the error string so the
      // operator doesn't need to re-query EB to see what happened.
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.VERIFY_STATUS;
      const verifyRaw = await withRetry(() => ebClient.getCampaign(ebCampaignId));
      const verifyParsed = EbCampaignStatusSchema.parse(verifyRaw);
      const observedStatus = verifyParsed.status.toLowerCase();

      if (!LAUNCHED_STATUSES.has(observedStatus)) {
        throw new Error(
          `EB campaign ${ebCampaignId} did not transition to a launched state after resume (got '${verifyParsed.status}'; expected one of queued|launching|active).`,
        );
      }

      // Success — final deploy row update.
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: {
          emailStatus: "complete",
          emailStepCount,
          leadCount,
          emailError: null,
        },
      });
    } catch (err) {
      // Compensating transaction — encode the failing step into emailError
      // so the orchestrator (src/lib/campaigns/deploy.ts::executeDeploy)
      // and any downstream tooling can reason about what partial state
      // the EB campaign was left in. Phase 3 is refactor-only so we do
      // NOT add a failedAtStep column; the `[step:N]` prefix is the
      // conventional serialization until a schema change lands.
      //
      // Note: we do NOT roll back Campaign.status or
      // Campaign.emailBisonCampaignId here. Rollback is the outer orchestrator's
      // responsibility — see src/lib/campaigns/deploy.ts::executeDeploy catch
      // (BL-075, Phase 6.5b). Email-adapter rethrows; deploy.ts catches and
      // runs the atomic rollback (Campaign.status → 'approved',
      // emailBisonCampaignId → null, deployedAt → null + CampaignDeploy.status
      // → 'failed' + AuditLog, all in one $transaction) — or skips rollback
      // if another CampaignDeploy for the same campaignId is still in flight.
      // Keeping the boundary at deploy.ts means linkedin-adapter inherits the
      // same rollback semantics without duplicating the logic per channel.
      //
      // BL-076 (Phase 6.5b Bundle C): CampaignDeploy.emailBisonCampaignId is
      // NOT cleared by the outer rollback — it serves as the retry anchor
      // for Trigger.dev's automatic retry. When deploy.ts's executeDeploy
      // re-enters on retry, it reads CampaignDeploy.emailBisonCampaignId
      // and restores Campaign state before the status guard fires, so the
      // retry reuses the EB campaign via the idempotent Step 1 branch
      // rather than creating a duplicate. Step 2 above writes
      // CampaignDeploy FIRST (before Campaign) specifically so the anchor
      // is durable even if the process dies between the two writes.
      const message = err instanceof Error ? err.message : String(err);
      const tagged = `[step:${currentStep}] ${message}`;
      // Log the failure so errors are never silently swallowed (the catch
      // block always either logs + rethrows, per Phase 3 hard rules).
      console.error(
        `[email-adapter] Deploy failed for '${campaignName}' (deployId=${deployId}) at step ${currentStep}: ${message}`,
      );
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: {
          emailStatus: "failed",
          emailError: tagged,
        },
      });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // pause — pause the EmailBison campaign
  // ---------------------------------------------------------------------------

  async pause(ref: CampaignChannelRef): Promise<void> {
    if (!ref.emailBisonCampaignId) {
      console.warn(
        `Cannot pause email campaign — no emailBisonCampaignId on ref for '${ref.campaignName}'`,
      );
      return;
    }
    const client = await this.getClient(ref.workspaceSlug);
    await client.pauseCampaign(ref.emailBisonCampaignId);
  }

  // ---------------------------------------------------------------------------
  // resume — resume the EmailBison campaign
  // ---------------------------------------------------------------------------

  async resume(ref: CampaignChannelRef): Promise<void> {
    if (!ref.emailBisonCampaignId) {
      console.warn(
        `Cannot resume email campaign — no emailBisonCampaignId on ref for '${ref.campaignName}'`,
      );
      return;
    }
    const client = await this.getClient(ref.workspaceSlug);
    await client.resumeCampaign(ref.emailBisonCampaignId);
  }

  // ---------------------------------------------------------------------------
  // getMetrics — map EB campaign stats to UnifiedMetrics
  // ---------------------------------------------------------------------------

  async getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics> {
    if (!ref.emailBisonCampaignId) {
      return {
        channel: CHANNEL_TYPES.EMAIL,
        sent: 0,
        replied: 0,
        replyRate: 0,
        opened: 0,
        openRate: 0,
        bounced: 0,
        bounceRate: 0,
      };
    }

    const client = await this.getClient(ref.workspaceSlug);
    const campaign = await client.getCampaignById(ref.emailBisonCampaignId);

    if (!campaign) {
      return {
        channel: CHANNEL_TYPES.EMAIL,
        sent: 0,
        replied: 0,
        replyRate: 0,
        opened: 0,
        openRate: 0,
        bounced: 0,
        bounceRate: 0,
      };
    }

    const sent = campaign.emails_sent ?? 0;
    const replied = campaign.replied ?? 0;
    const opened = campaign.opened ?? 0;
    const bounced = campaign.bounced ?? 0;

    return {
      channel: CHANNEL_TYPES.EMAIL,
      sent,
      replied,
      replyRate: sent > 0 ? Math.round((replied / sent) * 100) / 100 : 0,
      opened,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) / 100 : 0,
      bounced,
      bounceRate: sent > 0 ? Math.round((bounced / sent) * 100) / 100 : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // getLeads — map EB campaign leads to UnifiedLead[]
  // ---------------------------------------------------------------------------

  async getLeads(ref: CampaignChannelRef): Promise<UnifiedLead[]> {
    if (!ref.emailBisonCampaignId) return [];

    const client = await this.getClient(ref.workspaceSlug);
    const response = await client.getCampaignLeads(ref.emailBisonCampaignId);
    const leads = response.data ?? [];

    return leads.map((lead) => ({
      id: String(lead.id),
      email: lead.email,
      name:
        [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
        undefined,
      company: lead.company ?? undefined,
      title: lead.title ?? undefined,
      channel: CHANNEL_TYPES.EMAIL,
      status: lead.status ?? "unknown",
    }));
  }

  // ---------------------------------------------------------------------------
  // getActions — query local Reply table for the campaign
  // ---------------------------------------------------------------------------

  async getActions(ref: CampaignChannelRef): Promise<UnifiedAction[]> {
    const replies = await prisma.reply.findMany({
      where: {
        workspaceSlug: ref.workspaceSlug,
        campaignName: ref.campaignName,
      },
      orderBy: { receivedAt: "desc" },
    });

    return replies.map((reply) => ({
      id: reply.id,
      channel: CHANNEL_TYPES.EMAIL,
      actionType: "reply",
      status: "complete",
      personEmail: reply.senderEmail,
      personName: reply.senderName ?? undefined,
      detail: reply.subject ?? undefined,
      performedAt: reply.receivedAt,
      campaignName: reply.campaignName ?? undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // getSequenceSteps — EB sequence steps with Campaign.emailSequence fallback
  // ---------------------------------------------------------------------------

  async getSequenceSteps(ref: CampaignChannelRef): Promise<UnifiedStep[]> {
    // Primary: EmailBison API
    if (ref.emailBisonCampaignId) {
      try {
        const client = await this.getClient(ref.workspaceSlug);
        const steps = await client.getSequenceSteps(ref.emailBisonCampaignId);

        return steps.map((step) => ({
          stepNumber: step.position,
          channel: CHANNEL_TYPES.EMAIL,
          type: "email",
          delayDays: step.delay_days ?? 0,
          subjectLine: step.subject || undefined,
          bodyHtml: step.body || undefined,
        }));
      } catch (error) {
        // EB getSequenceSteps failed — log so operators can see when we
        // silently fall back to the stored Campaign.emailSequence JSON
        // (transient 5xx, auth issues, EB campaign deleted, etc.).
        console.warn(
          `[email-adapter] getSequenceSteps failed for EB campaign ${ref.emailBisonCampaignId} (campaign '${ref.campaignName}', workspace '${ref.workspaceSlug}'); falling back to Campaign.emailSequence`,
          error,
        );
      }
    }

    // Fallback: Campaign.emailSequence JSON field
    const campaign = await prisma.campaign.findFirst({
      where: {
        name: ref.campaignName,
        workspaceSlug: ref.workspaceSlug,
      },
      select: { emailSequence: true },
    });

    if (!campaign?.emailSequence) return [];

    try {
      const steps = JSON.parse(campaign.emailSequence) as Array<{
        position?: number;
        subjectLine?: string;
        subjectVariantB?: string;
        body?: string;
        bodyText?: string;
        bodyHtml?: string;
        delayDays?: number;
        notes?: string;
      }>;

      return steps.map((step, index) => ({
        stepNumber: step.position ?? index + 1,
        channel: CHANNEL_TYPES.EMAIL,
        type: "email",
        delayDays: step.delayDays ?? 0,
        subjectLine: step.subjectLine ?? undefined,
        bodyHtml: step.bodyHtml ?? step.body ?? step.bodyText ?? undefined,
        messageBody: step.bodyText ?? step.body ?? undefined,
      }));
    } catch (error) {
      // Stored emailSequence JSON could not be parsed — log so operators
      // can see that the Campaign row holds malformed sequence data
      // (returning [] avoids a crash on the read path, but a silent empty
      // list would otherwise mask the corruption).
      console.warn(
        `[email-adapter] Failed to parse Campaign.emailSequence JSON for campaign '${ref.campaignName}' (workspace '${ref.workspaceSlug}'); returning empty step list`,
        error,
      );
      return [];
    }
  }
}
