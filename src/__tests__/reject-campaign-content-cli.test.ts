import { beforeEach, describe, expect, it, vi } from "vitest";

const rejectCampaignContentMock = vi.fn();

vi.mock("@/lib/campaigns/operations", () => ({
  rejectCampaignContent: (campaignId: string, feedback: string) =>
    rejectCampaignContentMock(campaignId, feedback),
}));

import {
  DEFAULT_REJECTION_FEEDBACK,
  main,
  parseCliArgs,
  rejectCampaignContentFromCli,
} from "../../scripts/cli/reject-campaign-content";

describe("reject-campaign-content CLI", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    rejectCampaignContentMock.mockReset();
    process.argv = originalArgv;
  });

  it("parses --campaignId with a separate value", () => {
    expect(parseCliArgs(["--campaignId", "camp-123"])).toEqual({
      campaignId: "camp-123",
    });
  });

  it("parses --campaignId=<value>", () => {
    expect(parseCliArgs(["--campaignId=camp-123"])).toEqual({
      campaignId: "camp-123",
    });
  });

  it("rejects missing campaignId", () => {
    expect(() => parseCliArgs([])).toThrow(/Missing required argument/);
    expect(() => parseCliArgs(["--campaignId"])).toThrow(
      /Missing required argument/,
    );
  });

  it("rejects unknown flags and positional args", () => {
    expect(() => parseCliArgs(["--id=camp-123"])).toThrow(/Unknown flag/);
    expect(() => parseCliArgs(["camp-123"])).toThrow(
      /Unexpected positional argument/,
    );
  });

  it("calls rejectCampaignContent with the campaignId and default feedback", async () => {
    rejectCampaignContentMock.mockResolvedValue({
      id: "camp-123",
      contentApproved: false,
      contentFeedback: DEFAULT_REJECTION_FEEDBACK,
    });

    const result = await rejectCampaignContentFromCli({
      campaignId: "camp-123",
    });

    expect(rejectCampaignContentMock).toHaveBeenCalledWith(
      "camp-123",
      DEFAULT_REJECTION_FEEDBACK,
    );
    expect(result).toMatchObject({
      id: "camp-123",
      contentApproved: false,
    });
  });

  it("surfaces non-existent campaign errors cleanly", async () => {
    rejectCampaignContentMock.mockRejectedValue(
      new Error("No Campaign found"),
    );

    await expect(
      rejectCampaignContentFromCli({ campaignId: "missing-campaign" }),
    ).rejects.toThrow(/No Campaign found/);
  });

  it("main reads process argv and rejects the requested campaign", async () => {
    rejectCampaignContentMock.mockResolvedValue({ id: "camp-123" });
    process.argv = [
      "node",
      "dist/cli/reject-campaign-content.js",
      "--campaignId",
      "camp-123",
    ];

    await expect(main()).resolves.toEqual({ id: "camp-123" });
    expect(rejectCampaignContentMock).toHaveBeenCalledWith(
      "camp-123",
      DEFAULT_REJECTION_FEEDBACK,
    );
  });
});
