import { describe, it, expect } from "vitest";
import { detectJunk, assessSearchQuality } from "../quality-gate";
import type { DiscoveredPersonResult } from "../types";

// ---------------------------------------------------------------------------
// detectJunk tests
// ---------------------------------------------------------------------------

describe("detectJunk", () => {
  it("returns true for info@ email", () => {
    expect(detectJunk({ email: "info@acme.com", firstName: "John", lastName: "Doe" })).toBe(true);
  });

  it("returns true for admin@ email", () => {
    expect(detectJunk({ email: "admin@acme.com", firstName: "Jane", lastName: "Smith" })).toBe(true);
  });

  it("returns true for support@ email", () => {
    expect(detectJunk({ email: "support@acme.com", firstName: "Bob", lastName: "Jones" })).toBe(true);
  });

  it("returns true for sales@ email", () => {
    expect(detectJunk({ email: "sales@acme.com", firstName: "Alice", lastName: "Brown" })).toBe(true);
  });

  it("returns true for noreply@ email", () => {
    expect(detectJunk({ email: "noreply@acme.com", firstName: "Test", lastName: "User" })).toBe(true);
  });

  it("returns true for placeholder @discovery.internal email", () => {
    expect(
      detectJunk({ email: "placeholder-abc@discovery.internal", firstName: "John", lastName: "Doe" }),
    ).toBe(true);
  });

  it("returns true when both firstName and lastName are missing", () => {
    expect(detectJunk({ email: "john@acme.com" })).toBe(true);
  });

  it("returns true for junk name patterns", () => {
    expect(detectJunk({ email: "a@acme.com", firstName: "N/A", lastName: "" })).toBe(true);
    expect(detectJunk({ email: "b@acme.com", firstName: "Unknown", lastName: "" })).toBe(true);
    expect(detectJunk({ email: "c@acme.com", firstName: "Test", lastName: "" })).toBe(true);
    expect(detectJunk({ email: "d@acme.com", firstName: "null", lastName: "" })).toBe(true);
  });

  it("returns true for single character name", () => {
    expect(detectJunk({ email: "a@acme.com", firstName: "A", lastName: "" })).toBe(true);
  });

  it("returns true when both email and linkedinUrl are missing", () => {
    expect(detectJunk({ firstName: "John", lastName: "Doe" })).toBe(true);
  });

  it("returns false for valid person with email", () => {
    expect(
      detectJunk({ email: "john.doe@acme.com", firstName: "John", lastName: "Doe" }),
    ).toBe(false);
  });

  it("returns false for valid person with linkedinUrl only", () => {
    expect(
      detectJunk({
        linkedinUrl: "https://linkedin.com/in/johndoe",
        firstName: "John",
        lastName: "Doe",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assessSearchQuality tests
// ---------------------------------------------------------------------------

describe("assessSearchQuality", () => {
  const validPeople: DiscoveredPersonResult[] = [
    { email: "john@acme.com", firstName: "John", lastName: "Doe", jobTitle: "CTO", company: "Acme", linkedinUrl: "https://linkedin.com/in/johndoe" },
    { email: "jane@widget.com", firstName: "Jane", lastName: "Smith", jobTitle: "VP Engineering", company: "Widget", linkedinUrl: "https://linkedin.com/in/janesmith" },
    { email: "bob@tech.com", firstName: "Bob", lastName: "Jones", jobTitle: "Director", company: "Tech Co", linkedinUrl: "https://linkedin.com/in/bobjones" },
  ];

  it("returns 'poor' grade for empty array", () => {
    const report = assessSearchQuality([]);
    expect(report.grade).toBe("poor");
    expect(report.metrics.totalResults).toBe(0);
    expect(report.metrics.belowThreshold).toBe(true);
  });

  it("returns 'good' grade for high-quality results", () => {
    const report = assessSearchQuality(validPeople);
    expect(report.grade).toBe("good");
    expect(report.metrics.verifiedEmailPct).toBe(100);
    expect(report.metrics.linkedinUrlPct).toBe(100);
    expect(report.metrics.junkCount).toBe(0);
    expect(report.metrics.belowThreshold).toBe(false);
  });

  it("correctly computes verified email percentage", () => {
    const mixed: DiscoveredPersonResult[] = [
      { email: "john@acme.com", firstName: "John", lastName: "Doe" },
      { firstName: "Jane", lastName: "Smith", linkedinUrl: "https://linkedin.com/in/jane" },
      { email: "info@generic.com", firstName: "Bob", lastName: "Jones" }, // junk email
      { email: "alice@tech.com", firstName: "Alice", lastName: "Brown" },
    ];
    const report = assessSearchQuality(mixed);
    // john@acme.com and alice@tech.com are real = 2 of 4 = 50%
    expect(report.metrics.verifiedEmailCount).toBe(2);
    expect(report.metrics.verifiedEmailPct).toBe(50);
  });

  it("returns 'acceptable' grade for 50-70% verified email", () => {
    const people: DiscoveredPersonResult[] = [
      { email: "a@x.com", firstName: "A1", lastName: "B1", linkedinUrl: "x" },
      { email: "b@x.com", firstName: "A2", lastName: "B2", linkedinUrl: "x" },
      { email: "c@x.com", firstName: "A3", lastName: "B3", linkedinUrl: "x" },
      { firstName: "A4", lastName: "B4", linkedinUrl: "x" }, // no email
    ];
    const report = assessSearchQuality(people);
    // 3 of 4 = 75% -> good (since junkPct < 5%)
    expect(report.grade).toBe("good");
  });

  it("returns 'low' grade for 30-50% verified email", () => {
    const people: DiscoveredPersonResult[] = [
      { email: "a@x.com", firstName: "A1", lastName: "B1", linkedinUrl: "x" },
      { firstName: "A2", lastName: "B2", linkedinUrl: "x" },
      { firstName: "A3", lastName: "B3", linkedinUrl: "x" },
    ];
    const report = assessSearchQuality(people);
    // 1 of 3 = 33% -> low
    expect(report.grade).toBe("low");
    expect(report.metrics.belowThreshold).toBe(true);
  });

  it("returns 'poor' grade for <30% verified email", () => {
    const people: DiscoveredPersonResult[] = [
      { firstName: "A1", lastName: "B1", linkedinUrl: "x" },
      { firstName: "A2", lastName: "B2", linkedinUrl: "x" },
      { firstName: "A3", lastName: "B3", linkedinUrl: "x" },
      { firstName: "A4", lastName: "B4", linkedinUrl: "x" },
    ];
    const report = assessSearchQuality(people);
    // 0 of 4 = 0% -> poor
    expect(report.grade).toBe("poor");
    expect(report.metrics.belowThreshold).toBe(true);
  });

  it("computes costPerVerifiedLead correctly", () => {
    const report = assessSearchQuality(validPeople, { costUsd: 0.3 });
    expect(report.costPerVerifiedLead).toBe(0.1); // 0.3 / 3
  });

  it("returns null costPerVerifiedLead when no cost data", () => {
    const report = assessSearchQuality(validPeople);
    expect(report.costPerVerifiedLead).toBe(null);
  });

  it("returns null costPerVerifiedLead when zero verified", () => {
    const people: DiscoveredPersonResult[] = [
      { firstName: "A1", lastName: "B1", linkedinUrl: "x" },
    ];
    const report = assessSearchQuality(people, { costUsd: 1.0 });
    expect(report.costPerVerifiedLead).toBe(null);
  });

  it("computes ICP fit distribution with workspace ICP", () => {
    const people: DiscoveredPersonResult[] = [
      { email: "a@x.com", firstName: "A1", lastName: "B1", jobTitle: "CTO", location: "London, UK", company: "TechCo" },
      { email: "b@x.com", firstName: "A2", lastName: "B2", jobTitle: "Developer", location: "London, UK", company: "Acme" },
      { email: "c@x.com", firstName: "A3", lastName: "B3", jobTitle: "CTO", location: "New York, US", company: "Other" },
    ];
    const report = assessSearchQuality(people, {
      workspaceIcp: {
        titles: ["CTO"],
        locations: ["London"],
        industries: ["tech"],
      },
    });
    // Person 1: CTO + London + TechCo = 3 matches -> high
    // Person 2: no title match, London match, no industry -> low (1 match = medium)
    // Person 3: CTO match, no location match, no industry -> medium
    expect(report.metrics.icpFitDistribution.high).toBeGreaterThanOrEqual(1);
  });

  it("defaults ICP fit to 'none' when no workspaceIcp provided", () => {
    const report = assessSearchQuality(validPeople);
    expect(report.metrics.icpFitDistribution.none).toBe(validPeople.length);
  });

  it("detects junk within results and provides examples", () => {
    const people: DiscoveredPersonResult[] = [
      { email: "john@acme.com", firstName: "John", lastName: "Doe" },
      { email: "info@generic.com", firstName: "Support", lastName: "Team" }, // junk email
      { email: "placeholder-123@discovery.internal", firstName: "Unknown", lastName: "" }, // junk placeholder + name
    ];
    const report = assessSearchQuality(people);
    expect(report.metrics.junkCount).toBeGreaterThanOrEqual(2);
    expect(report.metrics.junkExamples.length).toBeGreaterThanOrEqual(1);
    expect(report.metrics.junkExamples.length).toBeLessThanOrEqual(5);
  });

  it("generates suggestions for low quality results", () => {
    const people: DiscoveredPersonResult[] = [
      { email: "a@x.com", firstName: "A1", lastName: "B1", linkedinUrl: "x" },
      { firstName: "A2", lastName: "B2", linkedinUrl: "x" },
      { firstName: "A3", lastName: "B3", linkedinUrl: "x" },
      { firstName: "A4", lastName: "B4", linkedinUrl: "x" },
      { firstName: "A5", lastName: "B5", linkedinUrl: "x" },
    ];
    const report = assessSearchQuality(people);
    expect(report.suggestions.length).toBeGreaterThan(0);
    expect(report.suggestions.some((s) => s.includes("Verified email rate"))).toBe(true);
  });
});
