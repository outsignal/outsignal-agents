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
      "IT Services and IT Consulting",
    ]);
  });

  it("maps representative client verticals into live-verified AI Ark taxonomy values", () => {
    const cases: Array<{
      workspace: string;
      industries: string[];
      expected: string[];
    }> = [
      {
        workspace: "Rise",
        industries: ["Branded Merchandise", "Promotional Products", "Apparel"],
        expected: ["Advertising Services", "Consumer Goods", "Retail", "Retail Apparel and Fashion"],
      },
      {
        workspace: "Lime Recruitment",
        industries: ["Staffing", "Recruitment", "Talent Acquisition"],
        expected: ["Staffing and Recruiting", "Recruiting", "Human Resources Services"],
      },
      {
        workspace: "YoopKnows",
        industries: ["Architecture & Planning", "AEC", "Design Services"],
        expected: ["Architecture and Planning", "Construction", "Civil Engineering", "Design Services"],
      },
      {
        workspace: "Outsignal",
        industries: ["B2B SaaS", "Marketing & Advertising"],
        expected: ["Software Development", "Enterprise Software", "Marketing", "Advertising Services", "Advertising"],
      },
      {
        workspace: "MyAcq",
        industries: ["Mergers & Acquisitions", "Private Equity", "Business Brokerage"],
        expected: [
          "Investment Management",
          "Financial Services",
          "Capital Markets",
          "Venture Capital and Private Equity Principals",
        ],
      },
      {
        workspace: "1210 legacy",
        industries: ["Recruitment Agencies", "Temp Agencies"],
        expected: ["Staffing and Recruiting", "Recruiting"],
      },
      {
        workspace: "BlankTag",
        industries: ["Digital Marketing", "Media", "Advertising"],
        expected: ["Digital Marketing", "Marketing", "Advertising Services", "Media Production", "Advertising"],
      },
      {
        workspace: "Covenco",
        industries: ["Cloud Computing", "Computer Networking", "Systems Integration"],
        expected: ["Cloud Computing", "IT Services and IT Consulting", "Computer Networking Products"],
      },
    ];

    for (const { workspace, industries, expected } of cases) {
      expect(mapIcpIndustriesToAiArk(industries), workspace).toEqual(expected);
    }
  });

  it("maps partial input and warns only for unknown AI Ark industry values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(mapIcpIndustriesToAiArk(["Transport", "Quantum Cryptography"])).toEqual([
      "Transportation",
      "Truck Transportation",
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Quantum Cryptography"),
    );

    warnSpy.mockRestore();
  });

  it("handles empty industry input without warnings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(mapIcpIndustriesToAiArk([])).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("maps AI Ark industry aliases case-insensitively", () => {
    expect(mapIcpIndustriesToAiArk(["TRANSPORT", "transportation"])).toEqual([
      "Transportation",
      "Truck Transportation",
    ]);
  });

  it("maps Data Storage as IT instead of warehousing", () => {
    expect(mapIcpIndustriesToAiArk(["Data Storage"])).toEqual([
      "Data Storage",
      "Information Technology",
    ]);
    expect(mapIcpIndustriesToAiArk(["Cloud Data Storage"])).toEqual([
      "Data Storage",
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
