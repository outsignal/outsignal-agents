import { describe, expect, it } from "vitest";
import { narrowIcpProfileFilters } from "../filter-narrowing";
import type { IcpProfileSnapshot } from "../resolver";

const snapshot: IcpProfileSnapshot = {
  profileId: "profile-1",
  profileName: "Transport",
  profileSlug: "transport",
  versionId: "version-1",
  version: 1,
  description: "Transport ICP",
  targetTitles: ["Founder", "Co-Founder", "Managing Director"],
  locations: ["United Kingdom"],
  industries: ["Transportation", "Logistics"],
  companySizes: ["1-10", "11-50"],
  scoringRubric: null,
};

describe("narrowIcpProfileFilters", () => {
  it("uses profile values when request omits a scoped filter", () => {
    expect(narrowIcpProfileFilters({}, snapshot)).toMatchObject({
      jobTitles: ["Founder", "Co-Founder", "Managing Director"],
      locations: ["United Kingdom"],
      industries: ["Transportation", "Logistics"],
      companySizes: ["1-10", "11-50"],
    });
  });

  it("allows request filters that narrow the profile scope", () => {
    expect(
      narrowIcpProfileFilters(
        {
          jobTitles: ["Founder"],
          industries: ["Logistics"],
          companySizes: ["11-50"],
        },
        snapshot,
      ),
    ).toMatchObject({
      jobTitles: ["Founder"],
      industries: ["Logistics"],
      companySizes: ["11-50"],
      locations: ["United Kingdom"],
    });
  });

  it("rejects request filters that broaden the profile scope", () => {
    expect(() =>
      narrowIcpProfileFilters({ jobTitles: ["Finance Director"] }, snapshot),
    ).toThrow("Request jobTitles value(s) outside ICP profile scope: Finance Director");
  });

  it("treats null profile arrays as open scope", () => {
    expect(
      narrowIcpProfileFilters(
        { jobTitles: ["Finance Director"] },
        { ...snapshot, targetTitles: null },
      ),
    ).toMatchObject({ jobTitles: ["Finance Director"] });
  });
});
