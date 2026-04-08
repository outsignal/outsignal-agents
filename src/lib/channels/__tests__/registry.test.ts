import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAdapters,
  getAllAdapters,
  getAdapter,
  registerAdapter,
} from "../registry";
import type { ChannelAdapter } from "../types";
import type { ChannelType } from "../constants";

function createMockAdapter(channel: ChannelType): ChannelAdapter {
  return {
    channel,
    deploy: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getMetrics: vi.fn(),
    getLeads: vi.fn(),
    getActions: vi.fn(),
    getSequenceSteps: vi.fn(),
  };
}

describe("registry", () => {
  beforeEach(() => {
    clearAdapters();
  });

  it("throws for unregistered channel with descriptive error", () => {
    expect(() => getAdapter("email")).toThrow(/No adapter registered/);
    expect(() => getAdapter("email")).toThrow(/email/);
    expect(() => getAdapter("email")).toThrow(/initAdapters/);
  });

  it("round-trips registerAdapter + getAdapter", () => {
    const mock = createMockAdapter("email");
    registerAdapter(mock);
    expect(getAdapter("email")).toBe(mock);
  });

  it("getAllAdapters returns all registered adapters", () => {
    const email = createMockAdapter("email");
    const linkedin = createMockAdapter("linkedin");
    registerAdapter(email);
    registerAdapter(linkedin);

    const all = getAllAdapters();
    expect(all).toHaveLength(2);
    expect(all).toContain(email);
    expect(all).toContain(linkedin);
  });

  it("registering a second adapter for the same channel replaces the first", () => {
    const first = createMockAdapter("email");
    const second = createMockAdapter("email");
    registerAdapter(first);
    registerAdapter(second);
    expect(getAdapter("email")).toBe(second);
    expect(getAdapter("email")).not.toBe(first);
  });

  it("clearAdapters empties the registry", () => {
    registerAdapter(createMockAdapter("email"));
    registerAdapter(createMockAdapter("linkedin"));
    clearAdapters();
    expect(getAllAdapters()).toHaveLength(0);
    expect(() => getAdapter("email")).toThrow();
  });
});
