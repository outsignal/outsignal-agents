/**
 * Unit tests for workspace channel resolution (workspace-channels.ts).
 *
 * Pure function — no mocks needed.
 */

import { describe, expect, it } from "vitest";
import { getEnabledChannels } from "../workspace-channels";

describe("getEnabledChannels", () => {
  it("returns [email] for email package", () => {
    expect(getEnabledChannels("email")).toEqual(["email"]);
  });

  it("returns [linkedin] for linkedin package", () => {
    expect(getEnabledChannels("linkedin")).toEqual(["linkedin"]);
  });

  it("returns [email, linkedin] for email_linkedin package", () => {
    expect(getEnabledChannels("email_linkedin")).toEqual([
      "email",
      "linkedin",
    ]);
  });

  it("returns [] for consultancy package", () => {
    expect(getEnabledChannels("consultancy")).toEqual([]);
  });

  it("returns [email] for unknown package (default)", () => {
    expect(getEnabledChannels("unknown_value")).toEqual(["email"]);
  });

  it("returns [email] for empty string (default)", () => {
    expect(getEnabledChannels("")).toEqual(["email"]);
  });
});
