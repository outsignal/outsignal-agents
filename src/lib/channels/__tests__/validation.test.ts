import { describe, it, expect } from "vitest";
import {
  validatePersonForChannel,
  filterPeopleForChannels,
} from "@/lib/channels/validation";

// ---------------------------------------------------------------------------
// validatePersonForChannel — email channel
// ---------------------------------------------------------------------------

describe("validatePersonForChannel — email", () => {
  it("passes when email is present and valid", () => {
    const result = validatePersonForChannel({ email: "john@acme.com" }, "email");
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("fails when email is null", () => {
    const result = validatePersonForChannel({ email: null }, "email");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing email/i);
  });

  it("fails when email is undefined", () => {
    const result = validatePersonForChannel({}, "email");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing email/i);
  });

  it("fails when email is empty string", () => {
    const result = validatePersonForChannel({ email: "  " }, "email");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing email/i);
  });

  it("fails for @discovery.internal placeholder email", () => {
    const result = validatePersonForChannel(
      { email: "placeholder-abc123@discovery.internal" },
      "email",
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/placeholder/i);
  });

  it("fails for @discovered.local placeholder email", () => {
    const result = validatePersonForChannel(
      { email: "unknown-abc123@discovered.local" },
      "email",
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/placeholder/i);
  });

  it("placeholder detection is case-insensitive", () => {
    const result = validatePersonForChannel(
      { email: "someone@Discovery.Internal" },
      "email",
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/placeholder/i);
  });
});

// ---------------------------------------------------------------------------
// validatePersonForChannel — linkedin channel
// ---------------------------------------------------------------------------

describe("validatePersonForChannel — linkedin", () => {
  it("passes when linkedinUrl is present", () => {
    const result = validatePersonForChannel(
      { linkedinUrl: "https://linkedin.com/in/john" },
      "linkedin",
    );
    expect(result.valid).toBe(true);
  });

  it("fails when linkedinUrl is null", () => {
    const result = validatePersonForChannel({ linkedinUrl: null }, "linkedin");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing linkedin url/i);
  });

  it("fails when linkedinUrl is undefined", () => {
    const result = validatePersonForChannel({}, "linkedin");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing linkedin url/i);
  });

  it("fails when linkedinUrl is empty string", () => {
    const result = validatePersonForChannel({ linkedinUrl: "" }, "linkedin");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing linkedin url/i);
  });
});

// ---------------------------------------------------------------------------
// validatePersonForChannel — unknown channel
// ---------------------------------------------------------------------------

describe("validatePersonForChannel — unknown channel", () => {
  it("passes through for unknown channel names", () => {
    const result = validatePersonForChannel({ email: null }, "sms");
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterPeopleForChannels — single channel
// ---------------------------------------------------------------------------

describe("filterPeopleForChannels — email only", () => {
  const people = [
    { id: "1", email: "alice@example.com", linkedinUrl: null },
    { id: "2", email: null, linkedinUrl: "https://linkedin.com/in/bob" },
    { id: "3", email: "placeholder-x@discovery.internal", linkedinUrl: null },
    { id: "4", email: "carol@example.com", linkedinUrl: "https://linkedin.com/in/carol" },
  ];

  it("returns only people with valid emails", () => {
    const { valid, rejected } = filterPeopleForChannels(people, ["email"]);
    expect(valid.map((p) => p.id)).toEqual(["1", "4"]);
    expect(rejected.map((p) => p.person.id)).toEqual(["2", "3"]);
  });

  it("each rejected entry has a reason", () => {
    const { rejected } = filterPeopleForChannels(people, ["email"]);
    expect(rejected.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("includes the channel name in the rejection reason", () => {
    const { rejected } = filterPeopleForChannels(people, ["email"]);
    expect(rejected.every((r) => r.reason.includes("[email]"))).toBe(true);
  });
});

describe("filterPeopleForChannels — linkedin only", () => {
  const people = [
    { id: "1", email: "alice@example.com", linkedinUrl: null },
    { id: "2", email: null, linkedinUrl: "https://linkedin.com/in/bob" },
    { id: "3", email: "carol@example.com", linkedinUrl: "https://linkedin.com/in/carol" },
  ];

  it("returns only people with LinkedIn URLs", () => {
    const { valid, rejected } = filterPeopleForChannels(people, ["linkedin"]);
    expect(valid.map((p) => p.id)).toEqual(["2", "3"]);
    expect(rejected.map((p) => p.person.id)).toEqual(["1"]);
  });
});

// ---------------------------------------------------------------------------
// filterPeopleForChannels — dual channel
// ---------------------------------------------------------------------------

describe("filterPeopleForChannels — dual channel (email + linkedin)", () => {
  const people = [
    // Valid for both
    { id: "1", email: "alice@example.com", linkedinUrl: "https://linkedin.com/in/alice" },
    // Email only — no LinkedIn
    { id: "2", email: "bob@example.com", linkedinUrl: null },
    // LinkedIn only — no email
    { id: "3", email: null, linkedinUrl: "https://linkedin.com/in/carol" },
    // Neither
    { id: "4", email: null, linkedinUrl: null },
    // Placeholder email + valid LinkedIn
    { id: "5", email: "x@discovery.internal", linkedinUrl: "https://linkedin.com/in/dave" },
  ];

  it("only passes people valid for ALL channels", () => {
    const { valid, rejected } = filterPeopleForChannels(people, ["email", "linkedin"]);
    expect(valid.map((p) => p.id)).toEqual(["1"]);
    expect(rejected.map((p) => p.person.id)).toEqual(["2", "3", "4", "5"]);
  });

  it("rejection reason includes both failing channels when both fail", () => {
    const { rejected } = filterPeopleForChannels(people, ["email", "linkedin"]);
    const person4 = rejected.find((r) => r.person.id === "4");
    expect(person4).toBeDefined();
    expect(person4!.reason).toContain("[email]");
    expect(person4!.reason).toContain("[linkedin]");
  });

  it("rejection reason lists the specific failing channel only", () => {
    const { rejected } = filterPeopleForChannels(people, ["email", "linkedin"]);
    const person2 = rejected.find((r) => r.person.id === "2");
    expect(person2).toBeDefined();
    // Should cite linkedin failure only (email is valid)
    expect(person2!.reason).toContain("[linkedin]");
    expect(person2!.reason).not.toContain("[email]");
  });
});

// ---------------------------------------------------------------------------
// filterPeopleForChannels — edge cases
// ---------------------------------------------------------------------------

describe("filterPeopleForChannels — edge cases", () => {
  it("returns all valid when channels array is empty", () => {
    const people = [{ id: "1", email: null, linkedinUrl: null }];
    const { valid, rejected } = filterPeopleForChannels(people, []);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("handles empty people array", () => {
    const { valid, rejected } = filterPeopleForChannels([], ["email"]);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it("preserves all original person fields in valid output", () => {
    const people = [{ id: "x", email: "a@b.com", linkedinUrl: "https://li.com", extra: "data" }];
    const { valid } = filterPeopleForChannels(people, ["email"]);
    expect(valid[0]).toEqual(people[0]);
  });

  it("preserves all original person fields in rejected output", () => {
    const people = [{ id: "x", email: null, linkedinUrl: null, extra: "data" }];
    const { rejected } = filterPeopleForChannels(people, ["email"]);
    expect(rejected[0].person).toEqual(people[0]);
  });
});
