import { describe, expect, it } from "vitest";

import { buildScoringPrompt } from "../scorer";

describe("buildScoringPrompt Tier 2 fields", () => {
  it("renders high-value person and company Tier 2 fields defensively", () => {
    const longSummary = `${"Founder ".repeat(90)}tail`;

    const prompt = buildScoringPrompt({
      person: {
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "Founder",
        headline: "Founder building recruitment automation",
        skills: [
          "Recruiting",
          "Sales",
          "Automation",
          "Leadership",
          "Partnerships",
          "Operations",
          "Marketing",
          "RevOps",
          "Should Not Render",
        ],
        jobHistory: [
          {
            company: "Older Talent",
            title: "Director",
            start: "2019-01-01",
            end: "2021-12-31",
          },
          {
            company: "Current Talent",
            title: "Founder",
            start: "2024-02-01",
            current: true,
          },
          {
            company: { name: "Middle Talent" },
            title: "VP Sales",
            start: "2022",
            end: "2024",
          },
          {
            company: "Oldest Talent",
            title: "Manager",
            start: "2016",
            end: "2018",
          },
        ],
        profileSummary: longSummary,
        education: [
          { school: { name: "University of London" }, degree_name: "MBA", field_of_study: "Strategy" },
          { institution: "Oxford", degree: "BA" },
          { institution: "Should Not Render" },
        ],
        certifications: [
          { name: "Recruitment Leadership" },
          "HubSpot Sales",
          { title: "LinkedIn Recruiter" },
          { name: "Should Not Render" },
        ],
        languages: {
          profile_languages: [
            { name: "English" },
            { language: "French" },
          ],
        },
        company: "Analytical Talent",
        vertical: "Staffing and Recruiting",
        location: "London",
        seniority: "Founder",
        enrichmentData: null,
      },
      company: {
        headcount: 42,
        industry: "Scalar industry should not win",
        industries: ["Staffing", "Recruiting"],
        description: "Specialist staffing consultancy",
        yearFounded: 2019,
        revenue: "$1M-$10M",
        technologies: ["HubSpot"],
        fundingTotal: BigInt(1234567),
        socialUrls: {
          linkedin: "https://www.linkedin.com/company/analytical-talent",
          twitter: "https://twitter.com/analytical",
          crunchbase: "https://www.crunchbase.com/organization/analytical-talent",
          empty: "",
        },
        jobPostingsActiveCount: 6,
        jobPostingTitles: [
          "Recruiter",
          { title: "Account Executive" },
          { name: "Talent Partner" },
          "Operations Lead",
          "Marketing Manager",
          "Should Not Render",
        ],
        naicsCodes: ["561311", { code: "561312" }, { naics: "541612" }, "Should Not Render"],
      },
      websiteMarkdown: "Homepage copy",
    });

    expect(prompt).toContain(
      "- Skills: Recruiting, Sales, Automation, Leadership, Partnerships, Operations, Marketing, RevOps",
    );
    expect(prompt).not.toContain("Should Not Render");
    expect(prompt).toContain(
      "- Career: 2024-Present Current Talent (Founder); 2022-2024 Middle Talent (VP Sales); 2019-2021 Older Talent (Director)",
    );
    expect(prompt).toContain("- Profile Summary: ");
    expect(prompt).toContain("...");
    expect(prompt).not.toContain("tail");
    expect(prompt).toContain("- Education: University of London - MBA - Strategy; Oxford - BA");
    expect(prompt).toContain("- Certifications: Recruitment Leadership, HubSpot Sales, LinkedIn Recruiter");
    expect(prompt).toContain("- Languages: English, French");
    expect(prompt).toContain("- Industry: Staffing, Recruiting");
    expect(prompt).toContain("- Social: Crunchbase ✓, LinkedIn ✓, Twitter ✓");
    expect(prompt).toContain(
      "- Currently hiring: 6 open roles (Recruiter, Account Executive, Talent Partner, Operations Lead, Marketing Manager)",
    );
    expect(prompt).toContain("- NAICS: 561311, 561312, 541612");
  });

  it("falls back cleanly for malformed JSON shapes and empty hiring signals", () => {
    const prompt = buildScoringPrompt({
      person: {
        firstName: null,
        lastName: null,
        jobTitle: null,
        headline: null,
        skills: "not-an-array",
        jobHistory: { not: "an-array" },
        profileSummary: "   ",
        education: "not-an-array",
        certifications: [null, {}, ""],
        languages: { profile_languages: "not-an-array" },
        company: null,
        vertical: null,
        location: null,
        seniority: null,
        enrichmentData: "{bad-json",
      },
      company: {
        headcount: null,
        industry: "Fallback industry",
        industries: "not-an-array",
        description: null,
        yearFounded: null,
        revenue: null,
        technologies: "not-an-array",
        fundingTotal: null,
        socialUrls: null,
        jobPostingsActiveCount: 0,
        jobPostingTitles: ["Ignored"],
        naicsCodes: "not-an-array",
      },
      websiteMarkdown: null,
    });

    expect(prompt).toContain("- Skills: Unknown");
    expect(prompt).toContain("- Career: Unknown");
    expect(prompt).toContain("- Profile Summary: Unknown");
    expect(prompt).toContain("- Education: Unknown");
    expect(prompt).toContain("- Certifications: Unknown");
    expect(prompt).toContain("- Languages: Unknown");
    expect(prompt).toContain("- Industry: Fallback industry");
    expect(prompt).toContain("- Social: Unknown");
    expect(prompt).toContain("- Hiring: None visible");
    expect(prompt).toContain("- NAICS: Unknown");
  });
});
