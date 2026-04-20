import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/linkedin/actions/[id]/complete/route";
import { NextRequest } from "next/server";

// Mock queue.markComplete and rate-limiter.consumeBudget so we can assert
// which ones actually fire under retry conditions.
vi.mock("@/lib/linkedin/queue", () => ({
  markComplete: vi.fn().mockResolvedValue({ transitionedFromRunning: true }),
}));

vi.mock("@/lib/linkedin/rate-limiter", () => ({
  consumeBudget: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/linkedin/auth", () => ({
  verifyWorkerAuth: vi.fn().mockReturnValue(true),
}));

import { markComplete } from "@/lib/linkedin/queue";
import { consumeBudget } from "@/lib/linkedin/rate-limiter";

const prismaAny = prisma as unknown as {
  linkedInConversation: { findFirst: ReturnType<typeof vi.fn> };
  linkedInMessage: { create: ReturnType<typeof vi.fn> };
};

function makeRequest(body: unknown = {}): NextRequest {
  return new NextRequest("http://localhost/api/linkedin/actions/action-1/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = Promise.resolve({ id: "action-1" });

describe("POST /api/linkedin/actions/[id]/complete — BL-058 Bug 1 (retry double-count)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(markComplete).mockResolvedValue({ transitionedFromRunning: true });
    (prisma.linkedInConnection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    prismaAny.linkedInConversation = {
      findFirst: vi.fn().mockResolvedValue(null),
    };
    prismaAny.linkedInMessage = {
      create: vi.fn().mockResolvedValue({}),
    };
  });

  it("consumes budget exactly once when action transitions from running → complete", async () => {
    // First /complete call: status is 'running'
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "running",
      actionType: "connection_request",
      senderId: "sender-1",
      personId: "person-1",
    });

    const res = await POST(makeRequest({ result: { ok: true } }), { params });

    expect(res.status).toBe(200);
    expect(markComplete).toHaveBeenCalledTimes(1);
    expect(consumeBudget).toHaveBeenCalledTimes(1);
    expect(consumeBudget).toHaveBeenCalledWith("sender-1", "connection_request");
  });

  it("does NOT consume budget on a second /complete call when status is already 'complete'", async () => {
    // Retried /complete call: status is already 'complete' from the first call
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "complete",
      actionType: "connection_request",
      senderId: "sender-1",
      personId: "person-1",
    });
    vi.mocked(markComplete).mockResolvedValue({ transitionedFromRunning: false });

    const res = await POST(makeRequest({ result: { ok: true } }), { params });

    expect(res.status).toBe(200);
    // markComplete still runs (idempotent update) but budget must not double-count
    expect(consumeBudget).not.toHaveBeenCalled();
  });

  it("does NOT upsert a pending connection or touch sender state on a stale completion", async () => {
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "complete",
      actionType: "connection_request",
      senderId: "sender-1",
      personId: "person-1",
    });
    vi.mocked(markComplete).mockResolvedValue({ transitionedFromRunning: false });

    const res = await POST(makeRequest({ result: { ok: true } }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, staleTransition: true });
    expect(prisma.linkedInConnection.upsert).not.toHaveBeenCalled();
    expect(prisma.sender.update).not.toHaveBeenCalled();
  });

  it("does NOT store outbound messages on a stale message completion", async () => {
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "complete",
      actionType: "message",
      senderId: "sender-1",
      personId: "person-1",
      messageBody: "hello there",
      linkedInConversationId: "conv-1",
    });
    vi.mocked(markComplete).mockResolvedValue({ transitionedFromRunning: false });

    const res = await POST(makeRequest({ result: { ok: true } }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, staleTransition: true });
    expect(
      prismaAny.linkedInMessage.create,
    ).not.toHaveBeenCalled();
    expect(prisma.sender.update).not.toHaveBeenCalled();
  });

  it("does NOT consume budget if status was 'pending' (rare edge case — defensive)", async () => {
    // A /complete hit on a not-yet-picked-up action shouldn't consume budget
    // because no attempt was actually made.
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      status: "pending",
      actionType: "connection_request",
      senderId: "sender-1",
      personId: "person-1",
    });
    vi.mocked(markComplete).mockResolvedValue({ transitionedFromRunning: false });

    const res = await POST(makeRequest({ result: { ok: true } }), { params });

    expect(res.status).toBe(200);
    expect(consumeBudget).not.toHaveBeenCalled();
  });

  it("two successive /complete calls increment daily usage by 1 total, not 2", async () => {
    // Simulate the exact James scenario: action runs, retries, completes twice.
    // Call 1: status='running' → consume fires
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "action-1",
      status: "running",
      actionType: "connection_request",
      senderId: "sender-james",
      personId: "person-1",
    });
    vi.mocked(markComplete).mockResolvedValueOnce({ transitionedFromRunning: true });
    await POST(makeRequest({ result: { ok: true } }), { params });

    // Call 2: status now 'complete' (markComplete already ran) → consume does NOT fire
    (prisma.linkedInAction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "action-1",
      status: "complete",
      actionType: "connection_request",
      senderId: "sender-james",
      personId: "person-1",
    });
    vi.mocked(markComplete).mockResolvedValueOnce({ transitionedFromRunning: false });
    await POST(makeRequest({ result: { ok: true } }), { params });

    // Total: exactly one budget consumption across two /complete calls.
    expect(consumeBudget).toHaveBeenCalledTimes(1);
  });
});
