import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const campaignFindUnique = vi.fn();
  const workspaceFindUnique = vi.fn();
  const getSequenceSteps = vi.fn();

  return {
    campaignFindUnique,
    workspaceFindUnique,
    getSequenceSteps,
  };
});

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    campaign = { findUnique: mocks.campaignFindUnique };
    workspace = { findUnique: mocks.workspaceFindUnique };
  },
}));

vi.mock("@/lib/emailbison/client", () => ({
  EmailBisonClient: class {
    getSequenceSteps = mocks.getSequenceSteps;
  },
}));

import {
  clearStepCache,
  findStepForReplySequence,
  lookupOutboundCopy,
} from "@/lib/outbound-copy-lookup";

describe("findStepForReplySequence", () => {
  beforeEach(() => {
    clearStepCache();
    mocks.campaignFindUnique.mockReset();
    mocks.workspaceFindUnique.mockReset();
    mocks.getSequenceSteps.mockReset();
  });

  it("matches canonical one-based positions exactly", () => {
    const steps = [
      { position: 1, subjectLine: "step 1", body: "body 1" },
      { position: 2, subjectLine: "step 2", body: "body 2" },
      { position: 3, subjectLine: "step 3", body: "body 3" },
    ];

    expect(findStepForReplySequence(steps, 1)).toEqual(steps[0]);
    expect(findStepForReplySequence(steps, 2)).toEqual(steps[1]);
    expect(findStepForReplySequence(steps, 3)).toEqual(steps[2]);
  });

  it("falls back by one for legacy zero-based positions", () => {
    const steps = [
      { position: 0, subjectLine: "step 1", body: "body 1" },
      { position: 1, subjectLine: "step 2", body: "body 2" },
      { position: 2, subjectLine: "step 3", body: "body 3" },
    ];

    expect(findStepForReplySequence(steps, 1)).toEqual(steps[0]);
    expect(findStepForReplySequence(steps, 2)).toEqual(steps[1]);
    expect(findStepForReplySequence(steps, 3)).toEqual(steps[2]);
  });

  it("returns null for non-contiguous positions instead of mis-mapping", () => {
    const steps = [
      { position: 1, subjectLine: "step 1", body: "body 1" },
      { position: 3, subjectLine: "step 3", body: "body 3" },
      { position: 5, subjectLine: "step 5", body: "body 5" },
    ];

    expect(findStepForReplySequence(steps, 2)).toBeNull();
  });

  it("fails closed for out-of-range sequenceStep values in both schemes", () => {
    const oneBased = [
      { position: 1, subjectLine: "step 1", body: "body 1" },
      { position: 2, subjectLine: "step 2", body: "body 2" },
      { position: 3, subjectLine: "step 3", body: "body 3" },
    ];
    const zeroBased = [
      { position: 0, subjectLine: "step 1", body: "body 1" },
      { position: 1, subjectLine: "step 2", body: "body 2" },
      { position: 2, subjectLine: "step 3", body: "body 3" },
    ];

    expect(findStepForReplySequence(oneBased, 4)).toBeNull();
    expect(findStepForReplySequence(zeroBased, 4)).toBeNull();
  });

  it("handles edge cases: sequenceStep=0, null, single-element, and out of range", () => {
    const steps = [{ position: 1, subjectLine: "step 1", body: "body 1" }];

    expect(findStepForReplySequence(steps, 0)).toBeNull();
    expect(findStepForReplySequence(steps, null)).toBeNull();
    expect(findStepForReplySequence(steps, 1)).toEqual(steps[0]);
    expect(findStepForReplySequence(steps, 5)).toBeNull();
  });

  it("uses the shared helper in the EB API slow path", async () => {
    mocks.campaignFindUnique.mockResolvedValue({
      emailSequence: null,
      emailBisonCampaignId: 105,
      workspaceSlug: "lime-recruitment",
    });
    mocks.workspaceFindUnique.mockResolvedValue({ apiToken: "ws-token" });
    mocks.getSequenceSteps.mockResolvedValue([
      { position: 0, subject: "step 1", body: "body 1" },
      { position: 1, subject: "step 2", body: "body 2" },
      { position: 2, subject: "step 3", body: "body 3" },
    ]);

    await expect(lookupOutboundCopy("camp-105", 1)).resolves.toEqual({
      subject: "step 1",
      body: "body 1",
    });
  });
});
