import { describe, it, expect } from "vitest";
import {
  validateListForChannel,
  runDataQualityPreCheck,
} from "@/lib/campaigns/list-validation";

describe("validateListForChannel", () => {
  describe("email channel", () => {
    it("returns hard failure when 0 people have verified emails", () => {
      const result = validateListForChannel("email", [
        { firstName: "John", company: "Acme" },
        { firstName: "Jane", company: "Beta", email: "" },
        { firstName: "Bob", company: "Gamma", email: null },
      ]);
      expect(result.valid).toBe(false);
      expect(result.hardFailures).toContain("0 verified emails in this list");
    });

    it("returns valid when at least one person has email", () => {
      const result = validateListForChannel("email", [
        { firstName: "John", email: "john@acme.com" },
        { firstName: "Jane" },
      ]);
      expect(result.valid).toBe(true);
      expect(result.hardFailures).toHaveLength(0);
    });

    it("returns soft warning when LinkedIn URL preferred but missing", () => {
      const result = validateListForChannel("email", [
        { firstName: "John", email: "john@acme.com" },
        { firstName: "Jane", email: "jane@beta.com", linkedinUrl: "https://linkedin.com/in/jane" },
      ]);
      expect(result.valid).toBe(true);
      expect(result.softWarnings.length).toBeGreaterThan(0);
      expect(result.softWarnings[0]).toContain("missing LinkedIn URL");
    });

    it("returns hard failure for empty list", () => {
      const result = validateListForChannel("email", []);
      expect(result.valid).toBe(false);
      expect(result.hardFailures[0]).toContain("empty");
    });
  });

  describe("linkedin channel", () => {
    it("returns hard failure when person is missing linkedinUrl", () => {
      const result = validateListForChannel("linkedin", [
        { firstName: "John", jobTitle: "CTO", company: "Acme" },
      ]);
      expect(result.valid).toBe(false);
      expect(result.hardFailures.some((f) => f.includes("linkedinUrl"))).toBe(true);
    });

    it("returns hard failure when person is missing firstName", () => {
      const result = validateListForChannel("linkedin", [
        { linkedinUrl: "https://linkedin.com/in/john", jobTitle: "CTO", company: "Acme" },
      ]);
      expect(result.valid).toBe(false);
      expect(result.hardFailures.some((f) => f.includes("firstName"))).toBe(true);
    });

    it("returns hard failure when person is missing jobTitle", () => {
      const result = validateListForChannel("linkedin", [
        { linkedinUrl: "https://linkedin.com/in/john", firstName: "John", company: "Acme" },
      ]);
      expect(result.valid).toBe(false);
      expect(result.hardFailures.some((f) => f.includes("jobTitle"))).toBe(true);
    });

    it("returns hard failure when person is missing company", () => {
      const result = validateListForChannel("linkedin", [
        { linkedinUrl: "https://linkedin.com/in/john", firstName: "John", jobTitle: "CTO" },
      ]);
      expect(result.valid).toBe(false);
      expect(result.hardFailures.some((f) => f.includes("company"))).toBe(true);
    });

    it("returns valid when all required fields present", () => {
      const result = validateListForChannel("linkedin", [
        {
          linkedinUrl: "https://linkedin.com/in/john",
          firstName: "John",
          jobTitle: "CTO",
          company: "Acme",
        },
      ]);
      expect(result.valid).toBe(true);
      expect(result.hardFailures).toHaveLength(0);
    });

    it("reports which fields are missing for which people", () => {
      const result = validateListForChannel("linkedin", [
        { firstName: "John", jobTitle: "CTO", company: "Acme" }, // missing linkedinUrl
        { linkedinUrl: "https://linkedin.com/in/jane", jobTitle: "VP", company: "Beta" }, // missing firstName
      ]);
      expect(result.valid).toBe(false);
      expect(result.hardFailures.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("runDataQualityPreCheck", () => {
  it("returns warning when less than 80% of leads have firstName AND company", () => {
    const people = [
      { email: "a@a.com", firstName: "A", company: "Acme" },
      { email: "b@b.com", firstName: "B" }, // no company
      { email: "c@c.com" }, // no firstName or company
      { email: "d@d.com" }, // no firstName or company
      { email: "e@e.com" }, // no firstName or company
    ];
    const report = runDataQualityPreCheck(["email"], people);
    expect(report.pass).toBe(false);
    expect(report.firstNameAndCompanyPct).toBe(20);
    expect(report.warnings.some((w) => w.includes("20%"))).toBe(true);
  });

  it("returns pass when >= 80% have firstName AND company", () => {
    const people = [
      { email: "a@a.com", firstName: "A", company: "Acme" },
      { email: "b@b.com", firstName: "B", company: "Beta" },
      { email: "c@c.com", firstName: "C", company: "Gamma" },
      { email: "d@d.com", firstName: "D", company: "Delta" },
      { email: "e@e.com" }, // 80% still have both
    ];
    const report = runDataQualityPreCheck(["email"], people);
    expect(report.firstNameAndCompanyPct).toBe(80);
    expect(report.pass).toBe(true);
  });

  it("returns channel-specific report: verified email count for email campaigns", () => {
    const people = [
      { email: "a@a.com", firstName: "A", company: "Acme" },
      { firstName: "B", company: "Beta" }, // no email
      { email: "c@c.com", firstName: "C", company: "Gamma" },
    ];
    const report = runDataQualityPreCheck(["email"], people);
    const emailReport = report.channelReport.find((r) => r.channel === "email");
    expect(emailReport).toBeDefined();
    expect(emailReport!.eligible).toBe(2);
    expect(emailReport!.ineligible).toBe(1);
  });

  it("returns channel-specific report: LinkedIn-complete count for LinkedIn campaigns", () => {
    const people = [
      { linkedinUrl: "https://li.com/1", firstName: "A", jobTitle: "CTO", company: "Acme" },
      { linkedinUrl: "https://li.com/2", firstName: "B", company: "Beta" }, // no jobTitle
      { firstName: "C", jobTitle: "VP", company: "Gamma" }, // no linkedinUrl
    ];
    const report = runDataQualityPreCheck(["linkedin"], people);
    const linkedinReport = report.channelReport.find((r) => r.channel === "linkedin");
    expect(linkedinReport).toBeDefined();
    expect(linkedinReport!.eligible).toBe(1);
    expect(linkedinReport!.ineligible).toBe(2);
  });

  it("fails when channel has 0 eligible people", () => {
    const people = [
      { firstName: "A", company: "Acme" }, // no email
    ];
    const report = runDataQualityPreCheck(["email"], people);
    expect(report.pass).toBe(false);
  });
});
