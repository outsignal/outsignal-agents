import { vi } from "vitest";

// Mock Prisma client globally
vi.mock("@/lib/db", () => {
  const prismaMock = {
    workspace: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    proposal: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    company: {
      upsert: vi.fn(),
    },
    webhookEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    notificationAuditLog: {
      create: vi.fn(),
    },
    onboardingInvite: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    cachedMetrics: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    enrichmentLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    enrichmentJob: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    dailyCostTotal: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    person: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    personWorkspace: {
      updateMany: vi.fn(),
    },
    sender: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    member: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    linkedInAction: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    inboxStatusSnapshot: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    linkedInDailyUsage: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    linkedInConnection: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    senderHealthEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    campaignSequenceRule: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    // E2E models (Phase 58)
    agentRun: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    campaign: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    targetList: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    targetListPerson: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    discoveredPerson: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaMock),
    ),
  };

  return { prisma: prismaMock };
});
