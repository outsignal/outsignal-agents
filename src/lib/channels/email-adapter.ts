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
} as const;

/**
 * Default campaign settings applied via PATCH /campaigns/{id}/update after
 * senders are attached — keeps EB state consistent with our deliverability
 * posture regardless of what createCampaign defaulted to.
 */
const DEFAULT_CAMPAIGN_SETTINGS = {
  plain_text: true,
  open_tracking: false,
  reputation_building: true,
  can_unsubscribe: true,
} as const;

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
        const ebCampaign = await withRetry(() =>
          ebClient.createCampaign({ name: campaignName }),
        );
        ebCampaignId = ebCampaign.id;
      }

      // -----------------------------------------------------------------
      // Step 2 — Persist emailBisonCampaignId on BOTH CampaignDeploy and
      // Campaign records (idempotent write — same ID on every re-run).
      //
      // BL-070 race guard — Campaign.emailBisonCampaignId is UNIQUE. Two
      // concurrent deploys of the same Campaign can both take the
      // fresh-deploy branch in Step 1 and each createCampaign on EB,
      // producing two EB drafts. When the loser tries to write back here,
      // Prisma raises P2002. We catch, re-read the winning ID that the
      // other deploy persisted, delete our orphan EB campaign, and
      // continue the rest of the flow against the winner. If the
      // EmailBison delete itself fails we surface a loud warning rather
      // than aborting the deploy — the write-back winner is the correct
      // campaign and subsequent steps are safe to run against it; the
      // orphan becomes a documented cleanup task (BL-072).
      //
      // The idempotent reuse branch in Step 1 can never trigger P2002
      // because it reuses the already-persisted ID — the update becomes a
      // no-op write of the same value. So when we reach the catch, we
      // know ebCampaignId is the one WE just created via createCampaign
      // and is therefore the orphan to delete.
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.PERSIST_EB_CAMPAIGN_ID;
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
        } else {
          throw err;
        }
      }
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: { emailBisonCampaignId: ebCampaignId },
      });

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

      const missingSteps = emailSequence
        .filter((step) => !existingPositions.has(step.position))
        .map((step) => ({
          position: step.position,
          subject: step.subjectLine,
          body: step.body ?? step.bodyText ?? "",
          delay_days: step.delayDays ?? 1,
        }));

      if (missingSteps.length > 0) {
        // Title parameter — EB docs describe it as "The title for the
        // sequence." Use the Campaign name directly so operators can
        // trace the sequence back to its Outsignal Campaign via EB's UI
        // without further lookup. (Per spike notes the title is accepted
        // but currently always stored as null in the response — we still
        // send a meaningful value in case EB starts surfacing it.)
        await withRetry(() =>
          ebClient.createSequenceSteps(ebCampaignId, campaignName, missingSteps),
        );
      }

      const emailStepCount = existingSteps.length + missingSteps.length;

      // -----------------------------------------------------------------
      // Step 4 — Create leads + attach to campaign
      //
      // Load TargetList persons, dedup via WebhookEvent (EMAIL_SENT guard),
      // createLead for each, capture returned EB IDs, then attach-leads in
      // a single batch. EB's createLead is idempotent by email on the lead
      // side; attach-leads is idempotent at the campaign link level.
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

      let leadCount = 0;
      const createdLeadIds: number[] = [];
      for (const entry of leads) {
        const person = entry.person;

        // Outsignal-side dedup: skip if already has EMAIL_SENT event for this workspace
        const alreadyDeployed = await prisma.webhookEvent.findFirst({
          where: {
            workspace: workspaceSlug,
            eventType: "EMAIL_SENT",
            leadEmail: person.email,
          },
          select: { id: true },
        });

        if (alreadyDeployed) {
          continue;
        }

        // Skip leads without a real email — cannot deploy to EmailBison
        if (!person.email) continue;

        const createdLead = await withRetry(() =>
          ebClient.createLead({
            email: person.email!,
            firstName: person.firstName ?? undefined,
            lastName: person.lastName ?? undefined,
            jobTitle: person.jobTitle ?? undefined,
            company: person.company ?? undefined,
          }),
        );

        createdLeadIds.push(createdLead.id);
        leadCount++;

        // Throttle — 100ms between leads
        await new Promise((resolve) => setTimeout(resolve, 100));
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
            ebClient.updateSchedule(ebCampaignId, {
              ...DEFAULT_SCHEDULE,
              save_as_template: false,
            }),
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
      // -----------------------------------------------------------------
      currentStep = DEPLOY_STEP.ATTACH_SENDERS;
      const senders = await prisma.sender.findMany({
        where: {
          workspaceSlug,
          channel: { in: ["email", "both"] },
          emailBisonSenderId: { not: null },
          healthStatus: { in: ["healthy", "warning"] },
        },
        select: { emailBisonSenderId: true },
      });
      const senderEmailIds = senders
        .map((s) => s.emailBisonSenderId)
        .filter((id): id is number => id != null);

      if (senderEmailIds.length === 0) {
        throw new Error(
          `No EB-registered healthy senders found for workspace '${workspaceSlug}' — cannot attach senders.`,
        );
      }

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
      // -----------------------------------------------------------------
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
