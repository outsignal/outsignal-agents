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
