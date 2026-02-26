import { vi } from "vitest";

// Mock Prisma client globally
vi.mock("@/lib/db", () => ({
  prisma: {
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
  },
}));
