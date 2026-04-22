import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Worker } from "../../worker/src/worker";
import {
  HARD_SENDER_TIMEOUT_MS,
  PER_SENDER_TIMEOUT_MS,
  SENDER_TIMEOUT_EXIT_BUFFER_MS,
  shouldExitSenderLoop,
} from "../../worker/src/sender-timeout";

describe("LinkedIn worker sender timeout guard", () => {
  it("allows the loop to continue when enough time remains", () => {
    expect(
      shouldExitSenderLoop({
        elapsedMs: 5 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("exits before starting another action when the safety buffer is exhausted", () => {
    expect(
      shouldExitSenderLoop({
        elapsedMs: PER_SENDER_TIMEOUT_MS - SENDER_TIMEOUT_EXIT_BUFFER_MS,
      }),
    ).toBe(true);
  });

  it("exits before entering a spread delay that would overrun the sender timeout", () => {
    expect(
      shouldExitSenderLoop({
        elapsedMs: 9 * 60 * 1000,
        nextDelayMs: 10 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it("keeps a later hard backstop behind the graceful sender deadline", () => {
    expect(HARD_SENDER_TIMEOUT_MS).toBeGreaterThan(PER_SENDER_TIMEOUT_MS);
  });
});

describe("LinkedIn worker hard sender timeout", () => {
  const sender = {
    id: "sender-1",
    name: "Lucy Marshall",
    status: "active",
    healthStatus: "healthy",
    sessionStatus: "active",
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("invokes hard-timeout cleanup when a sender tick exceeds the backstop", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.running = true;
    worker.api = {
      getSenders: vi.fn().mockResolvedValue([sender]),
    };
    worker.processSender = vi.fn(
      () => new Promise<void>(() => undefined),
    );
    const timeoutSpy = vi
      .spyOn(worker, "handleSenderTimeout")
      .mockResolvedValue(undefined);

    const workPromise = worker.processWorkspace("acme");
    await vi.advanceTimersByTimeAsync(HARD_SENDER_TIMEOUT_MS);
    await workPromise;

    expect(worker.processSender).toHaveBeenCalledWith(sender);
    expect(timeoutSpy).toHaveBeenCalledWith(sender);
  });

  it("marks timed-out in-flight actions with hard_backstop_abort and blocks the sender", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.inFlightActionIdsBySender.set(sender.id, new Set(["action-1", "action-2"]));
    worker.activeClients.set(sender.id, {});
    worker.lastSessionCheck.set(sender.id, Date.now());
    worker.safeMarkFailedIfRunning = vi.fn().mockResolvedValue(undefined);

    await worker.handleSenderTimeout(sender);

    expect(worker.senderAborted.has(sender.id)).toBe(true);
    expect(worker.safeMarkFailedIfRunning).toHaveBeenCalledTimes(2);
    expect(worker.safeMarkFailedIfRunning).toHaveBeenNthCalledWith(
      1,
      "action-1",
      "hard_backstop_abort",
    );
    expect(worker.safeMarkFailedIfRunning).toHaveBeenNthCalledWith(
      2,
      "action-2",
      "hard_backstop_abort",
    );
    expect(worker.activeClients.has(sender.id)).toBe(false);
    expect(worker.lastSessionCheck.has(sender.id)).toBe(false);
    expect(worker.inFlightActionIdsBySender.has(sender.id)).toBe(false);
  });

  it("skips new sender work while a prior hard-timeout cleanup is still draining", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.running = true;
    worker.senderAborted.add(sender.id);
    worker.api = {
      getSenders: vi.fn().mockResolvedValue([sender]),
    };
    worker.processSender = vi.fn();

    await worker.processWorkspace("acme");

    expect(worker.processSender).not.toHaveBeenCalled();
  });
});
