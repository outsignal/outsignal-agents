import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
    redirect: (url: URL | string) => ({
      status: 307,
      headers: new Headers(),
      url: typeof url === "string" ? url : url.toString(),
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

const verifyLimiterMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => verifyLimiterMock,
}));

const createSessionCookieMock = vi.fn((_session?: unknown) => "portal_session=abc");
vi.mock("@/lib/portal-auth", () => ({
  createSessionCookie: (session: unknown) => createSessionCookieMock(session),
}));

const getPortalSessionMock = vi.fn();
vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
}));

vi.mock("@/lib/validations/linkedin", () => ({
  linkedinLoginSchema: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    magicLinkToken: {
      findUnique: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    sender: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

describe("Portal magic link + sender RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyLimiterMock.mockReturnValue({ success: true });
  });

  it("rejects a magic-link token when atomic consume loses the race", async () => {
    vi.mocked(prisma.magicLinkToken.findUnique).mockResolvedValue({
      id: "mlt-1",
      token: "tok-1",
      email: "user@example.com",
      workspaceSlug: "ws-1",
      used: false,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        magicLinkToken: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        } as never,
        member: {
          findUnique: vi.fn(),
          update: vi.fn(),
        } as never,
      }) as never) as never);

    const { GET } = await import("@/app/api/portal/verify/route");
    const res = await GET(new NextRequest("https://portal.outsignal.ai/api/portal/verify?token=tok-1"));

    expect(res.status).toBe(307);
    expect(res.url).toContain("/portal/login?error=expired");
    expect(createSessionCookieMock).not.toHaveBeenCalled();
  });

  it("blocks viewer access to portal linkedin connect", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import("@/app/api/portal/linkedin/connect/route");
    const req = new NextRequest("http://localhost/api/portal/linkedin/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "sender-1",
        method: "credentials",
        email: "li@example.com",
        password: "secret",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it("blocks viewer access to sender login route", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import("@/app/api/linkedin/senders/[id]/login/route");
    const req = new NextRequest("http://localhost/api/linkedin/senders/sender-1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "li@example.com",
        password: "secret",
        method: "credentials",
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "sender-1" }) });

    expect(res.status).toBe(403);
  });

  it("does not persist LinkedIn credentials when worker login fails", async () => {
    vi.resetModules();
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "admin@example.com",
      role: "admin",
      exp: Infinity,
    });
    vi.mocked(prisma.sender.findUnique).mockResolvedValue({
      id: "sender-1",
      workspaceSlug: "ws-1",
      proxyUrl: null,
    } as never);
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "bad credentials" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    process.env.LINKEDIN_WORKER_URL = "https://worker.example";
    process.env.WORKER_API_SECRET = "secret";

    const { POST } = await import("@/app/api/linkedin/senders/[id]/login/route");
    const req = new NextRequest("http://localhost/api/linkedin/senders/sender-1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "li@example.com",
        password: "secret",
        method: "credentials",
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "sender-1" }) });
    const body = await res.json();

    expect(body).toEqual({ success: false, error: "bad credentials" });
    expect(prisma.sender.update).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not persist LinkedIn credentials unless worker success is explicitly true", async () => {
    vi.resetModules();
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "admin@example.com",
      role: "admin",
      exp: Infinity,
    });
    vi.mocked(prisma.sender.findUnique).mockResolvedValue({
      id: "sender-1",
      workspaceSlug: "ws-1",
      proxyUrl: null,
    } as never);
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "worker returned no success flag" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    process.env.LINKEDIN_WORKER_URL = "https://worker.example";
    process.env.WORKER_API_SECRET = "secret";

    const { POST } = await import("@/app/api/linkedin/senders/[id]/login/route");
    const req = new NextRequest("http://localhost/api/linkedin/senders/sender-1/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "li@example.com",
        password: "secret",
        method: "credentials",
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "sender-1" }) });
    const body = await res.json();

    expect(body).toEqual({ error: "worker returned no success flag" });
    expect(prisma.sender.update).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
