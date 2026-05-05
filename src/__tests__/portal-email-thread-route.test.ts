import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getPortalSessionMock,
  replyFindManyMock,
  linkedInConversationFindFirstMock,
} = vi.hoisted(() => ({
  getPortalSessionMock: vi.fn(),
  replyFindManyMock: vi.fn(),
  linkedInConversationFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    reply: {
      findMany: (...args: unknown[]) => replyFindManyMock(...args),
    },
    linkedInConversation: {
      findFirst: (...args: unknown[]) =>
        linkedInConversationFindFirstMock(...args),
    },
  },
}));

function makeRequest(threadId: number): NextRequest {
  return new NextRequest(
    `http://localhost/api/portal/inbox/email/threads/${threadId}`,
  );
}

function inboundReply(overrides: Record<string, unknown> = {}) {
  return {
    id: "reply-1",
    workspaceSlug: "lime-recruitment",
    senderEmail: "nikki.mcdonald@ibstock.co.uk",
    senderName: "Nikki McDonald",
    subject: "RE: 24/7 shift cover",
    bodyText: "Hi there, sorry but we have a designated agency.",
    receivedAt: new Date("2026-05-01T15:47:04.000Z"),
    emailBisonReplyId: 11825,
    emailBisonParentId: null,
    direction: "inbound",
    outboundSubject: "24/7 shift cover",
    outboundBody: null,
    htmlBody: null,
    intent: "objection",
    sentiment: "neutral",
    interested: false,
    aiSuggestedReply: null,
    ebSenderEmailId: null,
    personId: null,
    leadEmail: "nikki.mcdonald@ibstock.co.uk",
    ...overrides,
  };
}

describe("portal email thread detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "lime-recruitment",
      email: "jamie@example.com",
      role: "owner",
      exp: Infinity,
    });
    linkedInConversationFindFirstMock.mockResolvedValue(null);
  });

  it("does not emit an outbound context message with null bodyText", async () => {
    replyFindManyMock.mockResolvedValue([inboundReply()]);

    const { GET } = await import(
      "@/app/api/portal/inbox/email/threads/[threadId]/route"
    );
    const response = await GET(makeRequest(11825), {
      params: Promise.resolve({ threadId: "11825" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      id: "reply-1",
      bodyText: "Hi there, sorry but we have a designated agency.",
    });
    expect(
      body.messages.some(
        (message: { id: string; bodyText?: string | null }) =>
          message.id === "outbound-context" || message.bodyText == null,
      ),
    ).toBe(false);
  });

  it("prepends outbound context when the original outbound body is available", async () => {
    replyFindManyMock.mockResolvedValue([
      inboundReply({
        outboundBody:
          "Hi Nikki, most factory managers already have agencies on their books.",
      }),
    ]);

    const { GET } = await import(
      "@/app/api/portal/inbox/email/threads/[threadId]/route"
    );
    const response = await GET(makeRequest(11825), {
      params: Promise.resolve({ threadId: "11825" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0]).toMatchObject({
      id: "outbound-context",
      direction: "outbound",
      subject: "24/7 shift cover",
      bodyText:
        "Hi Nikki, most factory managers already have agencies on their books.",
      isOutboundContext: true,
    });
    expect(body.messages[1]).toMatchObject({ id: "reply-1" });
  });
});
