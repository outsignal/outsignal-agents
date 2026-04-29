import { beforeEach, describe, expect, it, vi } from "vitest";

const runApifyActorMock = vi.fn();

vi.mock("../../apify/client", () => ({
  runApifyActor: (...args: unknown[]) => runApifyActorMock(...args),
}));

import {
  apifyLeadsFinderAdapter,
  mapLeadsFinderItem,
} from "../adapters/apify-leads-finder";

const docShapedLead = {
  email: "ada@apifyco.com",
  personal_email: "ada.personal@example.com",
  full_name: "Ada Lovelace",
  job_title: "Founder",
  headline: "Founder at Apify Co",
  linkedin: "https://linkedin.com/in/ada",
  mobile_number: "+447700900123",
  city: "London",
  state: "England",
  country: "United Kingdom",
  company_name: "Apify Co",
  company_domain: "apifyco.com",
  company_website: "https://apifyco.com",
  company_linkedin: "https://linkedin.com/company/apifyco",
  company_linkedin_uid: "123456",
  industry: "Staffing and Recruiting",
  company_description: "Recruiting platform",
  company_annual_revenue: "$1M-$10M",
  company_total_funding_clean: "1250000",
  company_founded_year: "2020",
  company_phone: "+442071234567",
  company_street_address: "1 Hiring Street",
  company_full_address: "1 Hiring Street, London",
  company_city: "London",
  company_state: "England",
  company_country: "United Kingdom",
  company_technologies: ["HubSpot", "Greenhouse"],
};

describe("Apify Leads Finder adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns per-lead rawResponses instead of only a shared rawResponse array", async () => {
    const secondLead = {
      ...docShapedLead,
      email: "grace@apifyco.com",
      first_name: "Grace",
      last_name: "Hopper",
      full_name: "Grace Hopper",
    };
    runApifyActorMock.mockResolvedValueOnce([docShapedLead, secondLead]);

    const result = await apifyLeadsFinderAdapter.search({ jobTitles: ["Founder"] }, 2);

    expect(result.people).toHaveLength(2);
    expect(result.rawResponse).toEqual([docShapedLead, secondLead]);
    expect(result.rawResponses).toEqual([docShapedLead, secondLead]);
    expect(result.rawResponses?.[0]).toBe(docShapedLead);
    expect(result.rawResponses?.[1]).toBe(secondLead);
  });

  it("maps doc-shaped fields into the common discovery shape without using dropped fields", () => {
    const result = mapLeadsFinderItem(docShapedLead);

    expect(result).toEqual({
      email: "ada@apifyco.com",
      firstName: "Ada",
      lastName: "Lovelace",
      jobTitle: "Founder",
      linkedinUrl: "https://linkedin.com/in/ada",
      company: "Apify Co",
      companyDomain: "apifyco.com",
      location: "London, England, United Kingdom",
    });
  });

  it("prefers explicit first and last names over full_name fallback", () => {
    const result = mapLeadsFinderItem({
      full_name: "Fallback Name",
      first_name: "Ada",
      last_name: "Lovelace",
    });

    expect(result.firstName).toBe("Ada");
    expect(result.lastName).toBe("Lovelace");
  });
});
