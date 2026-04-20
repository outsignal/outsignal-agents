import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

vi.mock("@/lib/linkedin/auth", () => ({
  verifyWorkerAuth: vi.fn().mockReturnValue(true),
}));

describe("LinkedIn sender health and connection-status routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("co-writes sessionStatus=expired when the worker marks a sender session_expired", async () => {
    const { PATCH } = await import(
      "@/app/api/linkedin/senders/[id]/health/route"
    );

    const req = new NextRequest(
      "http://localhost/api/linkedin/senders/sender-1/health",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ healthStatus: "session_expired" }),
      },
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: "sender-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.sender.findUnique).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      select: { sessionStatus: true, healthStatus: true },
    });
    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        healthStatus: "session_expired",
        sessionStatus: "expired",
      },
    });
  });

  it("co-writes sessionStatus=expired when the worker marks a sender blocked", async () => {
    const { PATCH } = await import(
      "@/app/api/linkedin/senders/[id]/health/route"
    );

    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionStatus: "active",
    });

    const req = new NextRequest(
      "http://localhost/api/linkedin/senders/sender-1/health",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ healthStatus: "blocked" }),
      },
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: "sender-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        healthStatus: "blocked",
        sessionStatus: "expired",
      },
    });
  });

  it("restores sessionStatus=active when the worker marks a previously expired sender healthy", async () => {
    const { PATCH } = await import(
      "@/app/api/linkedin/senders/[id]/health/route"
    );

    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionStatus: "expired",
    });

    const req = new NextRequest(
      "http://localhost/api/linkedin/senders/sender-1/health",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ healthStatus: "healthy" }),
      },
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: "sender-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        healthStatus: "healthy",
        sessionStatus: "active",
      },
    });
  });

  it("heals stale session_expired state when a keepalive lands for an active sender", async () => {
    const { PATCH } = await import(
      "@/app/api/linkedin/senders/[id]/health/route"
    );

    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionStatus: "active",
      healthStatus: "session_expired",
    });

    const req = new NextRequest(
      "http://localhost/api/linkedin/senders/sender-1/health",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastKeepaliveAt: "2026-04-20T09:15:00.000Z" }),
      },
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: "sender-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        lastKeepaliveAt: new Date("2026-04-20T09:15:00.000Z"),
        healthStatus: "healthy",
      },
    });
  });

  it("does not auto-activate a sender that is only not_setup when a keepalive lands", async () => {
    const { PATCH } = await import(
      "@/app/api/linkedin/senders/[id]/health/route"
    );

    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionStatus: "not_setup",
      healthStatus: "session_expired",
    });

    const req = new NextRequest(
      "http://localhost/api/linkedin/senders/sender-1/health",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastKeepaliveAt: "2026-04-20T09:15:00.000Z" }),
      },
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: "sender-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        lastKeepaliveAt: new Date("2026-04-20T09:15:00.000Z"),
      },
    });
  });

  it("requires senderId and scopes person connection lookups to that sender", async () => {
    const { GET } = await import(
      "@/app/api/linkedin/connections/person/[personId]/status/route"
    );

    const missingReq = new NextRequest(
      "http://localhost/api/linkedin/connections/person/person-1/status",
    );

    const missingRes = await GET(missingReq, {
      params: Promise.resolve({ personId: "person-1" }),
    });
    const missingBody = await missingRes.json();

    expect(missingRes.status).toBe(400);
    expect(missingBody).toEqual({ error: "senderId is required" });

    (prisma.linkedInConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "connected",
    });

    const req = new NextRequest(
      "http://localhost/api/linkedin/connections/person/person-1/status?senderId=sender-1",
    );
    const res = await GET(req, {
      params: Promise.resolve({ personId: "person-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "connected" });
    expect(prisma.linkedInConnection.findFirst).toHaveBeenCalledWith({
      where: { personId: "person-1", senderId: "sender-1" },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    });
  });
});
