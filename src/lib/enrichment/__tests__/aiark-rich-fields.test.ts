import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiarkPersonAdapter } from "../providers/aiark-person";
import {
  extractAiArkPeople,
  mapAiArkCompanyData,
  mapAiArkPersonData,
} from "../providers/aiark-mapping";

const aiarkPersonRecord = {
  id: "aiark-person-1",
  identifier: "rami-skooti-4b8195279",
  profile: {
    first_name: "Rami",
    last_name: "Skooti",
    title: "Corporate Partnerships Manager",
    headline: "Executive Education",
    summary: "Builds executive education partnerships.",
    picture: { source: "https://images.ai-ark.com/person.jpg" },
  },
  link: {
    linkedin: "https://www.linkedin.com/in/rami-skooti-4b8195279",
    twitter: null,
    github: null,
    facebook: null,
  },
  location: {
    city: "Phoenix",
    state: "Arizona",
    country: "United States",
    default: "Phoenix, Arizona, United States, North America",
  },
  department: {
    seniority: "manager",
    departments: ["education"],
    functions: ["education", "business_development"],
  },
  skills: ["Sales Development", "Relationship Building"],
  position_groups: [
    {
      company: { id: "aiark-company-1", name: "Thunderbird School" },
      profile_positions: [{ title: "Corporate Partnerships Manager" }],
    },
  ],
  educations: [{ school: { name: "Thunderbird" }, degree_name: "Master" }],
  certifications: [{ name: "Learning Program Management", authority: "LinkedIn" }],
  languages: {
    profile_languages: [{ name: "Arabic", proficiency: "NATIVE_OR_BILINGUAL" }],
  },
  company: {
    id: "aiark-company-1",
    summary: {
      name: "Thunderbird School of Global Management",
      industry: "higher education",
      description: "Global leadership school",
      type: "EDUCATIONAL",
      staff: { total: 737 },
      founded_year: 1946,
    },
    link: {
      domain: "asu.edu",
      website: "http://www.thunderbird.asu.edu",
      linkedin: "https://www.linkedin.com/school/thunderbird",
      twitter: "https://x.com/thunderbird",
      facebook: "http://www.facebook.com/ThunderbirdSchool",
      crunchbase: "https://www.crunchbase.com/organization/thunderbird",
    },
    location: {
      headquarter: {
        raw_address: "401 N 1st St, Phoenix, Arizona, United States, North America",
        city: "Phoenix",
        state: "Arizona",
        country: "United States",
        postal_code: "85004",
      },
      locations: [{ city: "Phoenix", country: "United States" }],
    },
    financial: {
      revenue: { annual: { amount: "25000000-50000000", start: 25000000, end: 50000000 } },
      aberdeen: { it_spend: 4404683 },
    },
    technologies: [{ name: "html5" }, { name: "office 365" }],
    industries: ["higher education", "executive education"],
    naics: ["611310"],
    keywords: ["global management"],
    hashtags: ["leadership"],
  },
};

const aiarkEnvelope = {
  content: [aiarkPersonRecord],
  size: 25,
  totalElements: 1,
  numberOfElements: 1,
  trackId: "track-1",
};

describe("AI Ark rich field mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("AIARK_API_KEY", "test-key");
  });

  it("extracts nested content[] records from live-shaped envelopes", () => {
    expect(extractAiArkPeople(aiarkEnvelope)).toEqual([aiarkPersonRecord]);
  });

  it("maps nested person and company graph fields", () => {
    const person = mapAiArkPersonData(aiarkPersonRecord);
    const company = mapAiArkCompanyData(aiarkPersonRecord);

    expect(person).toMatchObject({
      firstName: "Rami",
      lastName: "Skooti",
      jobTitle: "Corporate Partnerships Manager",
      headline: "Executive Education",
      profileSummary: "Builds executive education partnerships.",
      profileImageUrl: "https://images.ai-ark.com/person.jpg",
      linkedinUrl: "https://www.linkedin.com/in/rami-skooti-4b8195279",
      location: "Phoenix, Arizona, United States, North America",
      locationCity: "Phoenix",
      locationState: "Arizona",
      locationCountry: "United States",
      seniority: "manager",
      departments: ["education"],
      functions: ["education", "business_development"],
      skills: ["Sales Development", "Relationship Building"],
      jobHistory: aiarkPersonRecord.position_groups,
      education: aiarkPersonRecord.educations,
      certifications: aiarkPersonRecord.certifications,
      languages: aiarkPersonRecord.languages,
      company: "Thunderbird School of Global Management",
      companyDomain: "asu.edu",
      providerIds: { aiarkPersonId: "aiark-person-1" },
    });

    expect(company.domain).toBe("asu.edu");
    expect(company.data).toMatchObject({
      name: "Thunderbird School of Global Management",
      industry: "higher education",
      description: "Global leadership school",
      companyType: "EDUCATIONAL",
      headcount: 737,
      yearFounded: 1946,
      website: "http://www.thunderbird.asu.edu",
      linkedinUrl: "https://www.linkedin.com/school/thunderbird",
      socialUrls: {
        linkedin: "https://www.linkedin.com/school/thunderbird",
        twitter: "https://x.com/thunderbird",
        facebook: "http://www.facebook.com/ThunderbirdSchool",
        crunchbase: "https://www.crunchbase.com/organization/thunderbird",
      },
      hqAddress: "401 N 1st St, Phoenix, Arizona, United States, North America",
      hqCity: "Phoenix",
      hqState: "Arizona",
      hqCountry: "United States",
      hqPostalCode: "85004",
      officeLocations: aiarkPersonRecord.company.location.locations,
      revenue: "25000000-50000000",
      itSpend: BigInt(4404683),
      technologies: aiarkPersonRecord.company.technologies,
      industries: ["higher education", "executive education"],
      naicsCodes: ["611310"],
      companyKeywords: ["global management"],
      hashtags: ["leadership"],
      providerIds: { aiarkCompanyId: "aiark-company-1" },
    });
  });

  it("aiark-person adapter maps nested content[] instead of silently writing nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => aiarkEnvelope,
    } as Response);

    const result = await aiarkPersonAdapter({
      linkedinUrl: "https://www.linkedin.com/in/rami-skooti-4b8195279",
    });

    expect(result.firstName).toBe("Rami");
    expect(result.profileSummary).toBe("Builds executive education partnerships.");
    expect(result.providerIds).toEqual({ aiarkPersonId: "aiark-person-1" });
    expect(result.companyData).toMatchObject({
      providerIds: { aiarkCompanyId: "aiark-company-1" },
      socialUrls: {
        linkedin: "https://www.linkedin.com/school/thunderbird",
        twitter: "https://x.com/thunderbird",
      },
    });
    expect(result.rawResponse).toBe(aiarkEnvelope);
  });

});
