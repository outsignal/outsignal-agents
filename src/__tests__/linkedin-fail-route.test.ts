import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/linkedin/actions/[id]/fail/route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

vi.mock("@/lib/linkedin/auth", () => ({
  verifyWorkerAuth: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/linkedin/queue", () => ({
  markFailed: vi.fn().mockResolvedValue(true),
  markFailedIfRunning: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/linkedin/rate-limiter", () => ({
  consumeBudget: vi.fn().mockResolvedValue(undefined),
}));

import { markFailed, markFailedIfRunning } from "@/lib/linkedin/queue";
import { consumeBudget } from "@/lib/linkedin/rate-limiter";

function makeRequest(body: unknown = {}): NextRequest {
  return new NextRequest("http://localhost/api/linkedin/actions/action-1/fail", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = Promise.resolve({ id: "action-1" });

describe("POST /api/linkedin/actions/[id]/fail — worker timeout cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markFailed).mockResolvedValue(true);
    vi.mocked(markFailedIfRunning).mockResolvedValue(true);
  });

  it("skips timeout cleanup when the action is no longer running", async () => {
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "complete",
      actionType: "connection_request",
      senderId: "sender-1",
    });
    vi.mocked(markFailedIfRunning).mockResolvedValue(false);

    const res = await POST(
      makeRequest({ error: "worker_timeout", onlyIfRunning: true }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: true });
    expect(markFailedIfRunning).toHaveBeenCalledWith("action-1", "worker_timeout");
    expect(consumeBudget).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("fails a timed-out running action without consuming budget", async () => {
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "running",
      actionType: "connection_request",
      senderId: "sender-1",
    });

    const res = await POST(
      makeRequest({ error: "worker_timeout", onlyIfRunning: true }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: false });
    expect(markFailedIfRunning).toHaveBeenCalledWith("action-1", "worker_timeout");
    expect(consumeBudget).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("skips budget when the normal fail path loses a race to completion", async () => {
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "running",
      actionType: "connection_request",
      senderId: "sender-1",
    });
    vi.mocked(markFailed).mockResolvedValue(false);

    const res = await POST(
      makeRequest({ error: "Network error" }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: true });
    expect(markFailed).toHaveBeenCalledWith("action-1", "Network error");
    expect(consumeBudget).not.toHaveBeenCalled();
  });

  it.each([
    "connection_request",
    "message",
    "profile_view",
    "withdraw_connection",
  ])(
    "does not consume daily usage for failed %s actions",
    async (actionType) => {
      (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "action-1",
        status: "running",
        actionType,
        senderId: "sender-1",
      });

      const res = await POST(
        makeRequest({ error: "Network error" }),
        { params },
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, skipped: false });
      expect(markFailed).toHaveBeenCalledWith("action-1", "Network error");
      expect(consumeBudget).not.toHaveBeenCalled();
    },
  );

  it("does not consume budget for deterministic precondition failures", async () => {
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "running",
      actionType: "connection_request",
      senderId: "sender-1",
    });

    const res = await POST(
      makeRequest({ error: "invalid_profile_url" }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: false });
    expect(markFailed).toHaveBeenCalledWith("action-1", "invalid_profile_url");
    expect(consumeBudget).not.toHaveBeenCalled();
  });

  it("does not consume budget for already_invited terminal failures", async () => {
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "running",
      actionType: "connection_request",
      senderId: "sender-1",
    });

    const res = await POST(
      makeRequest({ error: "already_invited" }),
      { params },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: false });
    expect(markFailed).toHaveBeenCalledWith("action-1", "already_invited");
    expect(consumeBudget).not.toHaveBeenCalled();
  });
});
