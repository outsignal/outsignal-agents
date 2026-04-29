import { describe, expect, it } from "vitest";
import { mapProspeoPayload } from "../providers/prospeo";

const liveShapedProspeoPayload = {
  identifier: "lead-1",
  person: {
    person_id: "prospeo-person-1",
    headline: "Founder at Acme Talent",
    skills: ["Recruiting", "Sales"],
    job_history: [
      {
        company_name: "Acme Talent",
        title: "Founder",
        current: true,
        start_year: 2022,
        departments: ["Founder"],
        seniority: "Founder",
      },
    ],
    mobile: {
      status: "VERIFIED",
      revealed: true,
      mobile: "+447700900123",
    },
    email: {
      status: "VERIFIED",
      revealed: true,
      email: "founder@acme.example",
    },
    location: {
      city: "London",
      state: "England",
      country: "United Kingdom",
      country_code: "GB",
    },
  },
  company: {
    company_id: "prospeo-company-1",
    name: "Acme Talent",
    domain: "acme.example",
    website: "https://acme.example",
    industry: "Staffing and Recruiting",
    employee_count: 27,
    linkedin_url: "https://www.linkedin.com/company/acme-talent",
    twitter_url: "https://twitter.com/acmetalent",
    phone_hq: {
      phone_hq: "+442071234567",
    },
    location: {
      raw_address: "1 Hiring Street, London, W1 1AA",
      city: "London",
      state: "England",
      country: "United Kingdom",
      country_code: "GB",
    },
    revenue_range_printed: "$1M-$10M",
    founded: 2021,
    technology: {
      count: 2,
      technology_names: ["Greenhouse", "HubSpot"],
      technology_list: [
        { name: "Greenhouse", category: "Recruiting" },
        { name: "HubSpot", category: "CRM" },
      ],
    },
    funding: null,
    job_postings: {
      active_count: 2,
      jobs: [
        { title: "Recruitment Consultant" },
        { title: "Account Executive" },
      ],
    },
  },
};

describe("Prospeo rich field mapping", () => {
  it("maps live-shaped person and company fields without flattening job history", () => {
    const result = mapProspeoPayload(liveShapedProspeoPayload);

    expect(result.email).toBe("founder@acme.example");
    expect(result.providerIds).toEqual({ prospeoPersonId: "prospeo-person-1" });
    expect(result.headline).toBe("Founder at Acme Talent");
    expect(result.skills).toEqual(["Recruiting", "Sales"]);
    expect(result.jobHistory).toEqual(liveShapedProspeoPayload.person.job_history);
    expect(result.mobilePhone).toBe("+447700900123");
    expect(result.locationCity).toBe("London");
    expect(result.locationCountryCode).toBe("GB");

    expect(result.companyData).toMatchObject({
      name: "Acme Talent",
      domain: "acme.example",
      industry: "Staffing and Recruiting",
      headcount: 27,
      revenue: "$1M-$10M",
      yearFounded: 2021,
      providerIds: { prospeoCompanyId: "prospeo-company-1" },
      hqPhone: "+442071234567",
      hqAddress: "1 Hiring Street, London, W1 1AA",
      hqCountryCode: "GB",
      socialUrls: {
        linkedin: "https://www.linkedin.com/company/acme-talent",
        twitter: "https://twitter.com/acmetalent",
      },
      technologies: liveShapedProspeoPayload.company.technology,
      jobPostingsActiveCount: 2,
      jobPostingTitles: ["Recruitment Consultant", "Account Executive"],
    });
  });

  it("does not persist masked mobile numbers when Prospeo has not revealed them", () => {
    const result = mapProspeoPayload({
      person: {
        person_id: "prospeo-person-2",
        mobile: {
          status: "VERIFIED",
          revealed: false,
          mobile: "+44 7700 ******",
        },
      },
    });

    expect(result.providerIds).toEqual({ prospeoPersonId: "prospeo-person-2" });
    expect(result.mobilePhone).toBeUndefined();
  });

  it("handles null funding and job postings defensively", () => {
    const result = mapProspeoPayload({
      company: {
        company_id: "prospeo-company-2",
        domain: "empty.example",
        funding: null,
        job_postings: null,
      },
    });

    expect(result.companyData?.providerIds).toEqual({ prospeoCompanyId: "prospeo-company-2" });
    expect(result.companyData?.fundingTotal).toBeUndefined();
    expect(result.companyData?.jobPostingsActiveCount).toBeUndefined();
  });
});
