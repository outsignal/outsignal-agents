import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma — `stageDiscoveredPeople` needs findMany (dedup check) and
// createMany (insert). We capture the data passed to createMany so tests
// can inspect the `rawResponse` field the staging helper generates.
const createManyMock = vi.fn();
const findManyMock = vi.fn();
const findFirstMock = vi.fn();
const workspaceFindUniqueOrThrowMock = vi.fn();
const discoveryRunUpsertMock = vi.fn();
const discoveryRunUpdateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => workspaceFindUniqueOrThrowMock(...args),
    },
    discoveryRun: {
      upsert: (...args: unknown[]) => discoveryRunUpsertMock(...args),
      update: (...args: unknown[]) => discoveryRunUpdateMock(...args),
    },
    discoveredPerson: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      createMany: (...args: unknown[]) => createManyMock(...args),
    },
  },
}));

import { stageDiscoveredPeople } from "../staging";
import type { DiscoveredPersonResult } from "../types";

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]); // no existing duplicates
  findFirstMock.mockResolvedValue(null);
  createManyMock.mockResolvedValue({ count: 0 });
  workspaceFindUniqueOrThrowMock.mockResolvedValue({ id: "workspace-id" });
  discoveryRunUpsertMock.mockResolvedValue({});
  discoveryRunUpdateMock.mockResolvedValue({});
});

describe("stageDiscoveredPeople — rawResponse preservation (BL-027)", () => {
  it("creates a DiscoveryRun and stamps icpProfileVersionId on staged rows", async () => {
    createManyMock.mockResolvedValueOnce({ count: 1 });

    await stageDiscoveredPeople({
      people: [
        {
          firstName: "Terry",
          lastName: "Transport",
          jobTitle: "Founder",
          company: "Haulage Co",
          companyDomain: "haulage.example",
        },
      ],
      discoverySource: "prospeo",
      workspaceSlug: "test-ws",
      discoveryRunId: "run-1",
      discoveryRunContext: {
        workspaceId: "workspace-id",
        icpProfileId: "profile-1",
        icpProfileVersionId: "version-1",
        icpProfileSnapshot: { description: "Transport ICP" },
        triggeredBy: "agent",
        triggeredVia: "search-prospeo",
      },
      icpProfileVersionId: "version-1",
    });

    expect(discoveryRunUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        create: expect.objectContaining({
          id: "run-1",
          workspaceId: "workspace-id",
          icpProfileId: "profile-1",
          icpProfileVersionId: "version-1",
          triggeredVia: "search-prospeo",
        }),
      }),
    );

    const data = createManyMock.mock.calls[0][0].data as Array<{
      icpProfileVersionId: string | null;
    }>;
    expect(data[0].icpProfileVersionId).toBe("version-1");
    expect(discoveryRunUpdateMock).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { discoveredCount: { increment: 1 } },
    });
  });

  it("writes sourceId to the dedicated column when person.sourceId is set", async () => {
    const people: DiscoveredPersonResult[] = [
      {
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "CTO",
        company: "Analytical Engines",
        companyDomain: "analytical.example",
        linkedinUrl: "https://linkedin.com/in/ada-lovelace",
        sourceId: "prospeo-person-123",
      },
    ];

    createManyMock.mockResolvedValueOnce({ count: 1 });

    await stageDiscoveredPeople({
      people,
      discoverySource: "prospeo",
      workspaceSlug: "test-ws",
      searchQuery: "test",
      // rawResponses omitted on purpose — pre-BL-027 behaviour
    });

    expect(createManyMock).toHaveBeenCalledTimes(1);
    const data = createManyMock.mock.calls[0][0].data as Array<{
      rawResponse: string | null;
      sourceId: string | null;
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].sourceId).toBe("prospeo-person-123");
    expect(data[0].rawResponse).toBeNull();
  });

  it("persists raw response blob separately from sourceId when both are provided (BL-027 primary path)", async () => {
    const rawBlob = {
      person: {
        person_id: "prospeo-person-456",
        first_name: "Grace",
        last_name: "Hopper",
      },
      company: { name: "UNIVAC", domain: "univac.example" },
    };

    const people: DiscoveredPersonResult[] = [
      {
        firstName: "Grace",
        lastName: "Hopper",
        jobTitle: "Rear Admiral",
        company: "UNIVAC",
        companyDomain: "univac.example",
        sourceId: "prospeo-person-456",
      },
    ];

    createManyMock.mockResolvedValueOnce({ count: 1 });

    await stageDiscoveredPeople({
      people,
      discoverySource: "prospeo",
      workspaceSlug: "test-ws",
      searchQuery: "test",
      rawResponses: [rawBlob],
    });

    const data = createManyMock.mock.calls[0][0].data as Array<{
      rawResponse: string | null;
      sourceId: string | null;
    }>;
    expect(data[0].rawResponse).not.toBeNull();
    expect(data[0].sourceId).toBe("prospeo-person-456");

    const parsed = JSON.parse(data[0].rawResponse!);
    // Full blob survives
    expect(parsed.person.person_id).toBe("prospeo-person-456");
    expect(parsed.company.domain).toBe("univac.example");
    expect(parsed._discoverySourceId).toBeUndefined();
  });

  it("leaves rawResponse null when no sourceId and no rawResponses are provided", async () => {
    const people: DiscoveredPersonResult[] = [
      {
        firstName: "Anonymous",
        lastName: "Dev",
        jobTitle: "IC",
        company: "Mystery Co",
        companyDomain: "mystery.example",
        // no sourceId
      },
    ];

    createManyMock.mockResolvedValueOnce({ count: 1 });

    await stageDiscoveredPeople({
      people,
      discoverySource: "firecrawl",
      workspaceSlug: "test-ws",
    });

    const data = createManyMock.mock.calls[0][0].data as Array<{
      rawResponse: string | null;
      sourceId: string | null;
    }>;
    expect(data[0].rawResponse).toBeNull();
    expect(data[0].sourceId).toBeNull();
  });

  it("uses rawResponses parallel array when provided (AI Ark-shaped payload)", async () => {
    const sharedRaw = {
      content: [{ id: "aiark-abc", profile: { first_name: "Alan" } }],
      totalElements: 1,
    };

    const people: DiscoveredPersonResult[] = [
      {
        firstName: "Alan",
        lastName: "Turing",
        jobTitle: "Cryptanalyst",
        company: "Bletchley Park",
        companyDomain: "bletchley.example",
        sourceId: "aiark-abc",
      },
    ];

    createManyMock.mockResolvedValueOnce({ count: 1 });

    await stageDiscoveredPeople({
      people,
      discoverySource: "aiark",
      workspaceSlug: "test-ws",
      rawResponses: [sharedRaw],
    });

    const data = createManyMock.mock.calls[0][0].data as Array<{
      rawResponse: string | null;
      sourceId: string | null;
    }>;
    expect(data[0].rawResponse).not.toBeNull();
    expect(data[0].sourceId).toBe("aiark-abc");

    const parsed = JSON.parse(data[0].rawResponse!);
    expect(parsed.content[0].id).toBe("aiark-abc");
    expect(parsed._discoverySourceId).toBeUndefined();
  });

  it("keeps the richer intra-batch duplicate record and avoids per-person duplicate queries", async () => {
    const people: DiscoveredPersonResult[] = [
      {
        firstName: "J.",
        lastName: "Smith",
        company: "Acme",
        companyDomain: "acme.com",
        linkedinUrl: "https://linkedin.com/in/j-smith",
      },
      {
        firstName: "John",
        lastName: "Smith",
        jobTitle: "Head of Sales",
        company: "Acme",
        companyDomain: "acme.com",
        linkedinUrl: "https://linkedin.com/in/j-smith",
        location: "London",
      },
    ];

    createManyMock.mockResolvedValueOnce({ count: 1 });

    await stageDiscoveredPeople({
      people,
      discoverySource: "apollo",
      workspaceSlug: "test-ws",
    });

    expect(findFirstMock).not.toHaveBeenCalled();
    expect(createManyMock).toHaveBeenCalledTimes(1);
    const data = createManyMock.mock.calls[0][0].data as Array<{
      firstName: string | null;
      jobTitle: string | null;
      location: string | null;
    }>;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      firstName: "John",
      jobTitle: "Head of Sales",
      location: "London",
    });
  });
});
