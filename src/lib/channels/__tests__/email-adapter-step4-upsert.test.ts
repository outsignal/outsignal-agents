/**
 * EmailAdapter.deploy Step 4 — batch upsert path (BL-088).
 *
 * Why this test exists:
 *   Canary Run G failed at Step 4 with 422 'The email has already been
 *   taken.' because EB's lead store is workspace-scoped, not
 *   campaign-scoped, so prior canary runs' leads (Run F) blocked any
 *   subsequent createLead with the same email. BL-088 swaps the per-lead
 *   `createLead` POST loop for a single batch
 *   `createOrUpdateLeadsMultiple` call against the upsert endpoint.
 *
 * Cases:
 *   (1) Single batch POST with the correct body shape — all eligible
 *       leads sent in ONE call. Critical regression: per-lead createLead
 *       must NOT fire.
 *   (2) Pre-existing lead in EB workspace — the upsert returns 200 with
 *       existing IDs (NOT 422). This is the canary scenario the BL-088
 *       fix was built for.
 *   (3) WebhookEvent dedup still applies — already-deployed leads are
 *       filtered out BEFORE the batch is built, so the wire payload
 *       only contains eligible leads.
 *   (4) Lead with null email is filtered out before the batch.
 *   (5) All leads filtered → no upsert call, deploy short-circuits via
 *       the existing zero-leads early exit.
 *
 * Mock style mirrors email-adapter-race.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingRequiredLeadFieldError } from "@/lib/emailbison/lead-payload";

const { ebMock, getCampaignMock, prismaMock } = vi.hoisted(() => ({
  ebMock: {
    createCampaign: vi.fn(),
    getCampaign: vi.fn(),
    deleteCampaign: vi.fn(),
    getSequenceSteps: vi.fn(),
    createSequenceSteps: vi.fn(),
    createLead: vi.fn(),
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

// Pass-through retry — failure-path assertions don't sleep on backoff.
vi.mock("@/lib/utils/retry", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { EmailAdapter } from "@/lib/channels/email-adapter";

const DEPLOY_PARAMS = {
  deployId: "deploy-bl088",
  campaignId: "camp-bl088",
  campaignName: "BL-088 Step 4 Upsert Campaign",
  workspaceSlug: "acme",
  channels: ["email"],
};

function fakeEntry(p: {
  id?: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  company?: string | null;
}) {
  return {
    person: {
      id: p.id ?? p.email ?? "person-without-email",
      email: p.email,
      firstName: p.firstName ?? null,
      lastName: p.lastName === undefined ? "Lead" : p.lastName,
      jobTitle: p.jobTitle ?? null,
      company: p.company ?? null,
      workspaces: [],
    },
  };
}

describe("EmailAdapter.deploy Step 4 — batch upsert (BL-088)", () => {
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
    getCampaignMock.mockResolvedValue({
      id: "camp-bl088",
      targetListId: "tl-bl088",
      emailBisonCampaignId: null,
      emailSequence: [
        { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
      ],
    });

    ebMock.createCampaign.mockResolvedValue({ id: 9999, uuid: "uuid-9999" });
    ebMock.getSequenceSteps.mockResolvedValue([]);
    ebMock.createSequenceSteps.mockResolvedValue([
      { id: 1, campaign_id: 9999, position: 1, subject: "hi", body: "hello", delay_days: 1 },
    ]);
    ebMock.ensureCustomVariables.mockResolvedValue(undefined);
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
    // Default: no leads previously deployed (per-call dedup returns null).
    prismaMock.webhookEvent.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (1) Single batch POST with correct body shape
  // -------------------------------------------------------------------------
  it(
    "(1) makes ONE batch upsert call with all eligible leads in the body; " +
      "per-lead createLead is NOT called",
    async () => {
      prismaMock.targetListPerson.findMany.mockResolvedValue([
        fakeEntry({
          email: "alice@acme.com",
          firstName: "Alice",
          lastName: "A",
          jobTitle: "CEO",
          company: "Acme",
        }),
        fakeEntry({
          email: "bob@acme.com",
          firstName: "Bob",
          lastName: "B",
          jobTitle: "CTO",
          company: "Acme",
        }),
        fakeEntry({
          email: "carol@acme.com",
          firstName: "Carol",
        }),
      ]);
      ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
        { id: 7001, email: "alice@acme.com", status: "active" },
        { id: 7002, email: "bob@acme.com", status: "active" },
        { id: 7003, email: "carol@acme.com", status: "active" },
      ]);

      await adapter.deploy(DEPLOY_PARAMS);

      // Critical: per-lead createLead is dead in Step 4. If this fires,
      // BL-088 has regressed and the canary 422 returns.
      expect(ebMock.createLead).not.toHaveBeenCalled();

      // SINGLE batch POST.
      expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(1);

      // Body shape — adapter passes consumer-facing camelCase; the client
      // handles the snake_case wire transformation. Optional fields drop
      // from individual lead entries when null/undefined on the person row.
      expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledWith([
        {
          email: "alice@acme.com",
          firstName: "Alice",
          lastName: "A",
          jobTitle: "CEO",
          company: "Acme",
        },
        {
          email: "bob@acme.com",
          firstName: "Bob",
          lastName: "B",
          jobTitle: "CTO",
          company: "Acme",
        },
        {
          email: "carol@acme.com",
          firstName: "Carol",
          lastName: "Lead",
          jobTitle: undefined,
          company: undefined,
        },
      ]);

      // Returned IDs flow into attachLeadsToCampaign in the same order.
      expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledWith(
        9999,
        [7001, 7002, 7003],
      );

      // Final deploy row reflects success.
      const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
      expect(finalUpdate).toMatchObject({
        where: { id: "deploy-bl088" },
        data: {
          emailStatus: "complete",
          leadCount: 3,
          emailError: null,
        },
      });
    },
  );

  // -------------------------------------------------------------------------
  // (2) Pre-existing leads in EB workspace — canary regression scenario
  // -------------------------------------------------------------------------
  it(
    "(2) regression: leads pre-existing in EB workspace return 200 with " +
      "the existing IDs (NOT 422) — the BL-088 canary blocker scenario",
    async () => {
      // This is the exact Run G failure mode. With per-lead createLead the
      // POST returned 422 'email already taken' on the first existing email.
      // With BL-088's batch upsert + existing_lead_behavior:'patch', EB
      // returns 200 with the pre-existing lead IDs alongside any new ones.
      prismaMock.targetListPerson.findMany.mockResolvedValue([
        fakeEntry({ email: "existing@acme.com", firstName: "Pre" }),
        fakeEntry({ email: "alsoexisting@acme.com", firstName: "Also" }),
        fakeEntry({ email: "freshlead@acme.com", firstName: "Fresh" }),
      ]);
      // Simulated EB response: existing leads return their ORIGINAL IDs
      // from the prior canary run, the new email gets a fresh ID.
      ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
        { id: 4001, email: "existing@acme.com", status: "active" }, // from Run F
        { id: 4002, email: "alsoexisting@acme.com", status: "active" }, // from Run F
        { id: 8500, email: "freshlead@acme.com", status: "active" }, // new
      ]);

      await adapter.deploy(DEPLOY_PARAMS);

      // No throw. No 422. Single batch call.
      expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(1);

      // All 3 IDs land on attachLeadsToCampaign (mix of existing + new).
      expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledWith(
        9999,
        [4001, 4002, 8500],
      );

      // Deploy completes cleanly.
      const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
      expect(finalUpdate?.data?.emailStatus).toBe("complete");
      expect(finalUpdate?.data?.leadCount).toBe(3);
    },
  );

  // -------------------------------------------------------------------------
  // (3) WebhookEvent EMAIL_SENT dedup applies BEFORE batch is built
  // -------------------------------------------------------------------------
  it(
    "(3) leads with prior EMAIL_SENT webhook event are excluded from the " +
      "batch payload (pre-batch filter)",
    async () => {
      prismaMock.targetListPerson.findMany.mockResolvedValue([
        fakeEntry({ email: "fresh@acme.com", firstName: "Fresh" }),
        fakeEntry({ email: "alreadydone@acme.com", firstName: "Done" }),
        fakeEntry({ email: "anotherFresh@acme.com", firstName: "Another" }),
      ]);

      // Per-call dedup: only "alreadydone@acme.com" returns a hit.
      prismaMock.webhookEvent.findFirst.mockImplementation(
        async (args: { where: { leadEmail: string } }) => {
          if (args.where.leadEmail === "alreadydone@acme.com") {
            return { id: "ev-prev" };
          }
          return null;
        },
      );

      ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
        { id: 6001, email: "fresh@acme.com", status: "active" },
        { id: 6002, email: "anotherFresh@acme.com", status: "active" },
      ]);

      await adapter.deploy(DEPLOY_PARAMS);

      // Batch contains exactly the 2 eligible leads — the already-deployed
      // one is filtered BEFORE the batch is built (preserves the prior
      // per-lead WebhookEvent dedup semantics).
      expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledTimes(1);
      const batchArg =
        ebMock.createOrUpdateLeadsMultiple.mock.calls[0][0];
      expect(batchArg).toHaveLength(2);
      expect(batchArg[0].email).toBe("fresh@acme.com");
      expect(batchArg[1].email).toBe("anotherFresh@acme.com");
      expect(
        batchArg.some(
          (l: { email: string }) => l.email === "alreadydone@acme.com",
        ),
      ).toBe(false);

      // Both eligible IDs reach attachLeadsToCampaign.
      expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledWith(
        9999,
        [6001, 6002],
      );
    },
  );

  // -------------------------------------------------------------------------
  // (4) Lead with null email is filtered out
  // -------------------------------------------------------------------------
  it(
    "(4) leads with null email are filtered out of the batch (cannot " +
      "deploy to EmailBison without an address)",
    async () => {
      prismaMock.targetListPerson.findMany.mockResolvedValue([
        fakeEntry({ email: "good@acme.com", firstName: "Good" }),
        fakeEntry({ email: null, firstName: "NoEmail" }),
        fakeEntry({ email: "alsogood@acme.com", firstName: "AlsoGood" }),
      ]);
      ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
        { id: 7001, email: "good@acme.com", status: "active" },
        { id: 7002, email: "alsogood@acme.com", status: "active" },
      ]);

      await adapter.deploy(DEPLOY_PARAMS);

      const batchArg =
        ebMock.createOrUpdateLeadsMultiple.mock.calls[0][0];
      expect(batchArg).toHaveLength(2);
      // No null-email entry leaks onto the wire.
      for (const entry of batchArg) {
        expect(entry.email).toBeTruthy();
        expect(typeof entry.email).toBe("string");
      }
    },
  );

  // -------------------------------------------------------------------------
  // (5) All leads filtered → upsert is never called, zero-leads exit fires
  // -------------------------------------------------------------------------
  it(
    "(5) all leads filtered (null email + already deployed) → upsert NOT " +
      "called; deploy short-circuits via existing zero-leads early exit",
    async () => {
      prismaMock.targetListPerson.findMany.mockResolvedValue([
        fakeEntry({ email: null, firstName: "NoEmail" }),
        fakeEntry({ email: "done@acme.com", firstName: "Done" }),
      ]);

      // The non-null-email lead has been deployed already.
      prismaMock.webhookEvent.findFirst.mockResolvedValue({ id: "ev-prev" });

      await adapter.deploy(DEPLOY_PARAMS);

      // Critical: zero eligible leads → no upsert call. Preserves the
      // empty-batch short-circuit on the client (no wasted POST).
      expect(ebMock.createOrUpdateLeadsMultiple).not.toHaveBeenCalled();
      expect(ebMock.attachLeadsToCampaign).not.toHaveBeenCalled();
      expect(ebMock.resumeCampaign).not.toHaveBeenCalled();

      // Deploy row reflects the no-leads-to-deploy explanatory status.
      const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
      expect(finalUpdate?.data).toMatchObject({
        emailStatus: "complete",
        leadCount: 0,
        emailError: "no_leads_to_deploy",
      });
    },
  );

  it("fails closed with a MissingRequiredLeadFieldError when lastName is missing by default", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakeEntry({
        id: "person_missing_lastname",
        email: "missing@acme.com",
        firstName: "Missing",
        lastName: null,
      }),
    ]);

    await expect(adapter.deploy(DEPLOY_PARAMS)).rejects.toMatchObject({
      name: "MissingRequiredLeadFieldError",
      personIds: ["person_missing_lastname"],
      emails: ["missing@acme.com"],
    } satisfies Partial<MissingRequiredLeadFieldError>);

    expect(ebMock.createOrUpdateLeadsMultiple).not.toHaveBeenCalled();
    const lastUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate?.data.emailStatus).toBe("failed");
    expect(String(lastUpdate?.data.emailError)).toMatch(/Missing required lead field lastName/);
  });

  it("uses an empty-string fallback and warns when allowMissingLastName=true", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      fakeEntry({ email: "missing@acme.com", firstName: "Missing", lastName: null }),
    ]);
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValue([
      { id: 9001, email: "missing@acme.com", status: "active" },
    ]);

    await adapter.deploy({
      ...DEPLOY_PARAMS,
      allowMissingLastName: true,
    });

    expect(ebMock.createOrUpdateLeadsMultiple).toHaveBeenCalledWith([
      {
        email: "missing@acme.com",
        firstName: "Missing",
        lastName: "",
        jobTitle: undefined,
        company: undefined,
        customVariables: undefined,
      },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/allowMissingLastName=true/),
    );
  });
});
