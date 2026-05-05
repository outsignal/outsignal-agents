import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiarkSearchAdapter,
  mapIcpIndustriesToAiArk,
} from "../adapters/aiark-search";

const aiarkPerson = {
  id: "aiark-person-1",
  profile: {
    first_name: "Rami",
    last_name: "Skooti",
    title: "Corporate Partnerships Manager",
    headline: "Executive Education",
  },
  link: {
    linkedin: "https://www.linkedin.com/in/rami-skooti-4b8195279",
  },
  location: {
    city: "Phoenix",
    state: "Arizona",
    country: "United States",
    default: "Phoenix, Arizona, United States, North America",
  },
  company: {
    summary: {
      name: "Thunderbird School of Global Management",
      industry: "higher education",
      staff: { total: 737 },
    },
    link: {
      domain: "asu.edu",
      linkedin: "https://www.linkedin.com/school/thunderbird",
    },
  },
};

describe("AI Ark search adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("AIARK_API_KEY", "test-key");
  });

  it("maps ICP industry prose into AI Ark taxonomy values", () => {
    expect(
      mapIcpIndustriesToAiArk([
        "Transport",
        "Logistics",
        "Haulage",
        "Freight Forwarding",
        "Road Transport",
        "Goods Transport",
        "Passenger Transport",
        "Trucking",
        "Distribution",
        "Warehousing",
        "Information Technology and Services",
      ]),
    ).toEqual([
      "Transportation",
      "Truck Transportation",
      "Logistics",
      "Transportation, Logistics, Supply Chain and Storage",
      "Freight and Package Transportation",
      "Warehousing and Storage",
      "Warehousing",
      "Information Technology",
    ]);
  });

  it("skips unknown AI Ark industry values instead of passing them through", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(mapIcpIndustriesToAiArk(["Quantum Umbrella Operators", "", "  "])).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Quantum Umbrella Operators"),
    );

    warnSpy.mockRestore();
  });

  it("returns per-person rawResponses parallel to mapped people", async () => {
    const secondPerson = {
      ...aiarkPerson,
      id: "aiark-person-2",
      profile: {
        ...aiarkPerson.profile,
        first_name: "Ada",
        last_name: "Lovelace",
      },
    };
    const raw = {
      content: [aiarkPerson, secondPerson],
      totalElements: 2,
      numberOfElements: 2,
      totalPages: 1,
      trackId: "track-1",
      pageable: { pageNumber: 0, pageSize: 2 },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => raw,
    } as Response);

    const result = await aiarkSearchAdapter.search({ jobTitles: ["Partnerships"] }, 2);

    expect(result.people).toHaveLength(2);
    expect(result.people[0]).toEqual({
        firstName: "Rami",
        lastName: "Skooti",
        jobTitle: "Corporate Partnerships Manager",
        linkedinUrl: "https://www.linkedin.com/in/rami-skooti-4b8195279",
        location: "Phoenix, Arizona, United States, North America",
        company: "Thunderbird School of Global Management",
        companyDomain: "asu.edu",
        sourceId: "aiark-person-1",
    });
    expect(result.people[1]?.firstName).toBe("Ada");
    expect(result.people[1]?.sourceId).toBe("aiark-person-2");
    expect(result.rawResponse).toBe(raw);
    expect(result.rawResponses).toEqual([aiarkPerson, secondPerson]);
  });

  it("sends mapped industries in the AI Ark request body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [],
        totalElements: 0,
        numberOfElements: 0,
        totalPages: 0,
      }),
    } as Response);

    await aiarkSearchAdapter.search(
      {
        jobTitles: ["Transport Manager"],
        locations: ["United Kingdom"],
        industries: ["Haulage", "Freight Forwarding"],
      },
      5,
    );

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body.account.industry).toEqual({
      any: {
        include: [
          "Truck Transportation",
          "Freight and Package Transportation",
          "Transportation, Logistics, Supply Chain and Storage",
        ],
      },
    });
  });

  it("omits account.industry when no ICP industries map to AI Ark taxonomy", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [],
        totalElements: 0,
        numberOfElements: 0,
        totalPages: 0,
      }),
    } as Response);

    await aiarkSearchAdapter.search(
      {
        jobTitles: ["Transport Manager"],
        locations: ["United Kingdom"],
        industries: ["Totally Unmapped Sector"],
      },
      5,
    );

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body.account).not.toHaveProperty("industry");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("omitting account.industry filter"),
    );
    warnSpy.mockRestore();
  });

  it("maps a known-good AI Ark search response with mapped industry filters", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        content: [aiarkPerson],
        totalElements: 1,
        numberOfElements: 1,
        totalPages: 1,
      }),
    } as Response);

    const result = await aiarkSearchAdapter.search(
      {
        jobTitles: ["Software Engineer"],
        locations: ["United Kingdom"],
        industries: ["Information Technology"],
      },
      1,
    );

    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body.account.industry).toEqual({
      any: { include: ["Information Technology"] },
    });
    expect(result.people).toHaveLength(1);
    expect(result.people[0]?.sourceId).toBe("aiark-person-1");
  });
});
