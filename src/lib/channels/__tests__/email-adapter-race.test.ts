/**
 * BL-070 concurrent-deploy race — P2002 catch test.
 *
 * Scenario: two deploys for the same Campaign both take the fresh-deploy
 * branch in Step 1 (each calls createCampaign on EB, each gets its own EB
 * campaign ID). The winner writes its EB ID to Campaign.emailBisonCampaignId
 * first; the loser then tries to write a different ID and Prisma raises
 * P2002 because Campaign.emailBisonCampaignId is now @unique.
 *
 * The loser must:
 *   1. Re-read Campaign.emailBisonCampaignId to learn the winning ID
 *   2. Call ebClient.deleteCampaign on its own (orphan) EB campaign
 *   3. Switch ebCampaignId to the winner
 *   4. Persist the winning ID on its CampaignDeploy row
 *   5. Continue the rest of the deploy flow against the winner
 *
 * Sibling mock style mirrors linkedin-adapter.test.ts / email-adapter-deploy
 * (Phase 4 untracked file) — vi.hoisted + class stub for EmailBisonClient,
 * pass-through withRetry so the test doesn't burn real retry sleep.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

const { ebMock, getCampaignMock, prismaMock } = vi.hoisted(() => ({
  ebMock: {
    createCampaign: vi.fn(),
    getCampaign: vi.fn(),
    deleteCampaign: vi.fn(),
    getSequenceSteps: vi.fn(),
    createSequenceStep: vi.fn(),
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

const DEPLOY_PARAMS = {
  deployId: "deploy-loser",
  campaignId: "camp-race",
  campaignName: "Race Campaign",
  workspaceSlug: "acme",
  channels: ["email"],
};

describe("EmailAdapter.deploy() — BL-070 concurrent-deploy race guard", () => {
  let adapter: EmailAdapter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new EmailAdapter();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Workspace token resolver.
    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
      apiToken: "ws-token",
    });

    // Fresh-deploy campaign — emailBisonCampaignId is null on entry, so Step 1
    // will take the createCampaign branch (the only branch that can race).
    getCampaignMock.mockResolvedValue({
      id: "camp-race",
      targetListId: "tl-1",
      emailBisonCampaignId: null,
      emailSequence: [
        { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
      ],
    });

    // Step 1 — we (the loser) create orphan EB campaign 777.
    ebMock.createCampaign.mockResolvedValue({ id: 777, uuid: "uuid-777" });

    // Step 2 — the loser's Campaign.update hits the unique constraint.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`emailBisonCampaignId`)",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["emailBisonCampaignId"] },
      },
    );
    prismaMock.campaign.update.mockRejectedValue(p2002);

    // Re-read after P2002 returns the WINNING EB campaign ID (555 — the other
    // deploy's createCampaign result).
    prismaMock.campaign.findUnique.mockResolvedValue({
      emailBisonCampaignId: 555,
    });

    // Orphan cleanup — EB accepts the delete.
    ebMock.deleteCampaign.mockResolvedValue(undefined);

    // CampaignDeploy write-back succeeds with winner.
    prismaMock.campaignDeploy.update.mockResolvedValue({});

    // Remainder of the flow — mock just enough to run to success.
    ebMock.getSequenceSteps.mockResolvedValue([]);
    ebMock.createSequenceStep.mockResolvedValue({ id: 1 });
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
    ebMock.createSchedule.mockResolvedValue({});
    ebMock.getSchedule.mockResolvedValue(null);
    prismaMock.sender.findMany.mockResolvedValue([
      { emailBisonSenderId: 501 },
    ]);
    ebMock.attachSenderEmails.mockResolvedValue(undefined);
    ebMock.updateCampaign.mockResolvedValue({});
    ebMock.resumeCampaign.mockResolvedValue({});
    ebMock.getCampaign.mockResolvedValue({ id: 555, status: "active" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "catches P2002 on Campaign.update, deletes the orphan EB campaign, " +
      "and completes the deploy against the winning EB campaign ID",
    async () => {
      await adapter.deploy(DEPLOY_PARAMS);

      // Step 1 — we called createCampaign and it gave us 777 (the orphan).
      expect(ebMock.createCampaign).toHaveBeenCalledTimes(1);
      expect(ebMock.createCampaign).toHaveBeenCalledWith({
        name: "Race Campaign",
      });

      // Step 2 — we tried to write 777 to Campaign.emailBisonCampaignId.
      expect(prismaMock.campaign.update).toHaveBeenCalledWith({
        where: { id: "camp-race" },
        data: { emailBisonCampaignId: 777 },
      });

      // After P2002 — we re-read Campaign to discover the winner.
      expect(prismaMock.campaign.findUnique).toHaveBeenCalledWith({
        where: { id: "camp-race" },
        select: { emailBisonCampaignId: true },
      });

      // Orphan cleanup — deleteCampaign called on our losing EB ID (777),
      // NOT on the winner (555).
      expect(ebMock.deleteCampaign).toHaveBeenCalledTimes(1);
      expect(ebMock.deleteCampaign).toHaveBeenCalledWith(777);

      // CampaignDeploy row gets the WINNING ID (555).
      const deployUpdates = prismaMock.campaignDeploy.update.mock.calls.map(
        (c) => c[0],
      );
      const persistCall = deployUpdates.find(
        (u) =>
          u.where?.id === "deploy-loser" &&
          u.data?.emailBisonCampaignId !== undefined,
      );
      expect(persistCall).toBeDefined();
      expect(persistCall!.data.emailBisonCampaignId).toBe(555);

      // Rest of the flow ran against the WINNER — resumeCampaign fires with 555.
      expect(ebMock.resumeCampaign).toHaveBeenCalledWith(555);
      expect(ebMock.getCampaign).toHaveBeenCalledWith(555);

      // Final status row — success.
      const finalUpdate = deployUpdates.at(-1);
      expect(finalUpdate).toMatchObject({
        where: { id: "deploy-loser" },
        data: { emailStatus: "complete" },
      });

      // Warning log surfaced the race so operators see it in logs.
      expect(warnSpy).toHaveBeenCalled();
      const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(warned).toMatch(/BL-070/);
      expect(warned).toMatch(/777/);
      expect(warned).toMatch(/555/);
    },
  );
});

// ===========================================================================
// Phase 4 F3 — true Promise.all concurrent-deploy race
//
// The test above simulates a race deterministically: the loser sees a canned
// P2002 on update(). That verifies the recovery logic, but not that two real
// concurrent invocations of adapter.deploy() interleave correctly.
//
// This test spins up TWO deploy calls under Promise.all and uses an
// orchestrated prisma.campaign.update stub that mirrors the real UNIQUE
// constraint semantics: the FIRST caller wins and persists its ID; the
// SECOND caller's update rejects with P2002. The subsequent findUnique
// returns the winner's ID so the loser can re-read.
//
// Assertions:
//   - Exactly ONE EB campaign create succeeds on the happy path — the other
//     also creates (we can't prevent that without cross-process coordination,
//     which is exactly the point of the P2002 guard: let both create, have
//     one lose at the DB barrier, clean up the orphan).
//   - Exactly ONE orphan delete call on EB (the loser's rollback).
//   - Campaign.emailBisonCampaignId ends at the winner's ID.
//   - Both CampaignDeploy rows reference the winner's EB ID after recovery.
//   - No unique-constraint violation escapes — both deploys resolve cleanly.
// ===========================================================================

describe("EmailAdapter.deploy() — BL-070 true Promise.all concurrency", () => {
  let adapter: EmailAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new EmailAdapter();
    // Silence expected BL-070 warns without asserting them — the first
    // describe block already covers warn-content invariants.
    vi.spyOn(console, "warn").mockImplementation(() => {});

    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
      apiToken: "ws-token",
    });
    getCampaignMock.mockResolvedValue({
      id: "camp-race-concurrent",
      targetListId: "tl-1",
      emailBisonCampaignId: null,
      emailSequence: [
        { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
      ],
    });

    // Minimal happy-path stubs for the remainder of the flow.
    ebMock.getSequenceSteps.mockResolvedValue([]);
    ebMock.createSequenceStep.mockResolvedValue({ id: 1 });
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
    ebMock.createSchedule.mockResolvedValue({});
    ebMock.getSchedule.mockResolvedValue(null);
    prismaMock.sender.findMany.mockResolvedValue([{ emailBisonSenderId: 501 }]);
    ebMock.attachSenderEmails.mockResolvedValue(undefined);
    ebMock.updateCampaign.mockResolvedValue({});
    ebMock.resumeCampaign.mockResolvedValue({});
    ebMock.deleteCampaign.mockResolvedValue(undefined);
    prismaMock.campaignDeploy.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("two concurrent deploys resolve cleanly — loser P2002s, deletes orphan, both end on winner", async () => {
    // Each createCampaign call yields a distinct EB ID — caller A gets 1000,
    // caller B gets 2000.
    const createdEbIds: number[] = [];
    let nextEbId = 1000;
    ebMock.createCampaign.mockImplementation(async () => {
      const id = nextEbId;
      nextEbId += 1000;
      createdEbIds.push(id);
      return { id, uuid: `uuid-${id}` };
    });

    // prisma.campaign.update simulates the UNIQUE constraint: whoever
    // updates FIRST wins; anyone else gets P2002. We track the winner by
    // latching `winningEbId` and rejecting any subsequent attempt.
    let winningEbId: number | null = null;
    prismaMock.campaign.update.mockImplementation(
      async (args: { where: unknown; data: { emailBisonCampaignId: number } }) => {
        if (winningEbId == null) {
          winningEbId = args.data.emailBisonCampaignId;
          return { id: "camp-race-concurrent", emailBisonCampaignId: winningEbId };
        }
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on the fields: (`emailBisonCampaignId`)",
          {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["emailBisonCampaignId"] },
          },
        );
      },
    );

    // After the loser hits P2002 and re-reads Campaign, return the winner.
    prismaMock.campaign.findUnique.mockImplementation(async () => ({
      emailBisonCampaignId: winningEbId,
    }));

    // Step 10 verify returns the winner's ID as active. Since both deploys
    // converge on winningEbId post-recovery, this is safe to stub once.
    ebMock.getCampaign.mockImplementation(async () => ({
      id: winningEbId ?? 0,
      status: "active",
    }));

    // Drive two deploys concurrently against the SAME campaignId.
    await Promise.all([
      adapter.deploy({
        deployId: "deploy-A",
        campaignId: "camp-race-concurrent",
        campaignName: "Race Campaign",
        workspaceSlug: "acme",
        channels: ["email"],
      }),
      adapter.deploy({
        deployId: "deploy-B",
        campaignId: "camp-race-concurrent",
        campaignName: "Race Campaign",
        workspaceSlug: "acme",
        channels: ["email"],
      }),
    ]);

    // Both deploys called createCampaign (we cannot prevent that without
    // cross-process coordination — the UNIQUE constraint is the barrier).
    expect(ebMock.createCampaign).toHaveBeenCalledTimes(2);
    expect(createdEbIds).toHaveLength(2);

    // Exactly ONE winner was latched at the DB.
    expect(winningEbId).not.toBeNull();
    const loserEbId = createdEbIds.find((id) => id !== winningEbId);
    expect(loserEbId).toBeDefined();

    // Exactly ONE orphan delete on EB — the loser's rollback.
    expect(ebMock.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(ebMock.deleteCampaign).toHaveBeenCalledWith(loserEbId);

    // Both CampaignDeploy rows ended on the winner's EB ID.
    const deployUpdates = prismaMock.campaignDeploy.update.mock.calls.map(
      (c) => c[0],
    );
    const persistCalls = deployUpdates.filter(
      (u) => u.data?.emailBisonCampaignId != null,
    );
    // One persist call per deploy that reached Step 2 — both should land on the winner.
    expect(persistCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of persistCalls) {
      expect(call.data.emailBisonCampaignId).toBe(winningEbId);
    }

    // Rest of the flow fired against the WINNER for both callers.
    const resumeCalls = ebMock.resumeCampaign.mock.calls.map((c) => c[0]);
    for (const id of resumeCalls) {
      expect(id).toBe(winningEbId);
    }

    // Final status rows — both deploys end complete.
    const finalA = deployUpdates
      .filter((u) => u.where?.id === "deploy-A")
      .at(-1);
    const finalB = deployUpdates
      .filter((u) => u.where?.id === "deploy-B")
      .at(-1);
    expect(finalA).toMatchObject({ data: { emailStatus: "complete" } });
    expect(finalB).toMatchObject({ data: { emailStatus: "complete" } });
  });
});

// ===========================================================================
// Phase 4 F4 — defensive branch coverage for the P2002 catch
//
// Three branches the happy-path race test does NOT exercise:
//   (i)   Orphan EB delete fails → falls back to WARN + BL-072 path (no throw)
//   (ii)  Re-read returns null emailBisonCampaignId after P2002 → throws
//         "Refusing to proceed" via [step:2]
//   (iii) P2002 raised from the REUSE path (preExistingEbId != null) → the
//         P2002 guard's `preExistingEbId == null` condition is false, so the
//         catch rethrows unmodified. This is correct: reuse-branch P2002
//         means the schema invariant is broken in a way the race guard
//         cannot safely recover from.
// ===========================================================================

describe("EmailAdapter.deploy() — BL-070 defensive P2002 branches", () => {
  let adapter: EmailAdapter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new EmailAdapter();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
      apiToken: "ws-token",
    });

    // Fresh-deploy default — each test overrides as needed.
    getCampaignMock.mockResolvedValue({
      id: "camp-defensive",
      targetListId: "tl-1",
      emailBisonCampaignId: null,
      emailSequence: [
        { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
      ],
    });
    ebMock.createCampaign.mockResolvedValue({ id: 777, uuid: "uuid-777" });

    // Happy-path stubs for later steps (used when a test runs the full flow).
    ebMock.getSequenceSteps.mockResolvedValue([]);
    ebMock.createSequenceStep.mockResolvedValue({ id: 1 });
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
    ebMock.createSchedule.mockResolvedValue({});
    ebMock.getSchedule.mockResolvedValue(null);
    prismaMock.sender.findMany.mockResolvedValue([{ emailBisonSenderId: 501 }]);
    ebMock.attachSenderEmails.mockResolvedValue(undefined);
    ebMock.updateCampaign.mockResolvedValue({});
    ebMock.resumeCampaign.mockResolvedValue({});
    ebMock.getCampaign.mockResolvedValue({ id: 555, status: "active" });
    prismaMock.campaignDeploy.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // (i) — Orphan delete fails during P2002 recovery. Deploy MUST continue
  // (so the winner's pipeline still launches) and MUST emit the BL-072
  // warning identifying the orphan for manual cleanup.
  it("(i) orphan EB delete fails → logs BL-072 warning, continues with winner, no throw", async () => {
    // Standard P2002 on loser's update.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`emailBisonCampaignId`)",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["emailBisonCampaignId"] },
      },
    );
    prismaMock.campaign.update.mockRejectedValue(p2002);
    prismaMock.campaign.findUnique.mockResolvedValue({
      emailBisonCampaignId: 555,
    });
    // EB delete blows up — deploy must NOT rethrow.
    ebMock.deleteCampaign.mockRejectedValue(
      new Error("EB DELETE /campaigns/777 returned 500 Internal Server Error"),
    );

    await expect(
      adapter.deploy({
        deployId: "deploy-loser",
        campaignId: "camp-defensive",
        campaignName: "Race Campaign",
        workspaceSlug: "acme",
        channels: ["email"],
      }),
    ).resolves.toBeUndefined();

    // Deploy continued against the winner, resume fired with 555.
    expect(ebMock.resumeCampaign).toHaveBeenCalledWith(555);

    // BL-072 warning surfaced with the orphan ID + workspace hint.
    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(warned).toMatch(/BL-072/);
    expect(warned).toMatch(/ORPHAN CLEANUP FAILED/);
    expect(warned).toMatch(/777/);
    expect(warned).toMatch(/acme/);
  });

  // (ii) — Re-read after P2002 returns null emailBisonCampaignId. Adapter
  // refuses to proceed with an unknown winner; throws via [step:2].
  it("(ii) re-read returns null after P2002 → throws 'Refusing to proceed', no delete, marked failed", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`emailBisonCampaignId`)",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["emailBisonCampaignId"] },
      },
    );
    prismaMock.campaign.update.mockRejectedValue(p2002);
    // Defensive: re-read somehow returns null (shouldn't happen but guard
    // against it).
    prismaMock.campaign.findUnique.mockResolvedValue({
      emailBisonCampaignId: null,
    });

    await expect(
      adapter.deploy({
        deployId: "deploy-loser",
        campaignId: "camp-defensive",
        campaignName: "Race Campaign",
        workspaceSlug: "acme",
        channels: ["email"],
      }),
    ).rejects.toThrow(/Refusing to proceed/);

    // No orphan delete — we can't safely clean up without knowing the winner.
    expect(ebMock.deleteCampaign).not.toHaveBeenCalled();
    // Never reached resume — bailed at Step 2.
    expect(ebMock.resumeCampaign).not.toHaveBeenCalled();

    // CampaignDeploy marked failed with [step:2] prefix.
    const deployUpdates = prismaMock.campaignDeploy.update.mock.calls.map(
      (c) => c[0],
    );
    const finalUpdate = deployUpdates.at(-1);
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-loser" },
      data: { emailStatus: "failed" },
    });
    expect(finalUpdate.data.emailError).toMatch(/\[step:2\]/);
    expect(finalUpdate.data.emailError).toMatch(/Refusing to proceed/);
  });

  // (iii) — P2002 raised from the REUSE path (preExistingEbId != null). The
  // guard is keyed on `preExistingEbId == null`, so reuse-branch P2002 falls
  // through to the `else { throw err; }` branch. This is intentional: a reuse
  // path hitting P2002 means the DB state is inconsistent in a way the race
  // guard cannot safely recover from (e.g. two different Campaigns pointing
  // at the same EB ID — which would be a schema-corruption bug, not a race).
  it("(iii) P2002 from REUSE path → rethrows unmodified, no orphan delete, no winner switchover", async () => {
    // Simulate an idempotent re-run — preExistingEbId = 555 so Step 1 takes
    // the getCampaign-verify branch.
    getCampaignMock.mockResolvedValue({
      id: "camp-defensive",
      targetListId: "tl-1",
      emailBisonCampaignId: 555,
      emailSequence: [
        { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
      ],
    });
    // EB confirms the campaign still exists — reuse branch proceeds.
    ebMock.getCampaign.mockResolvedValueOnce({ id: 555, status: "draft" });

    // Step 2's no-op write-back somehow raises P2002 (DB corruption
    // scenario — a DIFFERENT Campaign row already holds 555 via the unique
    // constraint). Guard must NOT enter race recovery.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`emailBisonCampaignId`)",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["emailBisonCampaignId"] },
      },
    );
    prismaMock.campaign.update.mockRejectedValue(p2002);

    await expect(
      adapter.deploy({
        deployId: "deploy-reuse",
        campaignId: "camp-defensive",
        campaignName: "Reuse Campaign",
        workspaceSlug: "acme",
        channels: ["email"],
      }),
    ).rejects.toThrow(/Unique constraint failed/);

    // Guard did NOT re-read (reuse-path P2002 falls through `else`).
    expect(prismaMock.campaign.findUnique).not.toHaveBeenCalled();
    // No orphan delete — there is no orphan (reuse path doesn't create).
    expect(ebMock.deleteCampaign).not.toHaveBeenCalled();
    // Never reached resume — bailed at Step 2.
    expect(ebMock.resumeCampaign).not.toHaveBeenCalled();

    // CampaignDeploy marked failed with [step:2].
    const deployUpdates = prismaMock.campaignDeploy.update.mock.calls.map(
      (c) => c[0],
    );
    const finalUpdate = deployUpdates.at(-1);
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-reuse" },
      data: { emailStatus: "failed" },
    });
    expect(finalUpdate.data.emailError).toMatch(/\[step:2\]/);
  });
});
