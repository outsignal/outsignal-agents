/**
 * BL-068 LinkedIn deploy — shape-drift guard tests.
 *
 * Verifies that LinkedInAdapter.deploy() correctly resolves a step's position
 * from either `position` or `stepNumber`, falling back to the loop index when
 * neither is present, and that the Zod adapter-boundary guard throws loudly
 * on unparseable shapes.
 *
 * Root cause recap: the writer/portal paths historically save LinkedIn steps
 * with `stepNumber` while the rule builder read `step.position`, producing
 * `position: undefined` and failing prisma.campaignSequenceRule.createMany()
 * atomically. The prior `as LinkedInSequenceStep[]` cast hid the drift; NaN
 * sort swallowed the undefined; the error only surfaced at the Prisma insert.
 *
 * Cases (6):
 *   (a) Happy path — step with `position` key parses, rule built correctly
 *   (b) BL-068 shape — step with `stepNumber` only, rule built with correct position
 *   (c) Missing both — Zod refine rejects with BL-068 error message
 *   (d) Mixed sequence — some steps have position, some stepNumber
 *   (e) Fallback to idx+1 — secondary defensive read in sequencing.ts
 *   (f) Regression fixture — real JSON captured from stuck 1210 campaign
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — prisma + campaign operations + sequencing
// ---------------------------------------------------------------------------

const {
  prismaMock,
  getCampaignMock,
  createSequenceRulesForCampaignMock,
} = vi.hoisted(() => ({
  prismaMock: {
    campaignDeploy: { update: vi.fn() },
    targetListPerson: { count: vi.fn() },
    campaign: { findFirst: vi.fn() },
    campaignSequenceRule: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
  getCampaignMock: vi.fn(),
  createSequenceRulesForCampaignMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
}));

vi.mock("@/lib/linkedin/sequencing", () => ({
  createSequenceRulesForCampaign: (...args: unknown[]) =>
    createSequenceRulesForCampaignMock(...args),
}));

import { LinkedInAdapter } from "@/lib/channels/linkedin-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEPLOY_PARAMS = {
  deployId: "deploy-1",
  campaignId: "camp-1",
  campaignName: "Acme LI",
  workspaceSlug: "acme",
  channels: ["linkedin"],
};

function stubCampaign(linkedinSequence: unknown) {
  getCampaignMock.mockResolvedValue({
    id: "camp-1",
    name: "Acme LI",
    targetListId: "tl-1",
    linkedinSequence,
  });
}

/** Returns the linkedinSequence array passed to createSequenceRulesForCampaign. */
function lastRuleBuilderCall(): Array<{
  position?: number;
  stepNumber?: number;
  type?: string;
  body?: string;
  delayHours?: number;
  triggerEvent?: string;
}> {
  const calls = createSequenceRulesForCampaignMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const lastCall = calls.at(-1);
  return (lastCall?.[0]?.linkedinSequence ?? []) as Array<{
    position?: number;
    stepNumber?: number;
    type?: string;
    body?: string;
    delayHours?: number;
    triggerEvent?: string;
  }>;
}

describe("LinkedInAdapter.deploy() — BL-068 shape-drift guard", () => {
  let adapter: LinkedInAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LinkedInAdapter();

    prismaMock.campaignDeploy.update.mockResolvedValue({});
    prismaMock.targetListPerson.count.mockResolvedValue(10);
    createSequenceRulesForCampaignMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (a) Happy path — `position` key
  // -------------------------------------------------------------------------
  it("(a) happy path: step with `position` key produces rule rows with that position", async () => {
    stubCampaign([
      { position: 1, type: "connection_request", body: "" },
      { position: 2, type: "message", body: "follow up", delayDays: 3 },
      { position: 3, type: "message", body: "second follow up", delayDays: 7 },
    ]);

    await adapter.deploy(DEPLOY_PARAMS);

    const rules = lastRuleBuilderCall();
    // Only post-connect rules land here (positions 2 and 3).
    expect(rules).toHaveLength(2);
    expect(rules[0].position).toBe(2);
    expect(rules[1].position).toBe(3);
    expect(rules.every((r) => typeof r.position === "number" && r.position > 0)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (b) BL-068 shape — `stepNumber` only
  // -------------------------------------------------------------------------
  it("(b) BL-068 shape: step with `stepNumber` (no `position`) produces rule rows with correct position", async () => {
    stubCampaign([
      { stepNumber: 1, type: "connection_request", body: "" },
      { stepNumber: 2, type: "message", body: "follow up", delayDays: 3 },
      { stepNumber: 3, type: "message", body: "second follow up", delayDays: 7 },
    ]);

    await adapter.deploy(DEPLOY_PARAMS);

    const rules = lastRuleBuilderCall();
    expect(rules).toHaveLength(2);
    expect(rules[0].position).toBe(2);
    expect(rules[1].position).toBe(3);
    // Ensure no undefined positions leak through — the BL-068 bug.
    expect(rules.every((r) => r.position !== undefined)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (c) Missing both — Zod throws
  // -------------------------------------------------------------------------
  it("(c) missing both keys: Zod parse throws with BL-068 error message", async () => {
    stubCampaign([
      { type: "connection_request", body: "" }, // no position, no stepNumber
      { type: "message", body: "follow up", delayDays: 3 },
    ]);

    await expect(adapter.deploy(DEPLOY_PARAMS)).rejects.toThrow(/BL-068/);

    // Deploy should mark linkedinStatus failed after the throw is caught.
    const lastUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(lastUpdate).toMatchObject({
      where: { id: "deploy-1" },
      data: { linkedinStatus: "failed" },
    });
    // Rule builder must NOT have been invoked.
    expect(createSequenceRulesForCampaignMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (d) Mixed sequence
  // -------------------------------------------------------------------------
  it("(d) mixed sequence: some steps have position, some stepNumber — all resolve correctly", async () => {
    stubCampaign([
      { position: 1, type: "connection_request", body: "" },
      { stepNumber: 2, type: "message", body: "follow up 1", delayDays: 3 },
      { position: 3, type: "message", body: "follow up 2", delayDays: 7 },
    ]);

    await adapter.deploy(DEPLOY_PARAMS);

    const rules = lastRuleBuilderCall();
    expect(rules).toHaveLength(2);
    expect(rules[0].position).toBe(2);
    expect(rules[0].body).toBe("follow up 1");
    expect(rules[1].position).toBe(3);
    expect(rules[1].body).toBe("follow up 2");
  });

  // -------------------------------------------------------------------------
  // (e) Fallback to idx+1 (secondary defensive read in sequencing.ts)
  // -------------------------------------------------------------------------
  it("(e) fallback to idx+1: createSequenceRulesForCampaign resolves position from stepNumber + index", async () => {
    // Test the sequencing.ts defensive read directly — feed it a sequence
    // where steps lack `position` (stepNumber only) and verify the resolved
    // positions propagate into prisma.createMany's data array.
    // This exercises Fix #3 (sequencing.ts:~387).
    vi.doUnmock("@/lib/linkedin/sequencing");
    vi.resetModules();

    // Re-mock prisma inside the isolated module context
    vi.doMock("@/lib/db", () => ({
      prisma: {
        campaignSequenceRule: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    }));

    const seqModule = await import("@/lib/linkedin/sequencing");
    const dbModule = await import("@/lib/db");

    await seqModule.createSequenceRulesForCampaign({
      workspaceSlug: "acme",
      campaignName: "Acme LI",
      linkedinSequence: [
        // Simulate a caller that built rules without `position` AND without
        // `stepNumber`. The secondary defensive read falls back to idx + 1.
        { type: "message", body: "m1" } as never,
        { type: "message", body: "m2" } as never,
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createManyCalls = (dbModule.prisma as any).campaignSequenceRule
      .createMany.mock.calls;
    expect(createManyCalls.length).toBe(1);
    const dataArg = createManyCalls[0][0].data;
    expect(dataArg).toHaveLength(2);
    expect(dataArg[0].position).toBe(1);
    expect(dataArg[1].position).toBe(2);
    // Critical BL-068 invariant: no undefined positions reach Prisma.
    expect(dataArg.every((d: { position: number }) => d.position !== undefined)).toBe(
      true,
    );

    // Restore module state for subsequent tests
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // (f) Regression fixture — REAL JSON from stuck 1210 campaign
  // -------------------------------------------------------------------------
  //
  // Verbatim shape captured on 2026-04-15 via controlled SELECT on
  // Campaign.id='cmneqa5r50003p8rk322w3vc6' (1210 Solutions - LinkedIn -
  // Industrial/Warehouse - April 2026). NOT synthetic — this is the exact
  // JSON that caused the BL-068 production failure. Keys: stepNumber,
  // channel, type ('connection_request' / 'message'), subject, subjectB,
  // body, delayDays, notes.
  //
  // Pre-fix: the `as LinkedInSequenceStep[]` cast silently produced
  // `position: undefined` and prisma.campaignSequenceRule.createMany()
  // threw "Argument `position` is missing". This fixture verifies the
  // regression does not recur.
  it("(f) regression fixture: real stuck 1210 JSON builds rules with correct positions", async () => {
    const realStuck1210Sequence = [
      {
        stepNumber: 1,
        channel: "linkedin",
        type: "connection_request",
        subject: null,
        subjectB: null,
        body: "",
        delayDays: 0,
        notes: null,
      },
      {
        stepNumber: 2,
        channel: "linkedin",
        type: "message",
        subject: null,
        subjectB: null,
        body: "Thanks for connecting. I work with recruitment agencies that supply warehouse and logistics staff.\n\nOne thing that keeps coming up is the payroll side. Weekly runs for 100+ operatives, shift-based pay, and worker queries flooding the ops team every Monday.\n\nWe take all of that off the table. Thought it might be relevant given your focus on the industrial sector. Happy to share more if useful.",
        delayDays: 3,
        notes: "Industrial-specific payroll pain",
      },
      {
        stepNumber: 3,
        channel: "linkedin",
        type: "message",
        subject: null,
        subjectB: null,
        body: "Most agencies we work with in the warehouse space say the biggest barrier to taking on new contracts is the admin that comes with it. More operatives means more payroll, more P45s, more HMRC headaches.\n\nWe handle all of that so agencies can scale without hiring more back-office staff. If that sounds relevant, happy to have a quick chat.",
        delayDays: 7,
        notes: "Scaling without admin burden",
      },
    ];

    stubCampaign(realStuck1210Sequence);

    await adapter.deploy(DEPLOY_PARAMS);

    const rules = lastRuleBuilderCall();
    // Only post-connect rules (positions 2, 3) — step 1 is the connect itself.
    expect(rules).toHaveLength(2);
    expect(rules[0].position).toBe(2);
    expect(rules[0].type).toBe("message");
    expect(rules[0].body).toContain("Thanks for connecting");
    expect(rules[0].delayHours).toBe(3 * 24); // delayDays:3 → 72h
    expect(rules[0].triggerEvent).toBe("connection_accepted");

    expect(rules[1].position).toBe(3);
    expect(rules[1].type).toBe("message");
    expect(rules[1].body).toContain("Most agencies we work with");
    expect(rules[1].delayHours).toBe(7 * 24); // delayDays:7 → 168h

    // Deploy must report complete (not failed) — the primary BL-068 regression check.
    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-1" },
      data: { linkedinStatus: "complete" },
    });
  });
});
