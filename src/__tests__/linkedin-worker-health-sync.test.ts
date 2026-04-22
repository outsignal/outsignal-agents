import { beforeEach, describe, expect, it, vi } from "vitest";
import { Worker } from "../../worker/src/worker";
import { clearSenderStateOverrides } from "../../worker/src/sender-health-sync";

describe("LinkedIn worker sender health sync fallback", () => {
  const sender = {
    id: "sender-1",
    name: "Lucy Marshall",
    status: "active",
    healthStatus: "healthy",
    sessionStatus: "active",
  };
  const fullSender = {
    ...sender,
    linkedinProfileUrl: "https://www.linkedin.com/in/lucy-marshall",
    sessionData: "{}",
    proxyUrl: null,
    dailyConnectionLimit: 20,
    dailyMessageLimit: 30,
    dailyProfileViewLimit: 10,
  };

  beforeEach(() => {
    clearSenderStateOverrides();
    vi.restoreAllMocks();
  });

  it("fails closed locally when a session_expired health sync cannot be persisted", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.api = {
      updateSenderHealth: vi.fn().mockRejectedValue(new Error("PATCH failed")),
      getSenders: vi.fn().mockResolvedValue([sender]),
    };
    worker.running = true;
    worker.processSender = vi.fn();

    const synced = await worker.syncSenderHealth(
      sender,
      "session_expired",
      "test auth failure",
    );

    expect(synced).toBe(false);
    expect(worker.senderStateOverrides.get(sender.id)).toEqual({
      healthStatus: "session_expired",
      sessionStatus: "expired",
    });

    await worker.processWorkspace("acme");

    expect(worker.processSender).not.toHaveBeenCalled();
  });

  it("keeps locally expired sender state isolated so healthy senders still run", async () => {
    const senderB = {
      ...fullSender,
      id: "sender-2",
      name: "Daniel Lazarus",
    };
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.running = true;
    worker.senderStateOverrides.set(sender.id, {
      healthStatus: "session_expired",
      sessionStatus: "expired",
    });
    worker.api = {
      getSenders: vi.fn().mockResolvedValue([fullSender, senderB]),
    };
    worker.processSender = vi.fn().mockResolvedValue(undefined);

    await worker.processWorkspace("acme");

    expect(worker.processSender).toHaveBeenCalledTimes(1);
    expect(worker.processSender).toHaveBeenCalledWith(senderB);
  });

  it("recovery loop includes locally expired senders even when the API row is still healthy", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.running = true;
    worker.senderStateOverrides.set(sender.id, {
      healthStatus: "session_expired",
      sessionStatus: "expired",
    });
    worker.api = {
      getSenders: vi.fn().mockResolvedValue([sender]),
    };
    worker.ensureSenderSessionHealthy = vi.fn().mockResolvedValue({});

    await worker.recoverExpiredSessions(["acme"]);

    expect(worker.ensureSenderSessionHealthy).toHaveBeenCalledWith(sender);
  });

  it("fails closed locally for blocked health status and does not treat blocked senders as recoverable", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.api = {
      updateSenderHealth: vi.fn().mockRejectedValue(new Error("PATCH failed")),
    };

    const synced = await worker.syncSenderHealth(
      sender,
      "blocked",
      "checkpoint detection",
    );

    expect(synced).toBe(false);
    expect(worker.senderStateOverrides.get(sender.id)).toEqual({
      healthStatus: "blocked",
      sessionStatus: "expired",
    });
    expect(worker.isSenderRunnable(sender)).toBe(false);
    expect(worker.isSenderRecoverable(sender)).toBe(false);
  });

  it("stops the sender loop on the same tick once a local override is triggered mid-batch", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.running = true;
    worker.api = {
      getNextActions: vi.fn().mockResolvedValue([
        {
          id: "action-1",
          personId: "person-1",
          actionType: "connection_request",
          messageBody: null,
          priority: 1,
          linkedinUrl: "https://www.linkedin.com/in/person-1",
        },
        {
          id: "action-2",
          personId: "person-2",
          actionType: "profile_view",
          messageBody: null,
          priority: 1,
          linkedinUrl: "https://www.linkedin.com/in/person-2",
        },
      ]),
      getUsage: vi.fn().mockResolvedValue(null),
      updateSenderHealth: vi.fn().mockRejectedValue(new Error("PATCH failed")),
    };
    worker.ensureSenderSessionHealthy = vi.fn().mockResolvedValue({});
    worker.executeAction = vi.fn(async (_client: unknown, _action: unknown, target: typeof sender) => {
      await worker.syncSenderHealth(target, "session_expired", "mid-batch auth failure");
    });

    await worker.processSender(fullSender);

    expect(worker.executeAction).toHaveBeenCalledTimes(1);
    expect(worker.senderStateOverrides.get(sender.id)).toEqual({
      healthStatus: "session_expired",
      sessionStatus: "expired",
    });
  });

  it("clears the local override after a successful healthy sync", async () => {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.senderStateOverrides.set(sender.id, {
      healthStatus: "session_expired",
      sessionStatus: "expired",
    });
    worker.api = {
      updateSenderHealth: vi.fn().mockResolvedValue(undefined),
    };

    const synced = await worker.syncSenderHealth(
      sender,
      "healthy",
      "manual recovery",
    );

    expect(synced).toBe(true);
    expect(worker.senderStateOverrides.has(sender.id)).toBe(false);
    expect(worker.isSenderRunnable(sender)).toBe(true);
  });
});
