/**
 * EmailBisonClient.createOrUpdateLeadsMultiple — wire contract + tolerant
 * parse + non-retryable surface (BL-088).
 *
 * Why this test exists:
 *   - Per-lead `createLead` POST returned 422 ('The email has already been
 *     taken.') on canary Run G Step 4 because EB's lead store is
 *     workspace-scoped, not campaign-scoped — prior-run leads persist
 *     across campaign deletions and block any subsequent createLead.
 *   - The fix is to switch to POST /api/leads/create-or-update/multiple
 *     with `existing_lead_behavior: 'patch'`, which accepts both new and
 *     existing emails in a single batch. EB itself recommends this
 *     (docs/emailbison-dedi-api-reference.md line 1527).
 *
 * Cases:
 *   (a) HAPPY 3-lead batch — wire body + URL + method correct, returned
 *       IDs surfaced to caller.
 *   (b) EMPTY input — short-circuits with zero fetch calls (matches the
 *       createSequenceSteps pattern).
 *   (c) 422 non-retryable — single fetch call, EmailBisonApiError
 *       bubbles. This is the BL-086 contract: 422 surfaces immediately,
 *       no withRetry amplifier.
 *   (d) Tolerant parse on 200 with shape drift — returns [], emits
 *       [BL-088] warn, single fetch call. BL-085 pattern.
 *   (e) 5xx retryable — internal client retry kicks in (3 attempts, then
 *       throws). Confirms transient failures still loop.
 *   (f) Bare-array response — accepted by the Zod union (mirrors
 *       getSequenceSteps).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";

const EB_BASE = "https://app.outsignal.ai/api";
const TOKEN = "bl088-test-token";

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

function readFetchBody(call: unknown[]): Record<string, unknown> {
  const options = call[1] as RequestInit | undefined;
  if (!options) {
    throw new Error(
      "fetch call has no options — cannot read body. Call was: " +
        JSON.stringify(call[0]),
    );
  }
  const body = options.body;
  if (typeof body !== "string") {
    throw new Error(
      `fetch body is not a string — cannot JSON.parse. Got: ${typeof body}`,
    );
  }
  return JSON.parse(body) as Record<string, unknown>;
}

const HAPPY_LEADS = [
  {
    email: "a@acme.com",
    firstName: "A",
    lastName: "One",
    jobTitle: "CEO",
    company: "Acme",
  },
  { email: "b@acme.com", firstName: "B", lastName: "Two" },
  { email: "c@acme.com" },
];

const HAPPY_RESPONSE = {
  data: [
    { id: 1001, email: "a@acme.com", status: "active" },
    { id: 1002, email: "b@acme.com", status: "active" },
    { id: 1003, email: "c@acme.com", status: "active" },
  ],
};

describe("EmailBisonClient.createOrUpdateLeadsMultiple — wire contract (BL-088)", () => {
  let client: EmailBisonClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new EmailBisonClient(TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (a) HAPPY — wire body assertion
  // -------------------------------------------------------------------------
  it(
    "(a) HAPPY: POSTs to /leads/create-or-update/multiple with " +
      "{existing_lead_behavior:'patch', leads:[...]} body and returns the IDs",
    async () => {
      fetchMock.mockResolvedValue(mockResponse(HAPPY_RESPONSE));

      const result = await client.createOrUpdateLeadsMultiple(HAPPY_LEADS);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0];

      const url = call[0] as string;
      const options = call[1] as RequestInit;

      expect(url).toBe(`${EB_BASE}/leads/create-or-update/multiple`);
      expect(options.method).toBe("POST");

      // Wire body shape — the load-bearing assertion.
      const body = readFetchBody(call);
      expect(body.existing_lead_behavior).toBe("patch");
      expect(Array.isArray(body.leads)).toBe(true);

      const leadsArr = body.leads as Array<Record<string, unknown>>;
      expect(leadsArr).toHaveLength(3);

      // Camelcase consumer fields → snake_case wire fields.
      expect(leadsArr[0]).toEqual({
        email: "a@acme.com",
        first_name: "A",
        last_name: "One",
        title: "CEO",
        company: "Acme",
      });
      expect(leadsArr[1]).toEqual({
        email: "b@acme.com",
        first_name: "B",
        last_name: "Two",
      });
      // Email-only entry — no other fields leak in.
      expect(leadsArr[2]).toEqual({ email: "c@acme.com" });

      // Defensive — no consumer-facing key names leak onto the wire.
      for (const entry of leadsArr) {
        expect(entry).not.toHaveProperty("firstName");
        expect(entry).not.toHaveProperty("lastName");
        expect(entry).not.toHaveProperty("jobTitle");
      }

      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);

      // Response shape — IDs surface in input order.
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ id: 1001, email: "a@acme.com" });
      expect(result[1]).toMatchObject({ id: 1002, email: "b@acme.com" });
      expect(result[2]).toMatchObject({ id: 1003, email: "c@acme.com" });
    },
  );

  // -------------------------------------------------------------------------
  // (b) EMPTY input — short-circuit
  // -------------------------------------------------------------------------
  it(
    "(b) EMPTY leads array: returns [] WITHOUT making a fetch call " +
      "(no empty-batch 422)",
    async () => {
      const result = await client.createOrUpdateLeadsMultiple([]);
      expect(result).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  // -------------------------------------------------------------------------
  // (c) 422 non-retryable — surfaces immediately
  // -------------------------------------------------------------------------
  it(
    "(c) 422 response: throws EmailBisonApiError with status 422 (single " +
      "fetch — BL-086 inner-client status-aware retry skips 422)",
    async () => {
      // EB-flavoured 422 body with detailed validation errors.
      fetchMock.mockResolvedValue(
        mockResponse(
          {
            message: "The given data was invalid.",
            errors: {
              "leads.0.email": ["The email field is required."],
            },
          },
          422,
        ),
      );

      await expect(
        client.createOrUpdateLeadsMultiple(HAPPY_LEADS),
      ).rejects.toMatchObject({
        name: "EmailBisonApiError",
        status: 422,
      });

      // Critical regression guard: SINGLE fetch call.
      // The whole point of BL-088 is that a 422 surfaces immediately and
      // does NOT trigger the BL-086 amplifier. If this regresses to >1,
      // the inner client retried a non-retryable status (bug).
      expect(fetchMock).toHaveBeenCalledTimes(1);

      try {
        await client.createOrUpdateLeadsMultiple(HAPPY_LEADS);
      } catch (err) {
        expect(err).toBeInstanceOf(EmailBisonApiError);
      }
    },
  );

  // -------------------------------------------------------------------------
  // (d) Tolerant parse on 200 with drift — BL-085 pattern
  // -------------------------------------------------------------------------
  describe("(d) BL-085 tolerant parse — 200 with unexpected shape", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    const UNEXPECTED_SHAPES: Array<[label: string, body: unknown]> = [
      ["{data: null}", { data: null }],
      ["{success: true} (no data field)", { success: true }],
      ["empty object {}", {}],
      ["empty string ''", ""],
      [
        "{data: [{position:1}]} (entries missing required id+email)",
        { data: [{ position: 1 }] },
      ],
      ["{data: 'oops'} (data not array nor envelope)", { data: "oops" }],
    ];

    for (const [label, body] of UNEXPECTED_SHAPES) {
      it(
        `(d-${label}) 200 with ${label} → returns [] + emits [BL-088] warn, ` +
          "does NOT throw",
        async () => {
          fetchMock.mockResolvedValue(mockResponse(body));

          const result =
            await client.createOrUpdateLeadsMultiple(HAPPY_LEADS);

          // No throw — returns empty array so caller can proceed (or fail
          // explicitly via the zero-leads-to-attach branch downstream).
          expect(result).toEqual([]);

          // Single fetch call — tolerant parse must NOT internally retry.
          expect(fetchMock).toHaveBeenCalledTimes(1);

          // Warn has the [BL-088] prefix per the F4-style discipline.
          expect(warnSpy).toHaveBeenCalledTimes(1);
          const warnArg = warnSpy.mock.calls[0][0] as string;
          expect(warnArg).toMatch(/\[BL-088\]/);
          expect(warnArg).toMatch(/createOrUpdateLeadsMultiple/);
          expect(warnArg).toMatch(/response drift/);
          expect(warnArg).toMatch(/raw=/);
        },
      );
    }

    // Regression guard — explicit canary scenario. Pre-existing leads in
    // workspace accept the upsert and EB returns IDs. A future EB shape
    // change must surface in ops logs (warn fired) without breaking the
    // deploy.
    it(
      "(d-canary) regression — upsert succeeds with shape drift; " +
        "deploy proceeds via zero-IDs branch downstream",
      async () => {
        fetchMock.mockResolvedValue(
          mockResponse({ data: {}, success: true, batch_id: 999 }),
        );

        const result =
          await client.createOrUpdateLeadsMultiple(HAPPY_LEADS);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual([]);
        expect(warnSpy).toHaveBeenCalledTimes(1);
      },
    );
  });

  // -------------------------------------------------------------------------
  // (e) 5xx retryable — inner client retries (transient still loops)
  // -------------------------------------------------------------------------
  it(
    "(e) 503 retryable: inner client retries 3 times before giving up " +
      "(transient surface still gets the retry contract)",
    async () => {
      // EmailBisonClient.MAX_RETRIES = 3 (client.ts:86); 503 is in
      // RETRYABLE_STATUSES (client.ts:85). The inner request loop tries
      // 3 times with backoff (1s, 2s) — we mock all 3 as 503 and assert
      // the call count.
      fetchMock.mockResolvedValue(
        mockResponse({ message: "Service Unavailable" }, 503),
      );

      await expect(
        client.createOrUpdateLeadsMultiple([HAPPY_LEADS[0]]),
      ).rejects.toMatchObject({
        name: "EmailBisonApiError",
        status: 503,
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
    20_000, // generous timeout — inner backoff sleeps 1s + 2s = 3s minimum
  );

  // -------------------------------------------------------------------------
  // (f) Bare-array response — Zod union accepts both shapes
  // -------------------------------------------------------------------------
  it(
    "(f) bare-array response: parses correctly without an envelope " +
      "(historical EB pattern, see getSequenceSteps for precedent)",
    async () => {
      fetchMock.mockResolvedValue(
        mockResponse([
          { id: 5001, email: "a@acme.com", status: "active" },
          { id: 5002, email: "b@acme.com", status: "active" },
        ]),
      );

      const result = await client.createOrUpdateLeadsMultiple([
        HAPPY_LEADS[0],
        HAPPY_LEADS[1],
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 5001, email: "a@acme.com" });
      expect(result[1]).toMatchObject({ id: 5002, email: "b@acme.com" });
    },
  );
});
