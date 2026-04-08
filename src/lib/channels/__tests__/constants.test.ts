import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STATUSES,
  CHANNEL_TYPES,
  CONNECTION_REQUEST_TYPES,
  DEPLOY_STATUSES,
  LINKEDIN_ACTION_TYPES,
  SENDER_CHANNELS,
  senderMatchesChannel,
} from "../constants";

describe("constants", () => {
  it("CHANNEL_TYPES has exactly 2 values (email, linkedin)", () => {
    const values = Object.values(CHANNEL_TYPES);
    expect(values).toHaveLength(2);
    expect(values).toContain("email");
    expect(values).toContain("linkedin");
  });

  it("SENDER_CHANNELS has exactly 3 values (email, linkedin, both)", () => {
    const values = Object.values(SENDER_CHANNELS);
    expect(values).toHaveLength(3);
    expect(values).toContain("email");
    expect(values).toContain("linkedin");
    expect(values).toContain("both");
  });

  it("LINKEDIN_ACTION_TYPES has exactly 5 values", () => {
    const values = Object.values(LINKEDIN_ACTION_TYPES);
    expect(values).toHaveLength(5);
    expect(values).toContain("connect");
    expect(values).toContain("connection_request");
    expect(values).toContain("message");
    expect(values).toContain("profile_view");
    expect(values).toContain("check_connection");
  });

  it("CONNECTION_REQUEST_TYPES contains both connect and connection_request", () => {
    expect(CONNECTION_REQUEST_TYPES).toContain("connect");
    expect(CONNECTION_REQUEST_TYPES).toContain("connection_request");
    expect(CONNECTION_REQUEST_TYPES).toHaveLength(2);
  });

  it("CAMPAIGN_STATUSES has exactly 9 values", () => {
    expect(Object.values(CAMPAIGN_STATUSES)).toHaveLength(9);
  });

  it("DEPLOY_STATUSES has exactly 5 values", () => {
    expect(Object.values(DEPLOY_STATUSES)).toHaveLength(5);
  });
});

describe("senderMatchesChannel", () => {
  it("returns true when sender channel equals target", () => {
    expect(senderMatchesChannel("email", "email")).toBe(true);
    expect(senderMatchesChannel("linkedin", "linkedin")).toBe(true);
  });

  it('returns true when sender channel is "both"', () => {
    expect(senderMatchesChannel("both", "email")).toBe(true);
    expect(senderMatchesChannel("both", "linkedin")).toBe(true);
  });

  it("returns false when sender channel does not match target", () => {
    expect(senderMatchesChannel("email", "linkedin")).toBe(false);
    expect(senderMatchesChannel("linkedin", "email")).toBe(false);
  });
});
