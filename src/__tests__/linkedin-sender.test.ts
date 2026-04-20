import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  createSender,
  getSendersForWorkspace,
  getActiveSenders,
  assignSenderForPerson,
  activateSender,
  pauseSender,
  updateAcceptanceRate,
} from "@/lib/linkedin/sender";
import { getWarmupLimits } from "@/lib/linkedin/rate-limiter";

describe("createSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates sender with conservative defaults", async () => {
    (prisma.sender.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
    });

    await createSender({
      workspaceSlug: "rise",
      name: "Alice",
      emailAddress: "alice@rise.com",
      linkedinProfileUrl: "https://linkedin.com/in/alice",
    });

    expect(prisma.sender.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceSlug: "rise",
        name: "Alice",
        emailAddress: "alice@rise.com",
        linkedinProfileUrl: "https://linkedin.com/in/alice",
        status: "setup",
        healthStatus: "healthy",
        sessionStatus: "not_setup",
        warmupDay: 0,
        dailyConnectionLimit: 5,
        dailyMessageLimit: 10,
        dailyProfileViewLimit: 15,
      }),
    });
  });
});

describe("getSendersForWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns senders ordered by creation date", async () => {
    const mockSenders = [
      { id: "s1", name: "Alice" },
      { id: "s2", name: "Bob" },
    ];
    (prisma.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockSenders);

    const result = await getSendersForWorkspace("rise");

    expect(result).toEqual(mockSenders);
    expect(prisma.sender.findMany).toHaveBeenCalledWith({
      where: { workspaceSlug: "rise" },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("getActiveSenders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only operational linkedin senders", async () => {
    const mockSenders = [{ id: "s1", name: "Alice" }];
    (prisma.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockSenders);

    const result = await getActiveSenders("rise");

    expect(result).toEqual(mockSenders);
    expect(prisma.sender.findMany).toHaveBeenCalledWith({
      where: {
        workspaceSlug: "rise",
        status: "active",
        channel: { in: ["linkedin", "both"] },
        sessionStatus: "active",
        healthStatus: { notIn: ["blocked", "session_expired"] },
      },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("assignSenderForPerson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches sender by email address for email_linkedin mode", async () => {
    const senders = [
      { id: "s1", emailAddress: "alice@rise.com", status: "active" },
      { id: "s2", emailAddress: "bob@rise.com", status: "active" },
    ];
    (prisma.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(senders);

    const result = await assignSenderForPerson("rise", {
      emailSenderAddress: "bob@rise.com",
      mode: "email_linkedin",
    });

    expect(result?.id).toBe("s2");
  });

  it("falls back to the least-used eligible sender when no email match is found", async () => {
    const senders = [
      { id: "s1", name: "Alice", emailAddress: "alice@rise.com", status: "active" },
      { id: "s2", name: "Bob", emailAddress: "bob@rise.com", status: "active" },
    ];
    (prisma.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(senders);
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ connectionsSent: 7, messagesSent: 2, profileViews: 9 })
      .mockResolvedValueOnce({ connectionsSent: 1, messagesSent: 0, profileViews: 2 });

    const result = await assignSenderForPerson("rise", {
      emailSenderAddress: "unknown@rise.com",
      mode: "email_linkedin",
    });

    expect(result?.id).toBe("s2");
  });

  it("falls back to a refreshable expired sender for email_linkedin mode instead of dropping the action", async () => {
    (prisma.sender.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "s-expired",
          emailAddress: "alice@rise.com",
          status: "active",
          sessionStatus: "expired",
          healthStatus: "session_expired",
        },
      ]);

    const result = await assignSenderForPerson("rise", {
      emailSenderAddress: "alice@rise.com",
      mode: "email_linkedin",
    });

    expect(result?.id).toBe("s-expired");
    expect(prisma.sender.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        workspaceSlug: "rise",
        status: "active",
        channel: { in: ["linkedin", "both"] },
        sessionStatus: { in: ["active", "expired"] },
        healthStatus: { not: "blocked" },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("round-robins for linkedin_only mode based on least usage", async () => {
    const senders = [
      { id: "s1", name: "Alice", status: "active" },
      { id: "s2", name: "Bob", status: "active" },
    ];
    (prisma.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(senders);

    // Alice has more usage today, Bob should be picked
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ connectionsSent: 10, messagesSent: 5, profileViews: 20 }) // Alice
      .mockResolvedValueOnce({ connectionsSent: 3, messagesSent: 1, profileViews: 5 }); // Bob

    const result = await assignSenderForPerson("rise", {
      mode: "linkedin_only",
    });

    expect(result?.id).toBe("s2"); // Bob has less usage
  });

  it("returns null when no active senders exist", async () => {
    (prisma.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await assignSenderForPerson("rise", {
      mode: "linkedin_only",
    });

    expect(result).toBeNull();
  });
});

describe("activateSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets status to active and starts warmup at day 1", async () => {
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const limits = getWarmupLimits(1, "sender-1");

    await activateSender("sender-1");

    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: expect.objectContaining({
        status: "active",
        warmupDay: 1,
        warmupStartedAt: expect.any(Date),
        dailyConnectionLimit: limits.connections,
        dailyMessageLimit: limits.messages,
        dailyProfileViewLimit: limits.profileViews,
      }),
    });
  });
});

describe("pauseSender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pauses sender with paused health status", async () => {
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await pauseSender("sender-1");

    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: { status: "paused", healthStatus: "paused" },
    });
  });

  it("sets health to blocked for captcha reason", async () => {
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await pauseSender("sender-1", "captcha");

    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: { status: "paused", healthStatus: "blocked" },
    });
  });
});

describe("updateAcceptanceRate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates acceptance rate from connection data", async () => {
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(20) // total sent
      .mockResolvedValueOnce(8); // accepted
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const rate = await updateAcceptanceRate("sender-1");

    expect(rate).toBe(0.4); // 8/20
    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: { acceptanceRate: 0.4 },
    });
  });

  it("returns null when no connections sent", async () => {
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    const rate = await updateAcceptanceRate("sender-1");
    expect(rate).toBeNull();
  });
});
