/**
 * deploy-campaign.integration.test.ts — EmailAdapter end-to-end with the
 * REAL EmailBisonClient (HTTP layer mocked via global.fetch).
 *
 * Scope decision (Phase 4 deploy rebuild, 2026-04-15):
 *   The EB OpenAPI spec (docs/emailbison-dedi-api-reference.md lines 2101 +
 *   2161) documents both POST /api/workspaces/v1.1 (create) and
 *   DELETE /api/workspaces/v1.1/{team_id} (delete). Delete REQUIRES a
 *   super-admin API token, which is not configured in this repo and would
 *   create/destroy real EB resources (billing + lead-data side effects).
 *
 *   Per the Phase 4 brief: "IF EB workspace-delete unavailable: stub
 *   EB-workspace-create entirely, use HTTP-layer mocks comprehensively
 *   instead of live EB." We use HTTP-layer mocks — we do NOT touch live
 *   EmailBison at all. Assertions focus on the 10-step flow's URL/method/
 *   body contract via fetch mock inspection, which is the same contract a
 *   live-EB integration would verify.
 *
 * Prisma is mocked too (same pattern as sibling unit tests) — this is an
 * HTTP-boundary integration test, not a DB integration test.
 *
 * 4 cases:
 *   1. First-time deploy happy path — fresh create, all 10 steps fire in order
 *   2. Re-deploy idempotency — preExistingEbId set, reuse branch taken
 *   3. Mid-flight failure — Step 6 (attach-sender-emails) 422s, deploy fails
 *      at [step:6], no resume/verify calls, state left recoverable
 *   4. Resume after failure — following the Step 6 fail, re-run idempotently
 *      picks up where we stopped (reuses EB campaign ID, re-posts only the
 *      failed steps)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting — prisma + getCampaign. EmailBisonClient is NOT mocked here;
// we want the REAL client instantiated and its fetch calls inspected.
// ---------------------------------------------------------------------------

const { getCampaignMock, prismaMock } = vi.hoisted(() => ({
  getCampaignMock: vi.fn(),
  prismaMock: {
    workspace: { findUniqueOrThrow: vi.fn() },
    campaign: { update: vi.fn(), findUnique: vi.fn() },
    campaignDeploy: { update: vi.fn() },
    targetListPerson: { findMany: vi.fn() },
    webhookEvent: { findFirst: vi.fn() },
    sender: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

// Pass-through retry — failure tests would otherwise sleep 1s/5s/15s.
vi.mock("@/lib/utils/retry", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import { EmailAdapter } from "@/lib/channels/email-adapter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EB_BASE = "https://app.outsignal.ai/api";
const WORKSPACE_SLUG = "ephemeral-acme";
const API_TOKEN = "ephemeral-super-admin-token";

const DEPLOY_PARAMS = {
  deployId: "deploy-integ-1",
  campaignId: "camp-integ-1",
  campaignName: "Integration Campaign",
  workspaceSlug: WORKSPACE_SLUG,
  channels: ["email"],
};

/**
 * Build a mock Response matching the EmailBisonClient's expectations (it
 * reads `.ok`, `.status`, `.json()`, `.text()`).
 */
function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Route a fetch(url, options) call to a canned response based on
 * method + URL suffix. Returns 500 for any unmocked route so unexpected
 * calls fail loudly rather than silently hanging.
 */
type RouteHandler = (url: string, options: RequestInit) => Response | Promise<Response>;

function routeFetch(routes: Array<{ match: RegExp; method?: string; handler: RouteHandler }>) {
  return async (url: string, options: RequestInit = {}) => {
    const method = (options.method ?? "GET").toUpperCase();
    for (const r of routes) {
      const methodMatch = !r.method || r.method.toUpperCase() === method;
      if (methodMatch && r.match.test(url)) {
        return r.handler(url, options);
      }
    }
    console.error(`[integration] UNMOCKED fetch: ${method} ${url}`);
    return mockResponse({ error: `no route for ${method} ${url}` }, 500);
  };
}

function setupBaselinePrisma(opts: {
  preExistingEbId?: number | null;
  leadCount?: number;
} = {}) {
  const { preExistingEbId = null, leadCount = 1 } = opts;

  prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
    apiToken: API_TOKEN,
  });
  getCampaignMock.mockResolvedValue({
    id: "camp-integ-1",
    targetListId: "tl-1",
    emailBisonCampaignId: preExistingEbId,
    emailSequence: [
      { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
    ],
  });
  prismaMock.campaign.update.mockResolvedValue({});
  prismaMock.campaignDeploy.update.mockResolvedValue({});
  prismaMock.webhookEvent.findFirst.mockResolvedValue(null);
  prismaMock.sender.findMany.mockResolvedValue(
    leadCount > 0 ? [{ emailBisonSenderId: 501 }] : [],
  );

  const leads = Array.from({ length: leadCount }, (_, i) => ({
    person: {
      email: `lead${i + 1}@acme.com`,
      firstName: `L${i + 1}`,
      lastName: null,
      jobTitle: null,
      company: null,
      workspaces: [],
    },
  }));
  prismaMock.targetListPerson.findMany.mockResolvedValue(leads);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deploy-campaign integration — EmailAdapter ↔ EmailBisonClient HTTP layer", () => {
  let adapter: EmailAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new EmailAdapter();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Case 1 — first-time deploy happy path
  // -------------------------------------------------------------------------
  it("case 1: first-time deploy — fresh create, all 10 steps hit the correct EB endpoints in order", async () => {
    setupBaselinePrisma({ preExistingEbId: null, leadCount: 1 });

    fetchMock.mockImplementation(
      routeFetch([
        // Step 1 — createCampaign (POST /campaigns, no suffix)
        {
          method: "POST",
          match: /\/api\/campaigns$/,
          handler: () =>
            mockResponse({ data: { id: 10001, uuid: "uuid-10001" } }),
        },
        // Step 3 — createSequenceStep (POST /campaigns/{id}/sequence-steps)
        {
          method: "POST",
          match: /\/api\/campaigns\/10001\/sequence-steps$/,
          handler: () => mockResponse({ data: { id: 1 } }),
        },
        // Step 4 — createLead (POST /leads)
        {
          method: "POST",
          match: /\/api\/leads$/,
          handler: () =>
            mockResponse({
              data: { id: 2001, email: "lead1@acme.com", status: "active" },
            }),
        },
        // Step 4 — attachLeadsToCampaign (POST /campaigns/{id}/leads/attach-leads)
        {
          method: "POST",
          match: /\/api\/campaigns\/10001\/leads\/attach-leads/,
          handler: () => mockResponse({}),
        },
        // Step 5 — createSchedule (fresh deploy, no GET)
        {
          method: "POST",
          match: /\/api\/campaigns\/10001\/schedule/,
          handler: () => mockResponse({ data: { id: 1 } }),
        },
        // Step 6 — attachSenderEmails
        {
          method: "POST",
          match: /\/api\/campaigns\/10001\/attach-sender-emails/,
          handler: () => mockResponse({}),
        },
        // Step 7 — updateCampaign (PATCH)
        {
          method: "PATCH",
          match: /\/api\/campaigns\/10001\/update/,
          handler: () => mockResponse({ data: { id: 10001 } }),
        },
        // Step 9 — resumeCampaign (PATCH /campaigns/{id}/resume)
        {
          method: "PATCH",
          match: /\/api\/campaigns\/10001\/resume/,
          handler: () => mockResponse({ data: { id: 10001 } }),
        },
        // Step 10 — getCampaign verify
        {
          method: "GET",
          match: /\/api\/campaigns\/10001$/,
          handler: () =>
            mockResponse({ data: { id: 10001, status: "active" } }),
        },
      ]),
    );

    await adapter.deploy(DEPLOY_PARAMS);

    // Extract (method, url) pairs in the order fetch was called.
    const callSequence = fetchMock.mock.calls.map((c) => {
      const url = c[0] as string;
      const method = ((c[1] as RequestInit)?.method ?? "GET").toUpperCase();
      // Strip the base URL for readability.
      const path = url.replace(EB_BASE, "");
      return `${method} ${path}`;
    });

    // Relative order check — step 1 before step 3 before step 4 etc.
    const indexOf = (needle: RegExp) =>
      callSequence.findIndex((s) => needle.test(s));
    expect(indexOf(/POST \/campaigns$/)).toBeGreaterThanOrEqual(0);
    expect(indexOf(/sequence-steps/)).toBeGreaterThan(indexOf(/POST \/campaigns$/));
    expect(indexOf(/POST \/leads$/)).toBeGreaterThan(indexOf(/sequence-steps/));
    expect(indexOf(/attach-leads/)).toBeGreaterThan(indexOf(/POST \/leads$/));
    expect(indexOf(/\/schedule/)).toBeGreaterThan(indexOf(/attach-leads/));
    expect(indexOf(/attach-sender-emails/)).toBeGreaterThan(indexOf(/\/schedule/));
    expect(indexOf(/PATCH.*\/update/)).toBeGreaterThan(indexOf(/attach-sender-emails/));
    expect(indexOf(/\/resume/)).toBeGreaterThan(indexOf(/PATCH.*\/update/));
    // Step 10 verify GET is LAST.
    const verifyIdx = callSequence.findIndex((s) => /GET \/campaigns\/10001$/.test(s));
    expect(verifyIdx).toBeGreaterThan(indexOf(/\/resume/));

    // Persist step — Campaign.emailBisonCampaignId was written to EB id 10001.
    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp-integ-1" },
      data: { emailBisonCampaignId: 10001 },
    });

    // Final deploy row marked complete.
    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-integ-1" },
      data: { emailStatus: "complete", emailError: null },
    });
  });

  // -------------------------------------------------------------------------
  // Case 2 — re-deploy idempotency
  // -------------------------------------------------------------------------
  it("case 2: re-deploy idempotency — reuses existing EB campaign, skips already-persisted sequence step", async () => {
    // Campaign already has emailBisonCampaignId=10001 from a prior run.
    setupBaselinePrisma({ preExistingEbId: 10001, leadCount: 1 });

    // Step 1 GET and Step 10 GET share the same URL (/campaigns/10001).
    // Track call count so the first returns "draft" (pre-resume reuse) and
    // the second returns "active" (post-resume verify).
    let getCampaignHits = 0;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      const method = (options.method ?? "GET").toUpperCase();
      const stripped = url.replace(EB_BASE, "");

      if (method === "GET" && stripped === "/campaigns/10001") {
        getCampaignHits += 1;
        return mockResponse({
          data: {
            id: 10001,
            status: getCampaignHits === 1 ? "draft" : "active",
          },
        });
      }
      // Step 3 — existing sequence-step at position 1.
      if (method === "GET" && /\/campaigns\/10001\/sequence-steps/.test(stripped)) {
        return mockResponse({
          data: [
            { position: 1, id: 1, subject: "hi", body: "hello", delay_days: 0 },
          ],
        });
      }
      if (method === "POST" && stripped === "/leads") {
        return mockResponse({
          data: { id: 2002, email: "lead1@acme.com", status: "active" },
        });
      }
      if (method === "POST" && /\/campaigns\/10001\/leads\/attach-leads/.test(stripped)) {
        return mockResponse({});
      }
      // Step 5 reuse — GET schedule returns existing, then PUT to update.
      if (method === "GET" && stripped === "/campaigns/10001/schedule") {
        return mockResponse({ data: { timezone: "Europe/London" } });
      }
      if (method === "PUT" && stripped === "/campaigns/10001/schedule") {
        return mockResponse({ data: { id: 1 } });
      }
      if (method === "POST" && /attach-sender-emails/.test(stripped)) {
        return mockResponse({});
      }
      if (method === "PATCH" && /campaigns\/10001\/update/.test(stripped)) {
        return mockResponse({ data: { id: 10001 } });
      }
      if (method === "PATCH" && /\/campaigns\/10001\/resume/.test(stripped)) {
        return mockResponse({ data: { id: 10001 } });
      }
      console.error(`[integration case 2] UNMOCKED: ${method} ${stripped}`);
      return mockResponse({ error: `no route for ${method} ${stripped}` }, 500);
    });

    await adapter.deploy(DEPLOY_PARAMS);

    const calls = fetchMock.mock.calls.map((c) => {
      const url = c[0] as string;
      const method = ((c[1] as RequestInit)?.method ?? "GET").toUpperCase();
      return `${method} ${url.replace(EB_BASE, "")}`;
    });

    // Idempotency invariant 1 — createCampaign POST was NEVER called.
    expect(calls.filter((s) => s === "POST /campaigns")).toHaveLength(0);
    // Idempotency invariant 2 — createSequenceStep POST was NEVER called
    // (position 1 already present).
    expect(
      calls.filter((s) => /POST.*\/sequence-steps/.test(s)),
    ).toHaveLength(0);
    // Idempotency invariant 3 — reuse path took the updateSchedule (PUT) branch.
    expect(
      calls.some((s) => /PUT \/campaigns\/10001\/schedule/.test(s)),
    ).toBe(true);

    // Deploy completed.
    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      data: { emailStatus: "complete", emailError: null },
    });
  });

  // -------------------------------------------------------------------------
  // Case 3 — mid-flight failure at Step 6 (attach-sender-emails 422)
  // -------------------------------------------------------------------------
  it("case 3: mid-flight failure — Step 6 422 fails cleanly, no resume/verify calls, emailError tagged [step:6]", async () => {
    setupBaselinePrisma({ preExistingEbId: null, leadCount: 1 });

    fetchMock.mockImplementation(
      routeFetch([
        {
          method: "POST",
          match: /\/api\/campaigns$/,
          handler: () =>
            mockResponse({ data: { id: 10002, uuid: "uuid-10002" } }),
        },
        {
          method: "POST",
          match: /\/api\/campaigns\/10002\/sequence-steps$/,
          handler: () => mockResponse({ data: { id: 1 } }),
        },
        {
          method: "POST",
          match: /\/api\/leads$/,
          handler: () =>
            mockResponse({
              data: { id: 2003, email: "lead1@acme.com", status: "active" },
            }),
        },
        {
          method: "POST",
          match: /\/api\/campaigns\/10002\/leads\/attach-leads/,
          handler: () => mockResponse({}),
        },
        {
          method: "POST",
          match: /\/api\/campaigns\/10002\/schedule/,
          handler: () => mockResponse({ data: { id: 1 } }),
        },
        // Step 6 — 422 Unprocessable Entity. 422 is NOT in the retry list, so
        // the client rethrows immediately.
        {
          method: "POST",
          match: /\/api\/campaigns\/10002\/attach-sender-emails/,
          handler: () =>
            mockResponse(
              { message: "Sender 501 not verified in workspace" },
              422,
            ),
        },
        // The following routes should NEVER be called.
      ]),
    );

    await expect(adapter.deploy(DEPLOY_PARAMS)).rejects.toThrow(
      /Email Bison API error 422/,
    );

    const calls = fetchMock.mock.calls.map((c) => {
      const url = c[0] as string;
      const method = ((c[1] as RequestInit)?.method ?? "GET").toUpperCase();
      return `${method} ${url.replace(EB_BASE, "")}`;
    });

    // attach-sender-emails was attempted.
    expect(
      calls.some((s) => /attach-sender-emails/.test(s)),
    ).toBe(true);
    // updateCampaign (Step 7) NEVER fired.
    expect(calls.some((s) => /PATCH.*\/update/.test(s))).toBe(false);
    // resumeCampaign (Step 9) NEVER fired.
    expect(calls.some((s) => /\/resume/.test(s))).toBe(false);
    // getCampaign verify (Step 10) NEVER fired.
    expect(
      calls.some((s) => /^GET \/campaigns\/10002$/.test(s)),
    ).toBe(false);

    // CampaignDeploy row marked failed with [step:6] prefix on emailError.
    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-integ-1" },
      data: { emailStatus: "failed" },
    });
    expect(finalUpdate.data.emailError).toMatch(/\[step:6\]/);

    // State left recoverable — Campaign.emailBisonCampaignId = 10002 was
    // persisted at Step 2, so a re-run will take the idempotent branch.
    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "camp-integ-1" },
      data: { emailBisonCampaignId: 10002 },
    });
  });

  // -------------------------------------------------------------------------
  // Case 4 — resume after failure
  // -------------------------------------------------------------------------
  it("case 4: resume after failure — re-run idempotently picks up at Step 6, completes cleanly", async () => {
    // Simulate the DB state after case 3: Campaign.emailBisonCampaignId=10002
    // was persisted, so the re-run enters the REUSE branch.
    setupBaselinePrisma({ preExistingEbId: 10002, leadCount: 1 });

    // Stateful fetch handler — GET /campaigns/10002 is called TWICE:
    //   - call 1 = Step 1 verify (returns "draft", adapter reuses)
    //   - call 2 = Step 10 post-resume verify (returns "active", completes)
    // All other endpoints use simple single-response mocks. Step 5 takes the
    // reuse branch: GET schedule returns existing → PUT updateSchedule fires.
    let getCampaignCalls = 0;
    fetchMock.mockImplementation(async (url: string, options: RequestInit = {}) => {
      const method = (options.method ?? "GET").toUpperCase();
      const stripped = url.replace(EB_BASE, "");

      if (method === "GET" && stripped === "/campaigns/10002") {
        getCampaignCalls += 1;
        return mockResponse({
          data: {
            id: 10002,
            status: getCampaignCalls === 1 ? "draft" : "active",
          },
        });
      }
      if (method === "GET" && /\/campaigns\/10002\/sequence-steps/.test(stripped)) {
        return mockResponse({ data: [{ position: 1, id: 1 }] });
      }
      if (method === "POST" && stripped === "/leads") {
        return mockResponse({
          data: { id: 2004, email: "lead1@acme.com", status: "active" },
        });
      }
      if (method === "POST" && /\/campaigns\/10002\/leads\/attach-leads/.test(stripped)) {
        return mockResponse({});
      }
      if (method === "GET" && stripped === "/campaigns/10002/schedule") {
        return mockResponse({ data: { timezone: "Europe/London" } });
      }
      if (method === "PUT" && stripped === "/campaigns/10002/schedule") {
        return mockResponse({ data: { id: 1 } });
      }
      if (method === "POST" && /attach-sender-emails/.test(stripped)) {
        return mockResponse({});
      }
      if (method === "PATCH" && /campaigns\/10002\/update/.test(stripped)) {
        return mockResponse({ data: { id: 10002 } });
      }
      if (/\/campaigns\/10002\/resume/.test(stripped)) {
        return mockResponse({});
      }
      console.error(`[integration case 4] UNMOCKED: ${method} ${stripped}`);
      return mockResponse({ error: `no route for ${method} ${stripped}` }, 500);
    });

    await adapter.deploy(DEPLOY_PARAMS);

    // createCampaign (Step 1 fresh branch) was NEVER called — we reused.
    const calls = fetchMock.mock.calls.map((c) => {
      const url = c[0] as string;
      const method = ((c[1] as RequestInit)?.method ?? "GET").toUpperCase();
      return `${method} ${url.replace(EB_BASE, "")}`;
    });
    expect(calls.filter((s) => s === "POST /campaigns")).toHaveLength(0);
    // No createSequenceStep POST — position 1 already present.
    expect(
      calls.filter((s) => /POST.*\/sequence-steps/.test(s)),
    ).toHaveLength(0);
    // Step 6 DID fire this time (resumed from the failure point).
    expect(
      calls.some((s) => /attach-sender-emails/.test(s)),
    ).toBe(true);
    // Step 9 fired.
    expect(calls.some((s) => /\/resume/.test(s))).toBe(true);
    // Step 10 fired — and saw status:"active".
    expect(getCampaignCalls).toBeGreaterThanOrEqual(2);

    // Deploy row complete.
    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      data: { emailStatus: "complete", emailError: null },
    });
  });
});
