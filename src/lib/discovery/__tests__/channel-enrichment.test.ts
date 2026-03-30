import { describe, it, expect } from "vitest";
import {
  getCampaignChannels,
  getEnrichmentProfile,
  shouldSkipEmailEnrichment,
  getUnverifiedRoutingSuggestion,
} from "../channel-enrichment";

describe("getCampaignChannels", () => {
  it("parses valid JSON email channel", () => {
    expect(getCampaignChannels({ channels: '["email"]' })).toEqual(["email"]);
  });

  it("parses valid JSON linkedin channel", () => {
    expect(getCampaignChannels({ channels: '["linkedin"]' })).toEqual(["linkedin"]);
  });

  it("parses multi-channel JSON", () => {
    expect(getCampaignChannels({ channels: '["email","linkedin"]' })).toEqual([
      "email",
      "linkedin",
    ]);
  });

  it("defaults to email on invalid JSON", () => {
    expect(getCampaignChannels({ channels: "not-json" })).toEqual(["email"]);
  });

  it("defaults to email on empty string", () => {
    expect(getCampaignChannels({ channels: "" })).toEqual(["email"]);
  });

  it("defaults to email on empty array JSON", () => {
    expect(getCampaignChannels({ channels: "[]" })).toEqual(["email"]);
  });
});

describe("getEnrichmentProfile", () => {
  it("returns linkedin-only for single linkedin channel", () => {
    expect(getEnrichmentProfile(["linkedin"])).toBe("linkedin-only");
  });

  it("returns full for single email channel", () => {
    expect(getEnrichmentProfile(["email"])).toBe("full");
  });

  it("returns full for multi-channel", () => {
    expect(getEnrichmentProfile(["email", "linkedin"])).toBe("full");
  });

  it("returns full for empty array", () => {
    expect(getEnrichmentProfile([])).toBe("full");
  });
});

describe("shouldSkipEmailEnrichment", () => {
  it("returns true for linkedin-only", () => {
    expect(shouldSkipEmailEnrichment(["linkedin"])).toBe(true);
  });

  it("returns false for email", () => {
    expect(shouldSkipEmailEnrichment(["email"])).toBe(false);
  });

  it("returns false for email+linkedin", () => {
    expect(shouldSkipEmailEnrichment(["email", "linkedin"])).toBe(false);
  });
});

describe("getUnverifiedRoutingSuggestion", () => {
  it("reports all emails for full-email list", () => {
    const result = getUnverifiedRoutingSuggestion([
      { email: "a@x.com", linkedinUrl: null },
      { email: "b@x.com", linkedinUrl: null },
    ]);
    expect(result.totalWithEmail).toBe(2);
    expect(result.noEmailCount).toBe(0);
    expect(result.suggestion).toContain("LeadMagic verification");
  });

  it("reports no-email leads", () => {
    const result = getUnverifiedRoutingSuggestion([
      { email: null, linkedinUrl: "https://linkedin.com/in/a" },
      { email: null, linkedinUrl: "https://linkedin.com/in/b" },
    ]);
    expect(result.totalWithEmail).toBe(0);
    expect(result.noEmailCount).toBe(2);
    expect(result.suggestion).toContain("no email");
  });

  it("handles mixed list", () => {
    const result = getUnverifiedRoutingSuggestion([
      { email: "a@x.com", linkedinUrl: null },
      { email: null, linkedinUrl: "https://linkedin.com/in/b" },
      { email: "c@x.com", linkedinUrl: "https://linkedin.com/in/c" },
    ]);
    expect(result.totalWithEmail).toBe(2);
    expect(result.noEmailCount).toBe(1);
  });

  it("excludes placeholder emails from totalWithEmail", () => {
    const result = getUnverifiedRoutingSuggestion([
      { email: "placeholder-abc@discovery.internal", linkedinUrl: null },
      { email: "real@acme.com", linkedinUrl: null },
    ]);
    expect(result.totalWithEmail).toBe(1);
    expect(result.noEmailCount).toBe(1);
  });

  it("returns informative message for empty array", () => {
    const result = getUnverifiedRoutingSuggestion([]);
    expect(result.suggestion).toBe("No leads to assess.");
  });

  it("sets verification counts to 0 at staging time", () => {
    const result = getUnverifiedRoutingSuggestion([
      { email: "a@x.com", linkedinUrl: null },
    ]);
    expect(result.verifiedCount).toBe(0);
    expect(result.catchAllCount).toBe(0);
    expect(result.unverifiedCount).toBe(0);
  });
});
