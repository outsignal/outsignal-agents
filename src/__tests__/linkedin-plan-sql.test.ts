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
 * asserts that the source file uses the correct mapped table names and
 * encodes the BL-054 cooldown semantics.
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
});

describe("linkedin/plan raw SQL — BL-054 cooldown semantics", () => {
  // The planner must enforce a 21-day workspace-wide cooldown on any
  // connect/connection_request that actually reached LinkedIn, because
  // LinkedIn holds the live invitation in its own 3-week retention
  // window. Cancelled rows with attempts=0 are planner debris and must
  // not block re-planning.

  it("connect/connection_request uses a 21-day workspace-wide cooldown", () => {
    // Both the SELECT-count and SELECT-rows blocks must check
    // la."createdAt" > NOW() - INTERVAL '21 days' for connect types. This
    // is the live-invite retention window LinkedIn enforces.
    const matches = ROUTE_SOURCE.match(
      /AND\s+la\."createdAt"\s+>\s+NOW\(\)\s+-\s+INTERVAL\s+'21 days'/g,
    );
    expect(matches).not.toBeNull();
    // Expect two occurrences: one in the count query, one in the fetch
    // query. Keeps both SELECT blocks in lock-step.
    expect(matches!.length).toBe(2);
  });

  it("cooldown triggers for connect AND connection_request (not just one)", () => {
    // The branch keyed to the 21-day window must include BOTH action
    // types — dropping one would leak the older push-era debris.
    const matches = ROUTE_SOURCE.match(
      /la\."actionType"\s+IN\s+\('connect',\s*'connection_request'\)[\s\S]*?INTERVAL\s+'21 days'/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("excludes planner-debris cancels from the connect cooldown branch", () => {
    // Connect rows still cool down for 21 days, but migration-debris
    // rows cancelled before any attempt should not block re-planning.
    // The branch should contain the explicit attempts=0 cancelled carve-out.
    const connectBranches = ROUTE_SOURCE.match(
      /la\."actionType"\s+IN\s+\('connect',\s*'connection_request'\)[\s\S]*?INTERVAL\s+'21 days'[\s\S]*?\)\s+OR/g,
    );
    expect(connectBranches).not.toBeNull();
    for (const branch of connectBranches!) {
      expect(branch).toMatch(
        /NOT\s+\(la\."status"\s*=\s*'cancelled'\s+AND\s+la\."attempts"\s*=\s*0\)/,
      );
    }

    // The only remaining status-NOT-IN filter belongs to the profile_view
    // branch — assert THAT is still present but scoped to profile_view.
    expect(ROUTE_SOURCE).toMatch(
      /la\."actionType"\s*=\s*'profile_view'[\s\S]*?la\."status"\s+NOT IN\s+\('cancelled',\s*'expired'\)/,
    );
    const statusRegex = /la\."status"\s+NOT IN\s+\('cancelled',\s*'expired'\)/g;
    let match;
    while ((match = statusRegex.exec(ROUTE_SOURCE)) !== null) {
      const start = Math.max(0, match.index - 200);
      const window = ROUTE_SOURCE.slice(start, match.index);
      expect(window).toMatch(/la\."actionType"\s*=\s*'profile_view'/);
    }
  });

  it("keeps profile_view dedup campaign-scoped", () => {
    // profile_view must still compare la."campaignName" — cross-campaign
    // profile_views are allowed. The connect branch must NOT require
    // matching campaignName (cooldown is workspace-wide).
    expect(ROUTE_SOURCE).toMatch(
      /la\."actionType"\s*=\s*'profile_view'[\s\S]{0,120}la\."campaignName"\s*=/,
    );
  });

  it("both SELECT blocks still scope to workspaceSlug", () => {
    // The connect cooldown is workspace-wide (not cross-workspace). One
    // client's invites must never block another client's planner. Every
    // NOT EXISTS must still compare la."workspaceSlug".
    const workspaceChecks = ROUTE_SOURCE.match(
      /la\."workspaceSlug"\s*=\s*\$\{\s*workspaceSlug\s*\}/g,
    );
    expect(workspaceChecks).not.toBeNull();
    expect(workspaceChecks!.length).toBe(2);
  });

  it("both SELECT blocks (count + fetch) are updated identically", () => {
    // Sanity check: the 21-day INTERVAL and the profile_view campaignName
    // scoping must appear in BOTH SELECT blocks. Drift between the two
    // blocks would let one query see a candidate and the other exclude
    // it — budget allocation would be computed from a stale count.
    const cooldownCount = (
      ROUTE_SOURCE.match(/INTERVAL\s+'21 days'/g) ?? []
    ).length;
    const profileViewScopeCount = (
      ROUTE_SOURCE.match(
        /la\."actionType"\s*=\s*'profile_view'[\s\S]{0,40}AND\s+la\."campaignName"/g,
      ) ?? []
    ).length;
    expect(cooldownCount).toBe(2);
    expect(profileViewScopeCount).toBe(2);
  });
});

describe("linkedin/plan raw SQL — BL-054 behavioural semantics (documented)", () => {
  // These tests codify the behavioural outcomes the brief requires:
  //   1. Prior `cancelled` connect within 21d with attempts=0 → IS planned
  //   2. Prior `cancelled`/`complete` connect within 21d with attempts>0 → NOT planned
  //   3. Prior connect older than 21d → IS planned
  //   4. Profile_view dedup stays campaign-scoped (different campaign can
  //      still plan a profile_view on same person)
  //
  // The Prisma client is globally mocked (see src/__tests__/setup.ts), so
  // these assertions are SQL-structure proofs rather than DB integration
  // tests. We verify the SQL IS the rule, not the outcome of the rule. A
  // follow-up live-integration test against staging is tracked separately
  // (see monty decisions log).

  it("(1) cancelled connect within 21d with attempts=0 does NOT block new plan", () => {
    // Find the connect branch in the SQL and confirm it explicitly carves
    // out cancelled rows that never attempted a live send.
    const connectBranch = ROUTE_SOURCE.match(
      /la\."actionType"\s+IN\s+\('connect',\s*'connection_request'\)[\s\S]*?INTERVAL\s+'21 days'[\s\S]*?\)/g,
    );
    expect(connectBranch).not.toBeNull();
    for (const branch of connectBranch!) {
      expect(branch).toMatch(
        /NOT\s+\(la\."status"\s*=\s*'cancelled'\s+AND\s+la\."attempts"\s*=\s*0\)/,
      );
    }
  });

  it("(2) attempted connects within 21d still block new plan", () => {
    // The carve-out must stay narrow: only never-attempted cancelled rows
    // escape the cooldown. Attempted rows remain blockers.
    const connectBranch = ROUTE_SOURCE.match(
      /la\."actionType"\s+IN\s+\('connect',\s*'connection_request'\)[\s\S]*?INTERVAL\s+'21 days'[\s\S]*?\)/g,
    );
    expect(connectBranch).not.toBeNull();
    for (const branch of connectBranch!) {
      expect(branch).toMatch(/la\."attempts"\s*=\s*0/);
    }
  });

  it("(3) connect older than 21d does NOT block — cooldown window is upper-bounded", () => {
    // The SQL says `createdAt > NOW() - INTERVAL '21 days'`, meaning rows
    // older than 21 days fail the predicate and do not appear in the
    // exclusion set. Confirm the comparison is strictly `>` (greater
    // than), so the boundary is exclusive and aged rows drop out.
    const pattern = /la\."createdAt"\s+>\s+NOW\(\)\s+-\s+INTERVAL\s+'21 days'/g;
    const matches = ROUTE_SOURCE.match(pattern);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
    // Negative: no `<` / `>=` variant that would flip the semantics.
    expect(ROUTE_SOURCE).not.toMatch(
      /la\."createdAt"\s+<\s+NOW\(\)\s+-\s+INTERVAL\s+'21 days'/,
    );
  });

  it("(4) profile_view dedup stays campaign-scoped — cross-campaign views still allowed", () => {
    // The profile_view branch must compare la."campaignName" so a second
    // campaign in the same workspace can still view the same person. If
    // campaignName scoping were dropped, a prior profile_view would
    // block every future campaign's view of the person.
    const profileViewBranch = ROUTE_SOURCE.match(
      /la\."actionType"\s*=\s*'profile_view'[\s\S]*?NOT IN\s+\('cancelled',\s*'expired'\)\s*\)/g,
    );
    expect(profileViewBranch).not.toBeNull();
    for (const branch of profileViewBranch!) {
      expect(branch).toMatch(/la\."campaignName"\s*=/);
    }
  });
});
