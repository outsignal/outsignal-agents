import { describe, it, expect } from "vitest";
import {
  MAGIC_LINK_TTL_MS,
  MAGIC_LINK_TTL_HUMAN,
} from "@/lib/member-invite";

/**
 * BL-059 — Extend magic-link TTL from 30 min to 24 hours.
 *
 * Locks the constant value so a future regression to 30 min (or any other
 * value) fails a test rather than silently slipping into production. The
 * human-facing string in invite + login emails must match the constant so
 * clients aren't told "30 minutes" while the token actually lasts 24h.
 */
describe("MAGIC_LINK_TTL constants (BL-059)", () => {
  it("MAGIC_LINK_TTL_MS is exactly 24 hours in milliseconds", () => {
    expect(MAGIC_LINK_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(MAGIC_LINK_TTL_MS).toBe(86_400_000);
  });

  it("MAGIC_LINK_TTL_HUMAN is the human-readable 24-hour string", () => {
    expect(MAGIC_LINK_TTL_HUMAN).toBe("24 hours");
  });

  it("expiresAt computed from MAGIC_LINK_TTL_MS is ~24h in the future", () => {
    const before = Date.now();
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
    const delta = expiresAt.getTime() - before;
    // Allow a small tolerance for test execution drift.
    expect(delta).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 100);
    expect(delta).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 100);
  });
});
