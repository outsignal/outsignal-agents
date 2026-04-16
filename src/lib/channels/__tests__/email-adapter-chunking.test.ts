/**
 * EmailAdapter.deploy Step 4 — 500-lead chunking (BL-108).
 *
 * Why this test exists:
 *   EmailBison's `POST /api/leads/create-or-update/multiple` endpoint caps
 *   each request at 500 leads (docs/emailbison-dedi-api-reference.md:1599
 *   "The leads field must not have more than 500 items"). Prior to BL-108
 *   the adapter sent `eligibleLeads` in a single request, which 422'd on
 *   the 1210-solutions Green List Priority canary (579 leads — see
 *   decisions entry 2026-04-17T02:30:00Z).
 *
 *   BL-108 adds an inline `for (i=0; i<len; i+=500)` chunk loop around the
 *   upsert call. Each chunk is independently withRetry-wrapped (safe per
 *   BL-088's idempotent-upsert semantic) and the returned IDs are
 *   accumulated into a single array that flows through to
 *   attachLeadsToCampaign unchanged.
 *
 * Cases:
 *   (1) 100 leads (under threshold)  → 1 chunk call, size 100
 *   (2) 500 leads (exact threshold)  → 1 chunk call, size 500
 *   (3) 501 leads (one over)         → 2 chunk calls, sizes 500 + 1
 *   (4) 1250 leads (many over)       → 3 chunk calls, sizes 500 + 500 + 250
 *   (5) 0 eligible leads             → 0 chunk calls (empty exit preserved)
 *   (6) Accumulated IDs preserve order across chunks and flow into
 *       attachLeadsToCampaign via a single batch call
 *
 * Mock style mirrors email-adapter-step4-upsert.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ebMock, getCampaignMock, prismaMock } = vi.hoisted(() => ({
  ebMock: {
    createCampaign: vi.fn(),
    getCampaign: vi.fn(),
    deleteCampaign: vi.fn(),
    getSequenceSteps: vi.fn(),
    createSequenceSteps: vi.fn(),
    createLead: vi.fn(),
    createOrUpdateLeadsMultiple: vi.fn(),
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

// Pass-through retry — no backoff sleep in tests.
vi.mock("@/lib/utils/retry", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { EmailAdapter } from "@/lib/channels/email-adapter";

const DEPLOY_PARAMS = {
  deployId: "deploy-bl108",
  campaignId: "camp-bl108",
  campaignName: "BL-108 Chunking Campaign",
  workspaceSlug: "acme",
  channels: ["email"],
};

/**
 * Build N fake TargetListPerson entries with unique emails.
 * Each entry has the shape consumed by the Step 4 pre-filter + batch map.
 */
function fakeEntries(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    person: {
      email: `lead${i}@acme.com`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      jobTitle: "Role",
      company: "Acme Ltd",
      companyDomain: "acme.com",
      workspaces: [],
    },
  }));
}

/**
 * Install a createOrUpdateLeadsMultiple mock that returns N fake lead IDs
 * matching the request's size, starting at `idOffset`. ID range is used to
 * assert accumulation order across chunks.
 */
function installUpsertMock() {
  let nextId = 10000;
  ebMock.createOrUpdateLeadsMultiple.mockImplementation(
    async (
      batch: Array<{ email: string }>,
    ) => {
      const results = batch.map((lead) => ({
        id: nextId++,
        email: lead.email,
        status: "active" as const,
      }));
      return results;
    },
  );
}

describe("EmailAdapter.deploy Step 4 — 500-lead chunking (BL-108)", () => {
  let adapter: EmailAdapter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new EmailAdapter();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
      apiToken: "ws-token",
    });

    // Fresh deploy — Step 1 takes the createCampaign branch.
    getCampaignMock.mockResolvedValue({
      id: "camp-bl108",
      targetListId: "tl-bl108",
      emailBisonCampaignId: null,
      emailSequence: [
        { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
      ],
    });

    ebMock.createCampaign.mockResolvedValue({ id: 9999, uuid: "uuid-9999" });
    ebMock.getSequenceSteps.mockResolvedValue([]);
    ebMock.createSequenceSteps.mockResolvedValue([
      {
        id: 1,
        campaign_id: 9999,
        position: 1,
        subject: "hi",
        body: "hello",
        delay_days: 1,
      },
    ]);
    ebMock.attachLeadsToCampaign.mockResolvedValue(undefined);
    ebMock.createSchedule.mockResolvedValue({});
    ebMock.getSchedule.mockResolvedValue(null);
    ebMock.attachSenderEmails.mockResolvedValue(undefined);
    ebMock.updateCampaign.mockResolvedValue({});
    ebMock.resumeCampaign.mockResolvedValue({});
    ebMock.getCampaign.mockResolvedValue({ id: 9999, status: "active" });

    prismaMock.sender.findMany.mockResolvedValue([
      { emailBisonSenderId: 501 },
    ]);
    prismaMock.campaignDeploy.update.mockResolvedValue({});
    prismaMock.campaign.update.mockResolvedValue({});
    // Default: no leads previously deployed (dedup returns null).
    prismaMock.webhookEvent.findFirst.mockResolvedValue(null);

    installUpsertMock();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (1) 100 leads — under threshold → 1 chunk call, size 100
  // -------------------------------------------------------------------------
  it("(1) 100 leads → 1 chunk call with 100 entries", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue(fakeEntries(100));

    await adapter.deploy(DEPLOY_PARAMS);

    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(1);
    expect(ebMock.createOrUpdateLeadsMultiple.mock.calls[0][0]).toHaveLength(100);

    // All 100 IDs flow to attachLeadsToCampaign in order.
    expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledTimes(1);
    const attachedIds = ebMock.attachLeadsToCampaign.mock.calls[0][1];
    expect(attachedIds).toHaveLength(100);
    expect(attachedIds[0]).toBe(10000);
    expect(attachedIds[99]).toBe(10099);
  });

  // -------------------------------------------------------------------------
  // (2) 500 leads — exact threshold → 1 chunk call, size 500
  // -------------------------------------------------------------------------
  it("(2) 500 leads → 1 chunk call with exactly 500 entries (no second call)", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue(fakeEntries(500));

    await adapter.deploy(DEPLOY_PARAMS);

    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(1);
    expect(ebMock.createOrUpdateLeadsMultiple.mock.calls[0][0]).toHaveLength(500);

    const attachedIds = ebMock.attachLeadsToCampaign.mock.calls[0][1];
    expect(attachedIds).toHaveLength(500);
  });

  // -------------------------------------------------------------------------
  // (3) 501 leads — one over threshold → 2 chunk calls (500 + 1)
  // -------------------------------------------------------------------------
  it("(3) 501 leads → 2 chunk calls sized 500 + 1 (boundary regression)", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue(fakeEntries(501));

    await adapter.deploy(DEPLOY_PARAMS);

    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(2);
    expect(ebMock.createOrUpdateLeadsMultiple.mock.calls[0][0]).toHaveLength(500);
    expect(ebMock.createOrUpdateLeadsMultiple.mock.calls[1][0]).toHaveLength(1);

    // attachLeadsToCampaign receives the ACCUMULATED IDs from both chunks in
    // one call. IDs follow the mock counter so chunk 1 = 10000..10499, chunk
    // 2 = 10500 (the single lead over the boundary).
    expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledTimes(1);
    const attachedIds = ebMock.attachLeadsToCampaign.mock.calls[0][1];
    expect(attachedIds).toHaveLength(501);
    expect(attachedIds[0]).toBe(10000);
    expect(attachedIds[499]).toBe(10499);
    expect(attachedIds[500]).toBe(10500);
  });

  // -------------------------------------------------------------------------
  // (4) 1250 leads — many over threshold → 3 chunk calls (500 + 500 + 250)
  // -------------------------------------------------------------------------
  it("(4) 1250 leads → 3 chunk calls sized 500 + 500 + 250", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue(fakeEntries(1250));

    await adapter.deploy(DEPLOY_PARAMS);

    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(3);
    expect(ebMock.createOrUpdateLeadsMultiple.mock.calls[0][0]).toHaveLength(500);
    expect(ebMock.createOrUpdateLeadsMultiple.mock.calls[1][0]).toHaveLength(500);
    expect(ebMock.createOrUpdateLeadsMultiple.mock.calls[2][0]).toHaveLength(250);

    // Full 1250 accumulated IDs flow through one attachLeadsToCampaign call.
    expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledTimes(1);
    const attachedIds = ebMock.attachLeadsToCampaign.mock.calls[0][1];
    expect(attachedIds).toHaveLength(1250);
    // Order preserved across chunks — chunk boundaries at indices 499→500,
    // 999→1000.
    expect(attachedIds[0]).toBe(10000);
    expect(attachedIds[499]).toBe(10499);
    expect(attachedIds[500]).toBe(10500);
    expect(attachedIds[999]).toBe(10999);
    expect(attachedIds[1000]).toBe(11000);
    expect(attachedIds[1249]).toBe(11249);
  });

  // -------------------------------------------------------------------------
  // (5) 0 eligible leads — empty exit preserved (no chunk calls)
  // -------------------------------------------------------------------------
  it("(5) 0 eligible leads → 0 chunk calls, attachLeadsToCampaign not called", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([]);

    await adapter.deploy(DEPLOY_PARAMS);

    expect(ebMock.createOrUpdateLeadsMultiple).not.toHaveBeenCalled();
    expect(ebMock.attachLeadsToCampaign).not.toHaveBeenCalled();

    // Deploy row marks zero-leads exit path.
    const updates = prismaMock.campaignDeploy.update.mock.calls;
    const zeroLeadsUpdate = updates.find(
      (c) => (c[0] as { data?: { emailError?: string } }).data?.emailError ===
        "no_leads_to_deploy",
    );
    expect(zeroLeadsUpdate).toBeTruthy();
  });
});
