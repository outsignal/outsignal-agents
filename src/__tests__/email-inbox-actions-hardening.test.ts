import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

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

const requireAdminAuthMock = vi.fn();
vi.mock("@/lib/require-admin-auth", () => ({
  requireAdminAuth: (...args: unknown[]) => requireAdminAuthMock(...args),
}));

const auditLogMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  auditLog: (...args: unknown[]) => auditLogMock(...args),
}));

const markReplyUnreadMock = vi.fn();
const deleteReplyMock = vi.fn();
const findLeadByEmailMock = vi.fn();
const addToBlacklistMock = vi.fn();
const deleteLeadMock = vi.fn();

const EmailBisonClientMock = vi.fn(function MockEmailBisonClient() {
  return {
    markReplyUnread: markReplyUnreadMock,
    deleteReply: deleteReplyMock,
    findLeadByEmail: findLeadByEmailMock,
    addToBlacklist: addToBlacklistMock,
    deleteLead: deleteLeadMock,
  };
});

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

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUnique: vi.fn(),
    },
    reply: {
      updateMany: vi.fn(),
    },
  },
}));

function makeJsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Email inbox destructive action hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ apiToken: "eb-token" } as never);
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "owner@example.com",
      role: "owner",
      exp: Infinity,
    });
    requireAdminAuthMock.mockResolvedValue({
      email: "admin@example.com",
      role: "admin",
      exp: Infinity,
    });
  });

  it.each([
    ["delete_reply", { replyId: 123 }],
    ["blacklist_email", { leadEmail: "lead@example.com" }],
    ["blacklist_domain", { value: "example.com" }],
    ["remove_lead", { leadId: 55 }],
  ])("requires confirmation for portal %s", async (action, extraBody) => {
    const { POST } = await import("@/app/api/portal/inbox/email/actions/route");
    const res = await POST(makeJsonRequest({ action, ...extraBody }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      error: "Confirmation required for destructive inbox actions",
    });
    expect(deleteReplyMock).not.toHaveBeenCalled();
    expect(addToBlacklistMock).not.toHaveBeenCalled();
    expect(deleteLeadMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("still allows non-destructive portal actions without confirmation", async () => {
    const { POST } = await import("@/app/api/portal/inbox/email/actions/route");
    const res = await POST(
      makeJsonRequest({ action: "mark_unread", replyId: 123 }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(markReplyUnreadMock).toHaveBeenCalledWith(123);
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("audits successful destructive portal actions", async () => {
    const { POST } = await import("@/app/api/portal/inbox/email/actions/route");
    const res = await POST(
      makeJsonRequest({
        action: "delete_reply",
        replyId: 123,
        confirmed: true,
      }),
    );

    expect(res.status).toBe(200);
    expect(deleteReplyMock).toHaveBeenCalledWith(123);
    expect(prisma.reply.updateMany).toHaveBeenCalledWith({
      where: { emailBisonReplyId: 123, workspaceSlug: "ws-1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(auditLogMock).toHaveBeenCalledWith({
      action: "portal.inbox.email.delete_reply",
      entityType: "Reply",
      entityId: "123",
      adminEmail: "owner@example.com",
      metadata: {
        workspaceSlug: "ws-1",
        replyId: 123,
      },
    });
  });

  it("requires confirmation for destructive admin inbox actions", async () => {
    const { POST } = await import("@/app/api/admin/inbox/email/actions/route");
    const res = await POST(
      makeJsonRequest({
        action: "remove_lead",
        workspaceSlug: "ws-1",
        leadId: 55,
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      error: "Confirmation required for destructive inbox actions",
    });
    expect(deleteLeadMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("audits successful destructive admin actions", async () => {
    const { POST } = await import("@/app/api/admin/inbox/email/actions/route");
    const res = await POST(
      makeJsonRequest({
        action: "remove_lead",
        workspaceSlug: "ws-1",
        leadId: 55,
        confirmed: true,
      }),
    );

    expect(res.status).toBe(200);
    expect(deleteLeadMock).toHaveBeenCalledWith(55);
    expect(auditLogMock).toHaveBeenCalledWith({
      action: "admin.inbox.email.remove_lead",
      entityType: "Lead",
      entityId: "55",
      adminEmail: "admin@example.com",
      metadata: {
        workspaceSlug: "ws-1",
        leadId: 55,
        leadEmail: null,
        value: null,
      },
    });
  });
});
