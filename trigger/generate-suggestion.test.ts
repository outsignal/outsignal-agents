import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@trigger.dev/sdk", () => ({
  task: <T extends object>(config: T) => config,
}));

const replyFindUniqueMock = vi.fn();
const replyUpdateMock = vi.fn();
const personFindUniqueMock = vi.fn();
const workspaceFindUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    reply: {
      findUnique: (...args: unknown[]) => replyFindUniqueMock(...args),
      update: (...args: unknown[]) => replyUpdateMock(...args),
    },
    person: {
      findUnique: (...args: unknown[]) => personFindUniqueMock(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) => workspaceFindUniqueMock(...args),
    },
  },
}));

const runAgentMock = vi.fn();
vi.mock("@/lib/agents/runner", () => ({
  runAgent: (...args: unknown[]) => runAgentMock(...args),
}));

vi.mock("@/lib/agents/writer", () => ({
  writerConfig: { model: "claude-sonnet-4-6" },
}));

const getCrawlMarkdownMock = vi.fn();
vi.mock("@/lib/icp/crawl-cache", () => ({
  getCrawlMarkdown: (...args: unknown[]) => getCrawlMarkdownMock(...args),
}));

vi.mock("@/lib/slack", () => ({
  postMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./queues", () => ({
  anthropicQueue: {},
}));

describe("generateSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    replyFindUniqueMock.mockResolvedValue({
      id: "reply-1",
      aiSuggestedReply: null,
      personId: "person-1",
      senderEmail: "lead@example.com",
      senderName: "Pat Lead",
      bodyText: "Can you explain how this helps?",
      subject: "Re: hello",
      intent: "interested",
      sentiment: "neutral",
      campaignName: "Campaign",
      outboundSubject: null,
      outboundBody: null,
      emailBisonParentId: null,
      leadEmail: null,
    });
  });

  it("returns needs_evidence and does not generate when company website content is unavailable", async () => {
    personFindUniqueMock.mockResolvedValue({
      company: "TempCo",
      companyDomain: "tempco.com",
    });
    getCrawlMarkdownMock.mockResolvedValue(null);

    const { runGenerateSuggestion } = await import("./generate-suggestion");
    const result = await runGenerateSuggestion({
      replyId: "reply-1",
      workspaceSlug: "1210-solutions",
    });

    expect(result).toEqual({
      status: "needs_evidence",
      reason: "No website content for TempCo. Manual reply required.",
      draft: null,
    });
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(replyUpdateMock).not.toHaveBeenCalled();
  });

  it("generates and persists a suggestion when website evidence is available", async () => {
    personFindUniqueMock.mockResolvedValue({
      company: "TempCo",
      companyDomain: "tempco.com",
    });
    getCrawlMarkdownMock.mockResolvedValue("TempCo runs staffing operations in the UK.");
    workspaceFindUniqueMock.mockResolvedValue({ slackChannelId: null });
    runAgentMock.mockResolvedValue({
      text: "Thanks for the reply — happy to share a few examples.",
      steps: [],
      durationMs: 42,
    });

    const { runGenerateSuggestion } = await import("./generate-suggestion");
    const result = await runGenerateSuggestion({
      replyId: "reply-1",
      workspaceSlug: "1210-solutions",
    });

    expect(runAgentMock).toHaveBeenCalled();
    expect(replyUpdateMock).toHaveBeenCalledWith({
      where: { id: "reply-1" },
      data: { aiSuggestedReply: "Thanks for the reply — happy to share a few examples." },
    });
    expect(result).toMatchObject({
      success: true,
      replyId: "reply-1",
    });
  });
});
