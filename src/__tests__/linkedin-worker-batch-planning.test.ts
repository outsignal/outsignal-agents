import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Worker } from "../../worker/src/worker";
import { clearSenderStateOverrides } from "../../worker/src/sender-health-sync";

describe("LinkedIn worker batch planning hotfix", () => {
  const sender = {
    id: "sender-1",
    name: "James Bessey-Saldanha",
    status: "active",
    healthStatus: "healthy",
    sessionStatus: "active",
  };

  const fullSender = {
    ...sender,
    linkedinProfileUrl: "https://www.linkedin.com/in/james-bessey-saldanha",
    sessionData: "{}",
    proxyUrl: null,
    dailyConnectionLimit: 20,
    dailyMessageLimit: 30,
    dailyProfileViewLimit: 50,
  };

  beforeEach(() => {
    clearSenderStateOverrides();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createWorker() {
    const worker = new Worker({
      apiUrl: "http://localhost:3000",
      apiSecret: "test-secret",
      workspaceSlugs: [],
    }) as any;
    worker.running = true;
    worker.ensureSenderSessionHealthy = vi.fn().mockResolvedValue({});
    worker.executeAction = vi.fn().mockResolvedValue(undefined);
    worker.api = {
      getExecutionGuard: vi.fn().mockResolvedValue({
        sender: {
          id: sender.id,
          status: "active",
          healthStatus: "healthy",
          sessionStatus: "active",
        },
        pausedCampaignNames: [],
      }),
      getUsage: vi.fn().mockResolvedValue({
        connections: { sent: 0, limit: 20, remaining: 20 },
        messages: { sent: 0, limit: 30, remaining: 30 },
        profileViews: { sent: 0, limit: 50, remaining: 50 },
      }),
      peekNextActions: vi.fn(),
      claimActions: vi.fn(),
      getNextActions: vi.fn(),
      markFailedIfRunning: vi.fn().mockResolvedValue(undefined),
    };
    return worker;
  }

  it("prioritizes the faster-spread message and yields excess work before the loop burns the tick", async () => {
    const worker = createWorker();
    const actions = [
      {
        id: "pv-1",
        personId: "person-1",
        actionType: "profile_view",
        messageBody: null,
        priority: 1,
        linkedinUrl: "https://linkedin.com/in/person-1",
        campaignName: "BlankTag LinkedIn",
      },
      {
        id: "pv-2",
        personId: "person-2",
        actionType: "profile_view",
        messageBody: null,
        priority: 1,
        linkedinUrl: "https://linkedin.com/in/person-2",
        campaignName: "BlankTag LinkedIn",
      },
      {
        id: "pv-3",
        personId: "person-3",
        actionType: "profile_view",
        messageBody: null,
        priority: 1,
        linkedinUrl: "https://linkedin.com/in/person-3",
        campaignName: "BlankTag LinkedIn",
      },
      {
        id: "pv-4",
        personId: "person-4",
        actionType: "profile_view",
        messageBody: null,
        priority: 1,
        linkedinUrl: "https://linkedin.com/in/person-4",
        campaignName: "BlankTag LinkedIn",
      },
      {
        id: "pv-5",
        personId: "person-5",
        actionType: "profile_view",
        messageBody: null,
        priority: 1,
        linkedinUrl: "https://linkedin.com/in/person-5",
        campaignName: "BlankTag LinkedIn",
      },
      {
        id: "msg-1",
        personId: "person-6",
        actionType: "message",
        messageBody: "Hi there",
        priority: 1,
        linkedinUrl: "https://linkedin.com/in/person-6",
        campaignName: "BlankTag LinkedIn",
      },
    ];
    worker.api.peekNextActions.mockResolvedValue(actions);
    worker.api.claimActions.mockImplementation(
      async (_senderId: string, actionIds: string[]) =>
        actions.filter((action) => actionIds.includes(action.id)),
    );
    worker.api.getUsage
      .mockResolvedValueOnce({
        connections: { sent: 0, limit: 20, remaining: 20 },
        messages: { sent: 0, limit: 22, remaining: 21 },
        profileViews: { sent: 0, limit: 5, remaining: 5 },
      })
      .mockResolvedValue({
        connections: { sent: 0, limit: 20, remaining: 20 },
        messages: { sent: 1, limit: 22, remaining: 20 },
        profileViews: { sent: 2, limit: 5, remaining: 3 },
      });
    worker.calculateSpreadDelay = vi.fn((actionType: string) =>
      actionType === "message" ? 3 * 60 * 1000 : 6 * 60 * 1000,
    );

    const promise = worker.processSender(fullSender);

    await vi.advanceTimersByTimeAsync(0);

    expect(worker.api.markFailedIfRunning).not.toHaveBeenCalled();
    expect(worker.api.claimActions).toHaveBeenCalledWith(sender.id, [
      "msg-1",
      "pv-1",
      "pv-2",
    ]);
    expect(worker.executeAction).toHaveBeenCalledTimes(1);
    expect(worker.executeAction.mock.calls[0][1].id).toBe("msg-1");

    await vi.runAllTimersAsync();
    await promise;

    expect(worker.executeAction.mock.calls.map((call: any[]) => call[1].id)).toEqual([
      "msg-1",
      "pv-1",
      "pv-2",
    ]);
  });

  it("preserves the single-type burst fix by only executing a partial slow connection batch", async () => {
    const worker = createWorker();
    const actions = Array.from({ length: 5 }, (_, index) => ({
        id: `conn-${index + 1}`,
        personId: `person-${index + 1}`,
        actionType: "connection_request",
        messageBody: null,
        priority: 1,
        linkedinUrl: `https://linkedin.com/in/person-${index + 1}`,
        campaignName: "Lucy LinkedIn",
      }));
    worker.api.peekNextActions.mockResolvedValue(actions);
    worker.api.claimActions.mockImplementation(
      async (_senderId: string, actionIds: string[]) =>
        actions.filter((action) => actionIds.includes(action.id)),
    );
    worker.api.getUsage.mockResolvedValue({
      connections: { sent: 15, limit: 20, remaining: 5 },
      messages: { sent: 0, limit: 30, remaining: 30 },
      profileViews: { sent: 0, limit: 50, remaining: 50 },
    });
    worker.calculateSpreadDelay = vi.fn().mockReturnValue(30 * 60 * 1000);

    const promise = worker.processSender(fullSender);

    await vi.advanceTimersByTimeAsync(0);

    expect(worker.api.claimActions).toHaveBeenCalledWith(sender.id, [
      "conn-1",
    ]);
    expect(worker.executeAction).toHaveBeenCalledTimes(1);
    expect(worker.api.markFailedIfRunning).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await promise;

    expect(worker.executeAction).toHaveBeenCalledTimes(1);
  });

  it("keeps the full batch when every action is on the fast 3-minute clamp", async () => {
    const worker = createWorker();
    const actions = Array.from({ length: 5 }, (_, index) => ({
        id: `action-${index + 1}`,
        personId: `person-${index + 1}`,
        actionType: index % 2 === 0 ? "message" : "profile_view",
        messageBody: "Hi",
        priority: 1,
        linkedinUrl: `https://linkedin.com/in/person-${index + 1}`,
        campaignName: "Fast Campaign",
      }));
    worker.api.peekNextActions.mockResolvedValue(actions);
    worker.api.claimActions.mockImplementation(
      async (_senderId: string, actionIds: string[]) =>
        actions.filter((action) => actionIds.includes(action.id)),
    );
    worker.calculateSpreadDelay = vi.fn().mockReturnValue(3 * 60 * 1000);

    const promise = worker.processSender(fullSender);
    await vi.runAllTimersAsync();
    await promise;

    expect(worker.api.claimActions).toHaveBeenCalledWith(sender.id, [
      "action-1",
      "action-2",
      "action-3",
      "action-4",
      "action-5",
    ]);
    expect(worker.executeAction).toHaveBeenCalledTimes(5);
    expect(worker.api.markFailedIfRunning).not.toHaveBeenCalled();
  });

  it("truncates a uniformly slow batch before the loop starts", async () => {
    const worker = createWorker();
    const actions = Array.from({ length: 5 }, (_, index) => ({
        id: `pv-${index + 1}`,
        personId: `person-${index + 1}`,
        actionType: "profile_view",
        messageBody: null,
        priority: 1,
        linkedinUrl: `https://linkedin.com/in/person-${index + 1}`,
        campaignName: "Slow Campaign",
      }));
    worker.api.peekNextActions.mockResolvedValue(actions);
    worker.api.claimActions.mockImplementation(
      async (_senderId: string, actionIds: string[]) =>
        actions.filter((action) => actionIds.includes(action.id)),
    );
    worker.calculateSpreadDelay = vi.fn().mockReturnValue(6 * 60 * 1000);

    const promise = worker.processSender(fullSender);

    await vi.advanceTimersByTimeAsync(0);

    expect(worker.api.claimActions).toHaveBeenCalledWith(sender.id, [
      "pv-1",
      "pv-2",
      "pv-3",
    ]);
    expect(worker.api.markFailedIfRunning).not.toHaveBeenCalled();
    expect(worker.executeAction).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    await promise;

    expect(worker.executeAction.mock.calls.length).toBe(3);
    expect(worker.api.markFailedIfRunning).not.toHaveBeenCalled();
  });
});
