import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiarkSearchAdapter } from "../adapters/aiark-search";

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
});
