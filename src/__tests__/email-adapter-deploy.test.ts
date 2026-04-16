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
    // BL-074 / Phase 6.5a: email-adapter.ts Step 3 now calls the batched
    // `createSequenceSteps` (plural) against the v1.1 endpoint. The
    // deprecated per-step `createSequenceStep` remains on the client for
    // legacy callers (trigger/ooo-reengage.ts, agents/campaign.ts) but is
    // NOT invoked by the adapter anymore. We keep the old mock declared
    // so any test that introspects calls on it keeps its shape (and so a
    // future accidental revert to the old method fails loud in tests).
    createSequenceStep: vi.fn(),
    createSequenceSteps: vi.fn(),
    createLead: vi.fn(),
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
}) {
  return {
    person: {
      email: overrides.email,
      firstName: overrides.firstName ?? null,
      lastName: overrides.lastName ?? null,
      jobTitle: overrides.jobTitle ?? null,
      company: overrides.company ?? null,
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
    ebMock.createSequenceStep.mockResolvedValue({ id: 1 });
    // BL-074 — batched sequence step creation default: return a shape
    // compatible with SequenceStep[]. Individual tests that assert on
    // call args override via mockResolvedValueOnce.
    ebMock.createSequenceSteps.mockResolvedValue([
      { id: 1, campaign_id: 999, position: 1, subject: "hi", body: "hello", delay_days: 0 },
      { id: 2, campaign_id: 999, position: 2, subject: "fu1", body: "follow up", delay_days: 3 },
    ]);
    // createLead is a per-call mock — happy-path tests set it via mockResolvedValueOnce.
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
    ebMock.createLead
      .mockResolvedValueOnce({ id: 1001, email: "a@acme.com", status: "active" })
      .mockResolvedValueOnce({ id: 1002, email: "b@acme.com", status: "active" });

    await adapter.deploy(DEPLOY_PARAMS);

    // Step 1
    expect(ebMock.createCampaign).toHaveBeenCalledWith({ name: "Acme E1" });

    // Step 3 — BL-074 / Phase 6.5a: a SINGLE batched createSequenceSteps
    // call for the whole sequence (replaces the per-step loop). Title
    // uses the Campaign name so EB's UI can trace back to the Outsignal
    // Campaign without a lookup. Per-step consumer shape is unchanged
    // (position/subject/body/delay_days) — the client handles v1.1 wire
    // transformation internally.
    expect(ebMock.createSequenceStep).not.toHaveBeenCalled();
    expect(ebMock.createSequenceSteps).toHaveBeenCalledTimes(1);
    expect(ebMock.createSequenceSteps).toHaveBeenCalledWith(999, "Acme E1", [
      { position: 1, subject: "hi", body: "hello", delay_days: 0 },
      { position: 2, subject: "fu1", body: "follow up", delay_days: 3 },
    ]);

    // Step 3 — per-lead createLead
    expect(ebMock.createLead).toHaveBeenCalledTimes(2);

    // Step 3b — attachLeadsToCampaign with the captured EB IDs
    expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledWith(999, [1001, 1002]);

    // Step 4 — createSchedule with Mon-Fri 09-17 Europe/London
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
    });

    // Step 5 — attach both sender IDs
    expect(ebMock.attachSenderEmails).toHaveBeenCalledWith(999, [501, 502]);

    // Step 6 — campaign-level defaults
    expect(ebMock.updateCampaign).toHaveBeenCalledWith(999, {
      plain_text: true,
      open_tracking: false,
      reputation_building: true,
      can_unsubscribe: true,
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

  it("happy path: invokes the pipeline in the documented sequential order", async () => {
    const callOrder: string[] = [];
    ebMock.createCampaign.mockImplementationOnce(async () => {
      callOrder.push("createCampaign");
      return { id: 999 };
    });
    // BL-074 — Step 3 is now a SINGLE batched call to createSequenceSteps.
    // We still register a stub on the legacy `createSequenceStep` mock so
    // any accidental revert to the old method surfaces here (the assertion
    // below asserts it NEVER appears in the call order).
    ebMock.createSequenceStep.mockImplementation(async () => {
      callOrder.push("createSequenceStep");
      return { id: 1 };
    });
    ebMock.createSequenceSteps.mockImplementation(async () => {
      callOrder.push("createSequenceSteps");
      return [
        { id: 1, campaign_id: 999, position: 1, subject: "hi", body: "hello", delay_days: 1 },
        { id: 2, campaign_id: 999, position: 2, subject: "fu1", body: "follow up", delay_days: 3 },
      ];
    });
    ebMock.createLead.mockImplementation(async () => {
      callOrder.push("createLead");
      return { id: 1001 + callOrder.filter((s) => s === "createLead").length };
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
      "createLead",
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

    // The early-return MUST skip every post-createLead step.
    expect(ebMock.createCampaign).toHaveBeenCalledTimes(1);
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
    // Simulate prior EMAIL_SENT event — loop skips, createLead never fires.
    prismaMock.webhookEvent.findFirst.mockResolvedValue({ id: "ev-1" });

    await adapter.deploy(DEPLOY_PARAMS);

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
    ebMock.createLead.mockResolvedValue({
      id: 1001,
      email: "a@acme.com",
      status: "active",
    });
    prismaMock.sender.findMany.mockResolvedValue([]); // no eligible senders

    await expect(adapter.deploy(DEPLOY_PARAMS)).rejects.toThrow(
      /No EB-registered healthy senders/,
    );

    // We reached createLead + attachLeadsToCampaign (both pre-sender-check) ...
    expect(ebMock.createLead).toHaveBeenCalledTimes(1);
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
    ebMock.createLead.mockResolvedValue({
      id: 1001,
      email: "a@acme.com",
      status: "active",
    });

    await adapter.deploy(DEPLOY_PARAMS);

    expect(prismaMock.sender.findMany).toHaveBeenCalledWith({
      where: {
        workspaceSlug: "acme",
        channel: { in: ["email", "both"] },
        emailBisonSenderId: { not: null },
        healthStatus: { in: ["healthy", "warning"] },
      },
      select: { emailBisonSenderId: true },
    });
  });
});
