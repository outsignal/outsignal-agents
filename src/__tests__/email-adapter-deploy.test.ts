/**
 * EmailAdapter.deploy() end-to-end launch (BL-061 Phase A, updated for
 * Phase 3 10-step flow + Phase 3.5 P2002 race guard).
 *
 * Verifies the deploy pipeline (step numbers match DEPLOY_STEP enum in
 * src/lib/channels/email-adapter.ts):
 *   1. createCampaign OR reuse existing EB campaign (idempotent)
 *   2. Persist emailBisonCampaignId on Campaign + CampaignDeploy
 *   3. Upsert sequence steps (GET existing, POST missing)
 *   4. createLead loop + attachLeadsToCampaign
 *   5. Upsert schedule (fresh deploy → createSchedule directly)
 *   6. attachSenderEmails (filter channel in [email,both], health [healthy,warning])
 *   7. updateCampaign settings
 *   8. Attach tags (documented no-op pending Workspace.ebTagIds)
 *   9. resumeCampaign (launch)
 *  10. getCampaign → verify status ∈ {queued|launching|active}
 *
 * Also covers the zero-leads and zero-senders edge paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted lets us share mock refs between the factory callbacks and the
// test body — factories are hoisted to the top of the file and can't close
// over ordinary module-level `const`s.
const {
  ebMock,
  getCampaignMock,
  prismaMock,
} = vi.hoisted(() => ({
  ebMock: {
    createCampaign: vi.fn(),
    getCampaign: vi.fn(),
    getSequenceSteps: vi.fn(),
    // BL-074 / Phase 6.5a: email-adapter.ts Step 3 calls the batched
    // `createSequenceSteps` (plural) against the v1.1 endpoint. Phase 6.5b
    // follow-through removed the deprecated singular `createSequenceStep`
    // from the real client after migrating the last two callers
    // (trigger/ooo-reengage.ts + agents/campaign.ts) to the batch API, so
    // the legacy mock stub is no longer needed as a tripwire.
    createSequenceSteps: vi.fn(),
    createLead: vi.fn(),
    // BL-088 — Step 4 switched from per-lead createLead to a single batch
    // upsert. createLead is preserved on the mock for non-canary callers
    // and as a tripwire (assert .not.toHaveBeenCalled in the happy path).
    createOrUpdateLeadsMultiple: vi.fn(),
    ensureCustomVariables: vi.fn(),
    attachLeadsToCampaign: vi.fn(),
    createSchedule: vi.fn(),
    getSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    attachSenderEmails: vi.fn(),
    updateCampaign: vi.fn(),
    resumeCampaign: vi.fn(),
    deleteCampaign: vi.fn(),
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
  // Return a constructable stub — `new EmailBisonClient(token)` must yield ebMock.
  EmailBisonClient: class {
    constructor() {
      return ebMock;
    }
  },
  // Adapter's Step 1 catch uses `err instanceof EmailBisonApiError` to detect
  // 404 record-not-found; export a compatible stub so the check is a no-op in
  // happy-path tests.
  EmailBisonApiError: class extends Error {
    isRecordNotFound = false;
  },
}));

vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
}));

// retry helper: pass-through (avoid 1s/5s/15s sleeps in failure tests)
vi.mock("@/lib/utils/retry", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { EmailAdapter } from "@/lib/channels/email-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal person shape the adapter uses. */
function fakePersonEntry(overrides: {
  email: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  company?: string;
  companyDomain?: string;
  location?: string;
}) {
  return {
    person: {
      email: overrides.email,
      firstName: overrides.firstName ?? null,
      lastName: overrides.lastName ?? null,
      jobTitle: overrides.jobTitle ?? null,
      company: overrides.company ?? null,
      companyDomain: overrides.companyDomain ?? null,
      location: overrides.location ?? null,
      workspaces: [],
    },
  };
}

function stubWorkspaceToken(token: string = "ws-token") {
  prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({ apiToken: token });
}

function stubCampaign(overrides: Record<string, unknown> = {}) {
  getCampaignMock.mockResolvedValue({
    id: "camp-1",
    targetListId: "tl-1",
    // Explicit null forces Step 1 down the fresh-deploy (createCampaign)
    // branch, keeping the happy path free of idempotency-specific mocks.
    emailBisonCampaignId: null,
    emailSequence: [
      { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
      { position: 2, subjectLine: "fu1", body: "follow up", delayDays: 3 },
    ],
    ...overrides,
  });
}

const DEPLOY_PARAMS = {
  deployId: "deploy-1",
  campaignId: "camp-1",
  campaignName: "Acme E1",
  workspaceSlug: "acme",
  channels: ["email"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmailAdapter.deploy()", () => {
  let adapter: EmailAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    adapter = new EmailAdapter();

    // Sensible defaults — individual tests override as needed.
    stubWorkspaceToken();
    stubCampaign();

    ebMock.createCampaign.mockResolvedValue({ id: 999, uuid: "uuid-999" });
    // Step 10 VERIFY_STATUS — GET campaign after resume, assert status
    // ∈ {queued|launching|active}. Default to "active" so happy paths
    // succeed; individual tests may override for failure cases.
    ebMock.getCampaign.mockResolvedValue({ id: 999, status: "active" });
    // Fresh-deploy path skips getSequenceSteps (preExistingEbId == null),
    // so this default is only exercised by idempotency tests if added.
    ebMock.getSequenceSteps.mockResolvedValue([]);
    // BL-074 — batched sequence step creation default: return a shape
    // compatible with SequenceStep[]. Individual tests that assert on
    // call args override via mockResolvedValueOnce.
    ebMock.createSequenceSteps.mockResolvedValue([
      { id: 1, campaign_id: 999, position: 1, subject: "hi", body: "hello", delay_days: 0 },
      { id: 2, campaign_id: 999, position: 2, subject: "fu1", body: "follow up", delay_days: 3 },
    ]);
    // BL-088 — Step 4 default: empty batch returns []. Tests that need
    // returned IDs override via mockResolvedValueOnce. createLead is left
    // unmocked at this layer; tests should never see it called now (Step 4
    // routes through createOrUpdateLeadsMultiple).
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([]);
    ebMock.ensureCustomVariables.mockResolvedValue(undefined);
    ebMock.attachLeadsToCampaign.mockResolvedValue(undefined);
    ebMock.createSchedule.mockResolvedValue({});
    ebMock.getSchedule.mockResolvedValue(null);
    ebMock.updateSchedule.mockResolvedValue({});
    ebMock.attachSenderEmails.mockResolvedValue(undefined);
    ebMock.updateCampaign.mockResolvedValue({});
    ebMock.resumeCampaign.mockResolvedValue({});
    ebMock.deleteCampaign.mockResolvedValue(undefined);

    prismaMock.campaign.update.mockResolvedValue({});
    prismaMock.campaignDeploy.update.mockResolvedValue({});
    prismaMock.webhookEvent.findFirst.mockResolvedValue(null); // not previously deployed

    prismaMock.sender.findMany.mockResolvedValue([
      { emailBisonSenderId: 501 },
      { emailBisonSenderId: 502 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  it("happy path: calls all 8 steps in the documented order with correct args", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakePersonEntry({ email: "a@acme.com", firstName: "A" }),
      fakePersonEntry({ email: "b@acme.com", firstName: "B" }),
    ]);
    // BL-088 — single batch upsert returns both lead IDs.
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValueOnce([
      { id: 1001, email: "a@acme.com", status: "active" },
      { id: 1002, email: "b@acme.com", status: "active" },
    ]);

    await adapter.deploy(DEPLOY_PARAMS);

    // Step 1
    expect(ebMock.createCampaign).toHaveBeenCalledWith({ name: "Acme E1" });

    // Step 3 — BL-074 / Phase 6.5a: a SINGLE batched createSequenceSteps
    // call for the whole sequence (replaces the per-step loop). Title
    // uses the Campaign name so EB's UI can trace back to the Outsignal
    // Campaign without a lookup. Per-step consumer shape is unchanged
    // (position/subject/body/delay_days) — the client handles v1.1 wire
    // transformation internally. Phase 6.5b follow-through deleted the
    // deprecated singular `createSequenceStep` entirely, so the
    // `not.toHaveBeenCalled()` tripwire is no longer necessary (the method
    // is gone at the type level).
    expect(ebMock.createSequenceSteps).toHaveBeenCalledTimes(1);
    // BL-093 (2026-04-16): adapter now emits `thread_reply` per-step.
    // Step 1 = false (always — initial step is fresh thread).
    // Step 2 has its own subject ('fu1') so thread_reply=false (fresh thread).
    expect(ebMock.createSequenceSteps).toHaveBeenCalledWith(999, "Acme E1", [
      { position: 1, subject: "hi", body: "hello", delay_days: 3, thread_reply: false },
      { position: 2, subject: "fu1", body: "follow up", delay_days: 0, thread_reply: false },
    ]);

    // Step 4 — BL-088: single batch upsert (NOT per-lead createLead).
    // The per-lead createLead path 422'd on retained workspace leads
    // (canary Run G blocker). Switched to /api/leads/create-or-update/multiple
    // with existing_lead_behavior='patch' so prior-run leads are tolerated.
    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(1);
    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledWith([
      { email: "a@acme.com", firstName: "A" },
      { email: "b@acme.com", firstName: "B" },
    ]);
    // Tripwire: per-lead createLead path is dead for Step 4.
    expect(ebMock.createLead).not.toHaveBeenCalled();

    // Step 4b — attachLeadsToCampaign with the captured EB IDs.
    expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledWith(999, [1001, 1002]);

    // Step 4 — createSchedule with Mon-Fri 09-17 Europe/London.
    // BL-087: EB v1.1 requires save_as_template on POST (despite docs marking
    // it optional). Always sent as `false` so per-campaign schedules don't
    // pollute the workspace template list.
    expect(ebMock.createSchedule).toHaveBeenCalledWith(999, {
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
    });

    // Step 5 — attach both sender IDs
    expect(ebMock.attachSenderEmails).toHaveBeenCalledWith(999, [501, 502]);

    // Step 6 — campaign-level defaults.
    // BL-093 (2026-04-16): can_unsubscribe flipped true → false (cold
    // outreach must not include unsubscribe links — they're a link
    // (deliverability hit) and the prospect relationship is too cold for
    // a formal unsub UX). See DEFAULT_CAMPAIGN_SETTINGS in email-adapter.ts.
    expect(ebMock.updateCampaign).toHaveBeenCalledWith(999, {
      plain_text: true,
      open_tracking: false,
      reputation_building: true,
      can_unsubscribe: false,
    });

    // Step 8 — launch
    expect(ebMock.resumeCampaign).toHaveBeenCalledWith(999);

    // Final status write
    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-1" },
      data: {
        emailStatus: "complete",
        emailStepCount: 2,
        leadCount: 2,
        emailError: null,
      },
    });
  });

  it("adds LOCATION and LASTEMAILMONTH custom variables during lead upsert", async () => {
    stubCampaign({
      description: "Signal follow-up lastEmailMonth:March",
    });
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakePersonEntry({
        email: "a@acme.com",
        firstName: "A",
        company: "Acme Services UK Limited",
        companyDomain: "acme.com",
        location: "Leeds, UK",
      }),
    ]);
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValueOnce([
      { id: 1001, email: "a@acme.com", status: "active" },
    ]);

    await adapter.deploy(DEPLOY_PARAMS);

    expect(ebMock.ensureCustomVariables).toHaveBeenCalledWith([
      "LOCATION",
      "LASTEMAILMONTH",
    ]);
    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledWith([
      {
        email: "a@acme.com",
        firstName: "A",
        lastName: undefined,
        jobTitle: undefined,
        company: "Acme",
        customVariables: [
          { name: "LOCATION", value: "Leeds, UK" },
          { name: "LASTEMAILMONTH", value: "March" },
        ],
      },
    ]);
  });

  it("happy path: invokes the pipeline in the documented sequential order", async () => {
    const callOrder: string[] = [];
    ebMock.createCampaign.mockImplementationOnce(async () => {
      callOrder.push("createCampaign");
      return { id: 999 };
    });
    // BL-074 — Step 3 is now a SINGLE batched call to createSequenceSteps.
    // Phase 6.5b follow-through deleted the deprecated singular
    // `createSequenceStep` entirely — no tripwire stub is needed.
    ebMock.createSequenceSteps.mockImplementation(async () => {
      callOrder.push("createSequenceSteps");
      return [
        { id: 1, campaign_id: 999, position: 1, subject: "hi", body: "hello", delay_days: 1 },
        { id: 2, campaign_id: 999, position: 2, subject: "fu1", body: "follow up", delay_days: 3 },
      ];
    });
    ebMock.createOrUpdateLeadsMultiple.mockImplementation(async () => {
      callOrder.push("createOrUpdateLeadsMultiple");
      return [{ id: 1001, email: "a@acme.com", status: "active" }];
    });
    ebMock.attachLeadsToCampaign.mockImplementationOnce(async () => {
      callOrder.push("attachLeadsToCampaign");
    });
    ebMock.createSchedule.mockImplementationOnce(async () => {
      callOrder.push("createSchedule");
      return {};
    });
    ebMock.attachSenderEmails.mockImplementationOnce(async () => {
      callOrder.push("attachSenderEmails");
    });
    ebMock.updateCampaign.mockImplementationOnce(async () => {
      callOrder.push("updateCampaign");
      return {};
    });
    ebMock.resumeCampaign.mockImplementationOnce(async () => {
      callOrder.push("resumeCampaign");
      return {};
    });
    ebMock.getCampaign.mockImplementationOnce(async () => {
      callOrder.push("getCampaign");
      return { id: 999, status: "active" };
    });

    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakePersonEntry({ email: "a@acme.com" }),
    ]);

    await adapter.deploy(DEPLOY_PARAMS);

    // Phase 3 added Step 10 verify via getCampaign after resumeCampaign.
    // BL-074 / Phase 6.5a — Step 3 collapsed from two per-step
    // createSequenceStep POSTs into ONE batched createSequenceSteps call.
    expect(callOrder).toEqual([
      "createCampaign",
      "createSequenceSteps",
      "createOrUpdateLeadsMultiple",
      "attachLeadsToCampaign",
      "createSchedule",
      "attachSenderEmails",
      "updateCampaign",
      "resumeCampaign",
      "getCampaign",
    ]);
  });

  // -------------------------------------------------------------------------
  // Zero-leads path
  // -------------------------------------------------------------------------
  it("zero leads: skips attach/schedule/senders/update/resume, marks complete with 'no_leads_to_deploy'", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([]); // list is empty

    await adapter.deploy(DEPLOY_PARAMS);

    // The early-return MUST skip every post-Step-4 step.
    expect(ebMock.createCampaign).toHaveBeenCalledTimes(1);
    // BL-088 — empty leads array short-circuits the upsert call entirely
    // (eligibleLeads.length === 0 branch in adapter).
    expect(ebMock.createOrUpdateLeadsMultiple).not.toHaveBeenCalled();
    expect(ebMock.createLead).not.toHaveBeenCalled();
    expect(ebMock.attachLeadsToCampaign).not.toHaveBeenCalled();
    expect(ebMock.createSchedule).not.toHaveBeenCalled();
    expect(ebMock.attachSenderEmails).not.toHaveBeenCalled();
    expect(ebMock.updateCampaign).not.toHaveBeenCalled();
    expect(ebMock.resumeCampaign).not.toHaveBeenCalled();

    // Final deploy row reflects the explanatory status.
    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-1" },
      data: {
        emailStatus: "complete",
        leadCount: 0,
        emailError: "no_leads_to_deploy",
      },
    });
  });

  it("zero leads after dedup: also short-circuits", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakePersonEntry({ email: "already@acme.com" }),
    ]);
    // Simulate prior EMAIL_SENT event — loop skips, no upsert fires.
    prismaMock.webhookEvent.findFirst.mockResolvedValue({ id: "ev-1" });

    await adapter.deploy(DEPLOY_PARAMS);

    // BL-088 — eligibleLeads filter excludes already-deployed leads BEFORE
    // building the batch, so the upsert is never called when the only lead
    // was previously deployed.
    expect(ebMock.createOrUpdateLeadsMultiple).not.toHaveBeenCalled();
    expect(ebMock.createLead).not.toHaveBeenCalled();
    expect(ebMock.attachLeadsToCampaign).not.toHaveBeenCalled();
    expect(ebMock.resumeCampaign).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Zero-senders path
  // -------------------------------------------------------------------------
  it("zero senders: throws, marks failed, never calls resumeCampaign", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakePersonEntry({ email: "a@acme.com" }),
    ]);
    // BL-088 — single batch upsert returns the lead ID (Step 4 succeeds).
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
      { id: 1001, email: "a@acme.com", status: "active" },
    ]);
    prismaMock.sender.findMany.mockResolvedValue([]); // no eligible senders

    await expect(adapter.deploy(DEPLOY_PARAMS)).rejects.toThrow(
      /No EB-registered healthy senders/,
    );

    // We reached the batch upsert + attachLeadsToCampaign (both pre-sender-check) ...
    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(1);
    expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledWith(999, [1001]);
    expect(ebMock.createSchedule).toHaveBeenCalledTimes(1);
    // ... but never attached senders or launched.
    expect(ebMock.attachSenderEmails).not.toHaveBeenCalled();
    expect(ebMock.resumeCampaign).not.toHaveBeenCalled();

    // Failure row written.
    const lastUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate).toMatchObject({
      where: { id: "deploy-1" },
      data: { emailStatus: "failed" },
    });
    expect(lastUpdate.data.emailError).toMatch(/No EB-registered healthy senders/);
  });

  // -------------------------------------------------------------------------
  // Sender filter correctness
  // -------------------------------------------------------------------------
  it("queries Sender with channel (email|both) + emailBisonSenderId not-null + healthStatus (healthy|warning)", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakePersonEntry({ email: "a@acme.com" }),
    ]);
    // BL-088 — batch upsert path.
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
      { id: 1001, email: "a@acme.com", status: "active" },
    ]);

    await adapter.deploy(DEPLOY_PARAMS);

    // BL-093 (2026-04-16): adapter now adds a stable `orderBy:
    // emailBisonSenderId asc` so the per-campaign allocation map
    // (CAMPAIGN_SENDER_ALLOCATION) reproduces deterministically against
    // a known, stable sender ordering.
    expect(prismaMock.sender.findMany).toHaveBeenCalledWith({
      where: {
        workspaceSlug: "acme",
        channel: { in: ["email", "both"] },
        emailBisonSenderId: { not: null },
        healthStatus: { in: ["healthy", "warning"] },
      },
      select: { emailBisonSenderId: true },
      orderBy: { emailBisonSenderId: "asc" },
    });
  });
});
