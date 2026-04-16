/**
 * BL-085 — reply-in-thread empty-subject handling in EmailAdapter.deploy.
 *
 * Outsignal convention (feedback_email_threading_subject memory):
 * follow-up email steps ship with an EMPTY subjectLine so recipient-side
 * clients thread the follow-up under step 1. EB v1.1 `POST
 * /campaigns/{id}/sequence-steps` REJECTS empty email_subject with 422
 * "email_subject required" (Phase 6a canary Step 3 failure) — the EB
 * reference docs do NOT document any inherit_subject / reply_in_thread
 * flag on sequence-step creation, only on the reply endpoints.
 *
 * Fix (Option 2) — adapter builds the batch POST body with a
 * `Re: {firstStepSubject}` fallback on empty-subject steps. EB
 * validates, EB sends, recipient-side email clients thread the
 * message under step 1 per RFC 5322 subject-match heuristics
 * (the `Re: ` prefix is stripped for threading).
 *
 * Test cases:
 *   (a) happy path — 3-step sequence, step 2 empty subject. Batch POST
 *       contains non-empty email_subject on all 3 steps; step 2 is
 *       `Re: {step1 subject}`.
 *   (b) edge — step 1 itself has empty subject (defensive). Fallback
 *       uses "(no subject)" placeholder; no crash; warn emitted.
 *   (c) regression — all 3 subjects filled. Adapter preserves
 *       originals verbatim; no "Re: " prefix injected.
 *   (d) real fixture — canary cmneqixpv's actual emailSequence JSON
 *       shape (canonical Phase 6.5c). Parses clean, batch builds
 *       with no empty email_subject; step 2 threaded.
 *
 * Mock style mirrors email-adapter-race.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { ebMock, getCampaignMock, prismaMock } = vi.hoisted(() => ({
  ebMock: {
    createCampaign: vi.fn(),
    getCampaign: vi.fn(),
    deleteCampaign: vi.fn(),
    getSequenceSteps: vi.fn(),
    createSequenceSteps: vi.fn(),
    createLead: vi.fn(),
    attachLeadsToCampaign: vi.fn(),
    getSchedule: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    attachSenderEmails: vi.fn(),
    updateCampaign: vi.fn(),
    resumeCampaign: vi.fn(),
  },
  getCampaignMock: vi.fn(),
  prismaMock: {
    workspace: { findUniqueOrThrow: vi.fn() },
    campaign: { update: vi.fn(), findUnique: vi.fn() },
    campaignDeploy: { update: vi.fn() },
    targetListPerson: { findMany: vi.fn() },
    webhookEvent: { findFirst: vi.fn() },
    sender: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/emailbison/client", () => ({
  EmailBisonClient: class {
    constructor() {
      return ebMock;
    }
  },
  EmailBisonApiError: class extends Error {
    isRecordNotFound = false;
  },
}));

vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
}));

// Pass-through retry so failure branches don't sleep 1s/5s/15s.
vi.mock("@/lib/utils/retry", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { EmailAdapter } from "@/lib/channels/email-adapter";

// ---------------------------------------------------------------------------
// Shared happy-path stubs for the tail of the deploy flow (Steps 4-10).
// Each test body overrides the emailSequence on getCampaignMock and the
// createSequenceSteps assertion — everything else is constant.
// ---------------------------------------------------------------------------
function primeHappyPathTail() {
  prismaMock.targetListPerson.findMany.mockResolvedValue([
    {
      person: {
        email: "a@acme.com",
        firstName: "A",
        lastName: null,
        jobTitle: null,
        company: null,
        workspaces: [],
      },
    },
  ]);
  prismaMock.webhookEvent.findFirst.mockResolvedValue(null);
  ebMock.createLead.mockResolvedValue({ id: 1001, status: "active" });
  ebMock.attachLeadsToCampaign.mockResolvedValue(undefined);
  ebMock.getSchedule.mockResolvedValue(null);
  ebMock.createSchedule.mockResolvedValue({});
  prismaMock.sender.findMany.mockResolvedValue([{ emailBisonSenderId: 501 }]);
  ebMock.attachSenderEmails.mockResolvedValue(undefined);
  ebMock.updateCampaign.mockResolvedValue({});
  ebMock.resumeCampaign.mockResolvedValue({});
  ebMock.getCampaign.mockResolvedValue({ id: 888, status: "active" });
  ebMock.getSequenceSteps.mockResolvedValue([]);
  // createSequenceSteps returns a plausible shape — the assertions don't
  // depend on its return, only on the shape of its ARGUMENTS.
  ebMock.createSequenceSteps.mockResolvedValue([]);
  prismaMock.campaignDeploy.update.mockResolvedValue({});
  prismaMock.campaign.update.mockResolvedValue({});
}

const DEPLOY_PARAMS = {
  deployId: "deploy-bl085",
  campaignId: "camp-bl085",
  campaignName: "BL-085 Reply-Thread Campaign",
  workspaceSlug: "acme",
  channels: ["email"],
};

// ---------------------------------------------------------------------------
// Canary fixture — real shape of Campaign cmneqixpv's emailSequence JSON
// (read via audit script 2026-04-16). Step 1 has subjectLine + subjectVariantB,
// step 2 has no subjectLine field at all (undefined), step 3 has a fresh
// subjectLine. Bodies truncated for test brevity; structural invariants
// preserved.
// ---------------------------------------------------------------------------
const CANARY_FIXTURE = [
  {
    position: 1,
    subjectLine: "cleaners across multiple sites",
    subjectVariantB: "payroll for fm contracts",
    body: "Hi {FIRSTNAME},\n\nRunning payroll for cleaners is tough.",
    delayDays: 0,
    notes: "step 1 — hook",
  },
  {
    position: 2,
    body: "Hi {FIRSTNAME},\n\nWinning a new contract can strain payroll.",
    delayDays: 3,
    notes: "step 2 — reply-in-thread, no subject by design",
  },
  {
    position: 3,
    subjectLine: "winning contracts losing margin",
    subjectVariantB: "closing the loop",
    body: "Hi {FIRSTNAME},\n\nAppreciate your time is tight.",
    delayDays: 7,
    notes: "step 3 — fresh subject, new angle",
  },
];

describe("EmailAdapter.deploy() — BL-085 reply-in-thread empty-subject handling", () => {
  let adapter: EmailAdapter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new EmailAdapter();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
      apiToken: "ws-token",
    });

    // Fresh deploy — Step 1 takes createCampaign branch.
    ebMock.createCampaign.mockResolvedValue({ id: 888, uuid: "uuid-888" });

    primeHappyPathTail();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (a) Happy path — step 2 empty, step 1 + 3 have subjects.
  // -------------------------------------------------------------------------
  it(
    "(a) 3-step sequence with step 2 empty subject → batch POST has non-empty email_subject on all steps; step 2 is 'Re: <step1>'",
    async () => {
      getCampaignMock.mockResolvedValue({
        id: "camp-bl085",
        targetListId: "tl-1",
        emailBisonCampaignId: null,
        emailSequence: [
          {
            position: 1,
            subjectLine: "hello there",
            body: "body 1",
            delayDays: 0,
          },
          { position: 2, subjectLine: "", body: "body 2", delayDays: 3 },
          {
            position: 3,
            subjectLine: "fresh angle",
            body: "body 3",
            delayDays: 7,
          },
        ],
      });

      await adapter.deploy(DEPLOY_PARAMS);

      // createSequenceSteps was called exactly once with all 3 steps.
      expect(ebMock.createSequenceSteps).toHaveBeenCalledTimes(1);
      const [ebId, title, stepsArg] =
        ebMock.createSequenceSteps.mock.calls[0];
      expect(ebId).toBe(888);
      expect(title).toBe("BL-085 Reply-Thread Campaign");
      expect(stepsArg).toHaveLength(3);

      // All 3 step subjects are non-empty (defeats the 422).
      for (const step of stepsArg) {
        expect(step.subject).toBeDefined();
        expect(String(step.subject).trim()).not.toBe("");
      }

      // Step 1 and 3 preserved verbatim.
      expect(stepsArg[0].subject).toBe("hello there");
      expect(stepsArg[2].subject).toBe("fresh angle");

      // Step 2 is threaded under step 1.
      expect(stepsArg[1].subject).toBe("Re: hello there");

      // No BL-085 warning — step 1 had a real subject so the placeholder
      // path did not fire.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).not.toMatch(/BL-085/);
    },
  );

  // -------------------------------------------------------------------------
  // (b) Edge — step 1 itself empty. Defensive placeholder + warn.
  // -------------------------------------------------------------------------
  it(
    "(b) step 1 has empty subjectLine (defensive edge) → uses '(no subject)' placeholder; emits BL-085 warning; does not crash",
    async () => {
      getCampaignMock.mockResolvedValue({
        id: "camp-bl085",
        targetListId: "tl-1",
        emailBisonCampaignId: null,
        emailSequence: [
          { position: 1, subjectLine: "", body: "body 1", delayDays: 0 },
          { position: 2, subjectLine: "", body: "body 2", delayDays: 3 },
          {
            position: 3,
            subjectLine: "fresh angle",
            body: "body 3",
            delayDays: 7,
          },
        ],
      });

      await expect(adapter.deploy(DEPLOY_PARAMS)).resolves.toBeUndefined();

      expect(ebMock.createSequenceSteps).toHaveBeenCalledTimes(1);
      const stepsArg = ebMock.createSequenceSteps.mock.calls[0][2];

      // Step 1 gets `Re: (no subject)` (step 1's own empty subject also
      // falls into the isEmptySubject branch — the first step has no
      // preceding step to thread under, so the placeholder carries
      // through via the Re: prefix chain. Not ideal aesthetically but
      // it (1) satisfies EB validation, (2) never crashes, (3) is
      // surfaced via a BL-085 warning so the operator notices the
      // upstream writer drift).
      expect(stepsArg[0].subject).toBe("Re: (no subject)");
      expect(stepsArg[1].subject).toBe("Re: (no subject)");
      expect(stepsArg[2].subject).toBe("fresh angle");

      // No empty subjects reached the wire (the whole point of this fix).
      for (const step of stepsArg) {
        expect(String(step.subject).trim()).not.toBe("");
      }

      // BL-085 warning fired because step 1 was empty.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).toMatch(/BL-085/);
      expect(warned).toMatch(/camp-bl085/);
    },
  );

  // -------------------------------------------------------------------------
  // (c) Regression — all subjects filled. Adapter must NOT inject `Re: ` on
  // any step; behaviour unchanged from pre-BL-085.
  // -------------------------------------------------------------------------
  it(
    "(c) 3-step sequence with all subjects filled → adapter preserves originals verbatim; no 'Re: ' prefix injected on any step",
    async () => {
      getCampaignMock.mockResolvedValue({
        id: "camp-bl085",
        targetListId: "tl-1",
        emailBisonCampaignId: null,
        emailSequence: [
          {
            position: 1,
            subjectLine: "first subject",
            body: "body 1",
            delayDays: 0,
          },
          {
            position: 2,
            subjectLine: "second subject",
            body: "body 2",
            delayDays: 3,
          },
          {
            position: 3,
            subjectLine: "third subject",
            body: "body 3",
            delayDays: 7,
          },
        ],
      });

      await adapter.deploy(DEPLOY_PARAMS);

      expect(ebMock.createSequenceSteps).toHaveBeenCalledTimes(1);
      const stepsArg = ebMock.createSequenceSteps.mock.calls[0][2];

      // All 3 subjects preserved verbatim — zero "Re: " injection.
      expect(stepsArg[0].subject).toBe("first subject");
      expect(stepsArg[1].subject).toBe("second subject");
      expect(stepsArg[2].subject).toBe("third subject");
      for (const step of stepsArg) {
        expect(String(step.subject).startsWith("Re: ")).toBe(false);
      }

      // No BL-085 warning — nothing empty.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).not.toMatch(/BL-085/);
    },
  );

  // -------------------------------------------------------------------------
  // (d) Real fixture — canary cmneqixpv's actual stored sequence shape.
  // Parses clean through StoredEmailSequenceStepSchema, batch POST has
  // non-empty subject on all 3 steps, step 2 threaded.
  // -------------------------------------------------------------------------
  it(
    "(d) real canary fixture (cmneqixpv emailSequence) → parses clean; batch POST has non-empty subject on all 3 steps; step 2 is 'Re: cleaners across multiple sites'",
    async () => {
      getCampaignMock.mockResolvedValue({
        id: "camp-bl085",
        targetListId: "tl-1",
        emailBisonCampaignId: null,
        emailSequence: CANARY_FIXTURE,
      });

      await adapter.deploy(DEPLOY_PARAMS);

      expect(ebMock.createSequenceSteps).toHaveBeenCalledTimes(1);
      const stepsArg = ebMock.createSequenceSteps.mock.calls[0][2];
      expect(stepsArg).toHaveLength(3);

      // Step 1 verbatim.
      expect(stepsArg[0].subject).toBe("cleaners across multiple sites");
      // Step 2 — was undefined (no subjectLine field on fixture) —
      // now threaded under step 1.
      expect(stepsArg[1].subject).toBe("Re: cleaners across multiple sites");
      // Step 3 verbatim.
      expect(stepsArg[2].subject).toBe("winning contracts losing margin");

      // All non-empty.
      for (const step of stepsArg) {
        expect(String(step.subject).trim()).not.toBe("");
      }

      // No BL-085 warning — step 1 had a real subject.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).not.toMatch(/BL-085/);

      // delay_days propagated (step 1=0 clamped to 1 by client, but at
      // the adapter→client boundary we pass through delayDays ?? 1, so
      // at this level step 1 has delay_days=1 due to the ?? fallback in
      // the adapter's map step. Step 2=3, step 3=7.
      //
      // Actually — reading the adapter, delayDays is passed as
      // `step.delayDays ?? 1`, so step 1 (delayDays=0) becomes… 0,
      // because `0 ?? 1` is 0 (nullish coalescing preserves 0). The
      // client then clamps to max(1, 0) = 1 on the wire. The adapter
      // test sees the pre-clamp value, which is 0 for step 1.
      expect(stepsArg[0].delay_days).toBe(0);
      expect(stepsArg[1].delay_days).toBe(3);
      expect(stepsArg[2].delay_days).toBe(7);
    },
  );
});
