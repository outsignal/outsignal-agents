/**
 * BL-085 / BL-093 — reply-in-thread handling in EmailAdapter.deploy.
 *
 * BL-093 (2026-04-16) — EB v1.1 behaviour, verified empirically against
 * canary EB 87 + live Lime production campaigns (26/31/32/42/43/44/45):
 *   (a) `thread_reply: true` (boolean on sequence_steps) — tells EB to
 *       emit RFC 5322 In-Reply-To / References headers AND to AUTO-PREPEND
 *       "Re: " to the email_subject value before storage. Sending
 *       `email_subject="X"` with thread_reply=true results in EB storing
 *       `email_subject="Re: X"`.
 *   (b) `email_subject` MUST still be non-empty even with thread_reply=true
 *       (validation rejects empty). Send the RAW firstStepSubject — EB
 *       prepends the Re: prefix server-side.
 *
 * Outsignal convention (feedback_email_threading_subject memory):
 * follow-up email steps ship with an EMPTY subjectLine so recipient-side
 * clients thread the follow-up under step 1.
 *
 * Adapter contract (post-BL-093):
 *   - Step 1 (initial) → thread_reply=false, populated subject (verbatim).
 *   - Follow-up step with empty subject → thread_reply=true,
 *     email_subject=<firstStepSubject> (RAW, no Re: prefix — EB auto-prepends).
 *   - Follow-up step with populated subject → thread_reply=false,
 *     uses its own subject (fresh thread, no Re: injection).
 *   - Defensive: step 1 with empty subject → thread_reply=false,
 *     placeholder "(no subject)", warn emitted.
 *
 * Test cases:
 *   (a) happy path — 3-step sequence, step 2 empty subject. Batch POST
 *       has thread_reply=true + email_subject='hello there' (RAW step 1
 *       subject) for step 2; step 1 and step 3 have thread_reply=false
 *       with their own subjects verbatim.
 *   (b) edge — step 1 itself has empty subject (defensive). Step 1 gets
 *       "(no subject)" placeholder + thread_reply=false; step 2 threads
 *       with subject="(no subject)" (RAW) + thread_reply=true.
 *   (c) regression — all 3 subjects filled. Adapter preserves
 *       originals verbatim; thread_reply=false on every step.
 *   (d) real fixture — canary cmneqixpv's actual emailSequence JSON
 *       shape (canonical Phase 6.5c). Parses clean, step 2 threads via
 *       thread_reply=true + subject='cleaners across multiple sites'.
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
    // BL-088 — Step 4 routes through this batch upsert.
    createOrUpdateLeadsMultiple: vi.fn(),
    ensureCustomVariables: vi.fn(),
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
        lastName: "Lead",
        jobTitle: null,
        company: null,
        workspaces: [],
      },
    },
  ]);
  prismaMock.webhookEvent.findFirst.mockResolvedValue(null);
  // BL-088 — single batch upsert returns the eligible lead's EB ID.
  ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
    { id: 1001, email: "a@acme.com", status: "active" },
  ]);
  ebMock.ensureCustomVariables.mockResolvedValue(undefined);
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
    "(a) 3-step sequence with step 2 empty subject → step 2 has thread_reply=true + email_subject='hello there' (RAW; EB prepends Re:); step 1 + 3 have thread_reply=false with own subjects",
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

      // Step 1 — fresh thread, populated subject.
      expect(stepsArg[0].subject).toBe("hello there");
      expect(stepsArg[0].thread_reply).toBe(false);

      // Step 2 — threaded follow-up. Subject is the RAW step 1 subject
      // (NOT prefixed with Re: — EB auto-prepends server-side when
      // thread_reply=true). thread_reply=true on the wire.
      expect(stepsArg[1].subject).toBe("hello there");
      expect(stepsArg[1].thread_reply).toBe(true);

      // Step 3 — own subject, fresh thread.
      expect(stepsArg[2].subject).toBe("fresh angle");
      expect(stepsArg[2].thread_reply).toBe(false);

      // No BL-093 warning — step 1 had a real subject so the placeholder
      // path did not fire.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).not.toMatch(/BL-093/);
    },
  );

  // -------------------------------------------------------------------------
  // (b) Edge — step 1 itself empty. Defensive placeholder + warn.
  // -------------------------------------------------------------------------
  it(
    "(b) step 1 has empty subjectLine (defensive edge) → step 1 gets '(no subject)' + thread_reply=false; warn emitted; step 2 threads with raw '(no subject)' + thread_reply=true",
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

      // Step 1 — empty subject is a writer regression. We use placeholder
      // and DO NOT thread (no prior step exists to thread under).
      expect(stepsArg[0].subject).toBe("(no subject)");
      expect(stepsArg[0].thread_reply).toBe(false);

      // Step 2 — empty subject + has prior step → threads. Subject is
      // the RAW placeholder from step 1 (EB will auto-prepend Re:).
      expect(stepsArg[1].subject).toBe("(no subject)");
      expect(stepsArg[1].thread_reply).toBe(true);

      // Step 3 — own subject preserved, fresh thread.
      expect(stepsArg[2].subject).toBe("fresh angle");
      expect(stepsArg[2].thread_reply).toBe(false);

      // BL-093 warning fired because step 1 was empty.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).toMatch(/BL-093/);
      expect(warned).toMatch(/camp-bl085/);
    },
  );

  // -------------------------------------------------------------------------
  // (c) Regression — all subjects filled. Adapter must keep thread_reply=false
  // on every step; subject preserved verbatim.
  // -------------------------------------------------------------------------
  it(
    "(c) 3-step sequence with all subjects filled → adapter preserves originals verbatim; thread_reply=false on every step",
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

      // All 3 subjects preserved verbatim.
      expect(stepsArg[0].subject).toBe("first subject");
      expect(stepsArg[1].subject).toBe("second subject");
      expect(stepsArg[2].subject).toBe("third subject");

      // No threading — every step has its own subject.
      for (const step of stepsArg) {
        expect(step.thread_reply).toBe(false);
      }

      // No BL-093 warning — nothing empty.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).not.toMatch(/BL-093/);
    },
  );

  // -------------------------------------------------------------------------
  // (d) Real fixture — canary cmneqixpv's actual stored sequence shape.
  // Parses clean through StoredEmailSequenceStepSchema, step 2 threads via
  // thread_reply=true + empty subject.
  // -------------------------------------------------------------------------
  it(
    "(d) real canary fixture (cmneqixpv emailSequence) → parses clean; step 2 has thread_reply=true + email_subject='cleaners across multiple sites' (RAW; EB prepends Re: to render 'Re: cleaners across multiple sites')",
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

      // Step 1 verbatim — fresh thread.
      expect(stepsArg[0].subject).toBe("cleaners across multiple sites");
      expect(stepsArg[0].thread_reply).toBe(false);

      // Step 2 — was undefined (no subjectLine field on fixture) —
      // now threads via thread_reply=true. Subject is the RAW step 1
      // value (EB auto-prepends "Re: " server-side when stored).
      expect(stepsArg[1].subject).toBe("cleaners across multiple sites");
      expect(stepsArg[1].thread_reply).toBe(true);

      // Step 3 verbatim — fresh thread.
      expect(stepsArg[2].subject).toBe("winning contracts losing margin");
      expect(stepsArg[2].thread_reply).toBe(false);

      // No BL-093 warning — step 1 had a real subject.
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).not.toMatch(/BL-093/);

      // BL-113 (2026-04-20): writer delays are absolute-from-start
      // semantics ([0,3,7]) but EmailBison expects gap-to-next semantics.
      // Adapter translates before the client wire boundary.
      expect(stepsArg[0].delay_days).toBe(3);
      expect(stepsArg[1].delay_days).toBe(4);
      expect(stepsArg[2].delay_days).toBe(0);
    },
  );

  it("(e) BL-068 shape: zero-based email step positions fail loud before EB state is touched", async () => {
    getCampaignMock.mockResolvedValue({
      id: "camp-bl085",
      targetListId: "tl-1",
      emailBisonCampaignId: null,
      emailSequence: [
        {
          position: 0,
          subjectLine: "hello there",
          body: "body 1",
          delayDays: 0,
        },
      ],
    });

    const deploy = adapter.deploy(DEPLOY_PARAMS);

    await expect(deploy).rejects.toThrow(/BL-068/);
    await expect(deploy).rejects.toThrow(
      /Email step positions must start at 1/,
    );

    expect(ebMock.getSequenceSteps).not.toHaveBeenCalled();
    expect(ebMock.createSequenceSteps).not.toHaveBeenCalled();
  });
});
