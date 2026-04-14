/**
 * Smoke test for the raw SQL strings in src/app/api/linkedin/plan/route.ts.
 *
 * Background (Finding 4.1 / commit f48f0c98): a previous regression had the
 * planner reference `"Person"` in raw SQL when the Person model is mapped
 * to the `"Lead"` table via `@@map("Lead")` in prisma/schema.prisma. The
 * SQL silently returned zero rows, causing a 24h LinkedIn deploy outage.
 *
 * This test is a CHEAP guard: it inspects the route's source for raw SQL
 * fragments that would re-introduce the bug. It does not run real DB
 * queries (the rest of the test suite mocks Prisma globally) — it just
 * asserts that the source file uses the correct mapped table names.
 *
 * If a future refactor moves the SQL elsewhere, update the import path
 * but keep the assertions.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/app/api/linkedin/plan/route.ts"),
  "utf-8",
);

describe("linkedin/plan raw SQL — table name regression guard", () => {
  it("references the mapped 'Lead' table, not the 'Person' model name", () => {
    // The model `Person { ... @@map("Lead") }` means raw SQL must say "Lead".
    expect(ROUTE_SOURCE).toMatch(/JOIN\s+"Lead"\s+l\s+ON/);
    // Negative assertion — a JOIN against "Person" would silently return
    // no rows and reintroduce the f48f0c98 regression.
    expect(ROUTE_SOURCE).not.toMatch(/JOIN\s+"Person"/);
  });

  it("references the mapped 'TargetListPerson' / 'LinkedInAction' tables", () => {
    expect(ROUTE_SOURCE).toContain('"TargetListPerson"');
    expect(ROUTE_SOURCE).toContain('"LinkedInAction"');
  });

  it("uses the consistent `l` alias for the Lead table (Finding 4.2)", () => {
    // The shorter alias `p` was used inconsistently with the rest of the
    // codebase. Lock in `l` so future raw SQL is predictable to grep.
    expect(ROUTE_SOURCE).toMatch(/JOIN\s+"Lead"\s+l\s+ON\s+l\.id\s*=/);
    expect(ROUTE_SOURCE).toMatch(/AND\s+l\."linkedinUrl"\s+IS NOT NULL/);
  });

  it("filters out non-active actions in the dedup NOT EXISTS clause", () => {
    // Both queries must skip cancelled/expired rows so the planner can
    // re-enqueue people whose previous action was withdrawn.
    expect(ROUTE_SOURCE).toMatch(
      /la\."status"\s+NOT IN\s+\('cancelled',\s*'expired'\)/,
    );
  });
});
