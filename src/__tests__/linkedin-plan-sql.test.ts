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
  // connect/connection_request regardless of status, because LinkedIn
  // holds the live invitation in its own 3-week retention window even
  // after Outsignal marks the row cancelled/expired. Prior to BL-054 the
  // planner excluded only cancelled/expired rows, which re-enqueued the
  // same person and produced `already_invited` rejections or throttling.

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

  it("does NOT filter connect/connection_request by status", () => {
    // Prior to BL-054 the dedup said: la."status" NOT IN ('cancelled',
    // 'expired'). That clause must NOT wrap the connect branch any more,
    // or the planner will re-enqueue people behind a cancelled-but-still-
    // live invite.
    //
    // The only remaining status filter in the SQL belongs to the
    // profile_view branch — assert THAT is still present but scoped to
    // profile_view.
    expect(ROUTE_SOURCE).toMatch(
      /la\."actionType"\s*=\s*'profile_view'[\s\S]*?la\."status"\s+NOT IN\s+\('cancelled',\s*'expired'\)/,
    );
    // Negative: a bare `la."status" NOT IN (...)` with no nearby
    // actionType='profile_view' guard would mean the old broad filter
    // is back. We check this by ensuring every status-NOT-IN occurrence
    // is within 200 chars of an actionType='profile_view' clause.
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
  //   1. Prior `cancelled` connect within 21d on same person → NOT planned
  //   2. Prior `complete` connect within 21d on same person → NOT planned
  //   3. Prior connect older than 21d → IS planned
  //   4. Profile_view dedup stays campaign-scoped (different campaign can
  //      still plan a profile_view on same person)
  //
  // The Prisma client is globally mocked (see src/__tests__/setup.ts), so
  // these assertions are SQL-structure proofs rather than DB integration
  // tests. We verify the SQL IS the rule, not the outcome of the rule. A
  // follow-up live-integration test against staging is tracked separately
  // (see monty decisions log).

  it("(1) cancelled connect within 21d blocks new plan — status filter is absent on connect branch", () => {
    // Find the connect branch in the SQL and confirm no `status` clause
    // narrows it. Cancelled rows therefore count as blockers.
    const connectBranch = ROUTE_SOURCE.match(
      /la\."actionType"\s+IN\s+\('connect',\s*'connection_request'\)[\s\S]*?INTERVAL\s+'21 days'\)/g,
    );
    expect(connectBranch).not.toBeNull();
    for (const branch of connectBranch!) {
      expect(branch).not.toMatch(/la\."status"/);
    }
  });

  it("(2) complete connect within 21d blocks new plan — same branch, no status filter", () => {
    // Same underlying mechanism as (1). Complete rows obviously count,
    // but this test guards against a misguided future optimisation that
    // adds `status='pending'` or similar to the connect branch.
    const connectBranch = ROUTE_SOURCE.match(
      /la\."actionType"\s+IN\s+\('connect',\s*'connection_request'\)[\s\S]*?INTERVAL\s+'21 days'\)/g,
    );
    expect(connectBranch).not.toBeNull();
    for (const branch of connectBranch!) {
      // No status=X or status IN (...) filter anywhere in the connect branch.
      expect(branch).not.toMatch(/la\."status"/);
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
