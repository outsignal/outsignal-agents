import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma — `stageDiscoveredPeople` needs findMany (dedup check) and
// createMany (insert). We capture the data passed to createMany so tests
// can inspect the `rawResponse` field the staging helper generates.
const createManyMock = vi.fn();
const findManyMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
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
});

describe("stageDiscoveredPeople — rawResponse preservation (BL-027)", () => {
  it("embeds _discoverySourceId when person.sourceId is set and rawResponses is omitted", async () => {
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
    }>;
    expect(data).toHaveLength(1);
    expect(data[0].rawResponse).not.toBeNull();

    const parsed = JSON.parse(data[0].rawResponse!);
    expect(parsed._discoverySourceId).toBe("prospeo-person-123");
  });

  it("merges raw response blob with sourceId when both are provided (BL-027 primary path)", async () => {
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
    }>;
    expect(data[0].rawResponse).not.toBeNull();

    const parsed = JSON.parse(data[0].rawResponse!);
    // Full blob survives
    expect(parsed.person.person_id).toBe("prospeo-person-456");
    expect(parsed.company.domain).toBe("univac.example");
    // sourceId is also embedded so promotion.extractSourceId() finds it
    expect(parsed._discoverySourceId).toBe("prospeo-person-456");
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
    }>;
    expect(data[0].rawResponse).toBeNull();
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
    }>;
    expect(data[0].rawResponse).not.toBeNull();

    const parsed = JSON.parse(data[0].rawResponse!);
    expect(parsed.content[0].id).toBe("aiark-abc");
    expect(parsed._discoverySourceId).toBe("aiark-abc");
  });
});
