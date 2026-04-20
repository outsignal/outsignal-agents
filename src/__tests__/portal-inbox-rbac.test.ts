import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
  },
  NextRequest: class extends Request {
    nextUrl: URL;

    constructor(input: string | URL, init?: RequestInit) {
      super(input, init);
      this.nextUrl = new URL(typeof input === "string" ? input : input.toString());
    }
  },
}));

const getPortalSessionMock = vi.fn();
vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

const markReplyUnreadMock = vi.fn();
const sendReplyMock = vi.fn();
const enqueueActionMock = vi.fn();

const EmailBisonClientMock = vi.fn().mockImplementation(() => ({
  markReplyUnread: markReplyUnreadMock,
  sendReply: sendReplyMock,
}));

class MockEmailBisonApiError extends Error {
  status: number;
  body: string;
  isRecordNotFound: boolean;

  constructor(status = 500, body = "mock") {
    super("EmailBison API error");
    this.status = status;
    this.body = body;
    this.isRecordNotFound = false;
  }
}

class MockEmailBisonError extends Error {
  statusCode: number;

  constructor(statusCode = 500) {
    super("EmailBison error");
    this.statusCode = statusCode;
  }
}

vi.mock("@/lib/emailbison/client", () => ({
  EmailBisonClient: EmailBisonClientMock,
  EmailBisonApiError: MockEmailBisonApiError,
}));

vi.mock("@/lib/emailbison/types", () => ({
  EmailBisonError: MockEmailBisonError,
}));

vi.mock("@/lib/linkedin/queue", () => ({
  enqueueAction: (...args: unknown[]) => enqueueActionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUnique: vi.fn(),
    },
    reply: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    linkedInConversation: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

function makeJsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Portal inbox RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks viewers from destructive email inbox actions", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import("@/app/api/portal/inbox/email/actions/route");
    const res = await POST(
      makeJsonRequest({ action: "mark_unread", replyId: 123 }),
    );

    expect(res.status).toBe(403);
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(EmailBisonClientMock).not.toHaveBeenCalled();
    expect(markReplyUnreadMock).not.toHaveBeenCalled();
  });

  it("blocks viewers from sending email inbox replies", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import("@/app/api/portal/inbox/email/reply/route");
    const res = await POST(
      makeJsonRequest({ replyId: "reply-1", message: "Hello there" }),
    );

    expect(res.status).toBe(403);
    expect(prisma.reply.findFirst).not.toHaveBeenCalled();
    expect(EmailBisonClientMock).not.toHaveBeenCalled();
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("blocks viewers from sending LinkedIn inbox replies", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import("@/app/api/portal/inbox/linkedin/reply/route");
    const res = await POST(
      makeJsonRequest({ conversationId: "conv-1", message: "Hello there" }),
    );

    expect(res.status).toBe(403);
    expect(prisma.linkedInConversation.findFirst).not.toHaveBeenCalled();
    expect(enqueueActionMock).not.toHaveBeenCalled();
  });

  it("allows admins to queue LinkedIn inbox replies", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "admin@example.com",
      role: "admin",
      exp: Infinity,
    });
    vi.mocked(prisma.linkedInConversation.findFirst).mockResolvedValue({
      id: "conv-1",
      senderId: "sender-1",
      personId: "person-1",
      participantProfileUrl: "https://linkedin.com/in/person-1",
    } as never);
    enqueueActionMock.mockResolvedValue("lia-1");

    const { POST } = await import("@/app/api/portal/inbox/linkedin/reply/route");
    const res = await POST(
      makeJsonRequest({ conversationId: "conv-1", message: "Hello there" }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(enqueueActionMock).toHaveBeenCalledWith({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "ws-1",
      actionType: "message",
      messageBody: "Hello there",
      priority: 1,
      scheduledFor: expect.any(Date),
      linkedInConversationId: undefined,
    });
    expect(body.actionId).toBe("lia-1");
  });
});
