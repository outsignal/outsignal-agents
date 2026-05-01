/**
 * EmailBisonClient.createSequenceSteps — wire-format contract test.
 *
 * Phase 6.5a / BL-074: the deprecated `createSequenceStep` (singular) posted
 * a flat `{position, subject, body, delay_days}` body to the v1 path
 * `/campaigns/{id}/sequence-steps`, which EB's v1.1 endpoint rejects with
 * 422 "title/sequence_steps required" (Phase 6a canary incident). The new
 * `createSequenceSteps` (plural, batch) targets the v1.1 path with the
 * EB-required `{title, sequence_steps:[{email_subject, email_body,
 * wait_in_days}]}` envelope.
 *
 * These tests assert the OUTGOING HTTP body shape — not just "fetch was
 * called" — by reading `fetchMock.mock.calls[N][1].body` and parsing the
 * JSON. That is the signal the 422 told us was missing, so that is what we
 * pin down here.
 *
 * Three cases:
 *   (a) HAPPY — 3-step batch hits v1.1 URL with the exact required envelope
 *   (b) EMPTY steps — short-circuits with zero fetch calls, returns []
 *   (c) 422 response — throws EmailBisonApiError with status 422
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EB_BASE = "https://app.outsignal.ai/api";
const CAMPAIGN_ID = 424242;
const TITLE = "Contract Campaign — Sequence";
const TOKEN = "contract-test-token";

/**
 * Build a Response-shaped object matching what EmailBisonClient.request()
 * reads (`ok`, `status`, `text()`, `json()`, `headers`).
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
 * Extract and parse the JSON body from a fetch mock call args tuple.
 * Fails the test with a descriptive error if the body is missing — better
 * than a silent `undefined` that skips the assertion.
 */
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HAPPY_STEPS = [
  { position: 1, subject: "Hi there", body: "Email body 1", delay_days: 3 },
  { position: 2, subject: "Follow up", body: "Email body 2", delay_days: 4 },
  { position: 3, subject: "Final", body: "Email body 3", delay_days: 0 },
];

/**
 * EB-shape response for a 3-step batch. Spike notes (.planning/spikes/
 * emailbison-api.md lines 121-140) describe the response as
 * `{ data: [ { id, email_subject, email_body, wait_in_days, order, ... } ] }`.
 */
const HAPPY_RESPONSE = {
  data: [
    {
      id: 101,
      email_subject: "Hi there",
      email_body: "Email body 1",
      wait_in_days: 3,
      order: 1,
      variant: false,
    },
    {
      id: 102,
      email_subject: "Follow up",
      email_body: "Email body 2",
      wait_in_days: 4,
      order: 2,
      variant: false,
    },
    {
      id: 103,
      email_subject: "Final",
      email_body: "Email body 3",
      wait_in_days: 1,
      order: 3,
      variant: false,
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmailBisonClient.createSequenceSteps — wire-format contract (BL-074)", () => {
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

  // ---------------------------------------------------------------------------
  // (a) HAPPY — asserts URL, method, and outbound body shape
  // ---------------------------------------------------------------------------
  it("(a) HAPPY: POSTs to v1.1 path with {title, sequence_steps:[{email_subject, email_body, wait_in_days}]} envelope", async () => {
    fetchMock.mockResolvedValue(mockResponse(HAPPY_RESPONSE));

    const result = await client.createSequenceSteps(
      CAMPAIGN_ID,
      TITLE,
      HAPPY_STEPS,
    );

    // ------ Call count + URL + method ------
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];

    const url = call[0] as string;
    const options = call[1] as RequestInit;

    // URL must hit the v1.1 path for the correct campaign ID.
    expect(url).toBe(
      `${EB_BASE}/campaigns/v1.1/${CAMPAIGN_ID}/sequence-steps`,
    );
    expect(options.method).toBe("POST");

    // ------ Body shape (the load-bearing assertion) ------
    // This is what the 422 on Phase 6a told us was wrong — read the raw
    // body out of the fetch call args and parse it explicitly, not just
    // "fetch was called with some body".
    const body = readFetchBody(call);

    // 1. `title` is the string we passed — EB docs describe it as required.
    expect(body.title).toBe(TITLE);

    // 2. `sequence_steps` is an array of length 3.
    expect(Array.isArray(body.sequence_steps)).toBe(true);
    expect((body.sequence_steps as unknown[]).length).toBe(3);

    // 3. Each entry has the EB-required snake_case keys (not our
    //    consumer-facing {position, subject, body, delay_days} shape — the
    //    client handles transformation internally).
    const sequenceSteps = body.sequence_steps as Array<Record<string, unknown>>;

    // BL-093 (2026-04-16): payload now includes `thread_reply` boolean.
    // Default is false when callers don't pass thread_reply (matches the
    // pre-BL-093 wire shape semantically — fresh thread, requires
    // populated subject).
    expect(sequenceSteps[0]).toEqual({
      email_subject: "Hi there",
      email_body: "Email body 1",
      wait_in_days: 3,
      thread_reply: false,
    });
    expect(sequenceSteps[1]).toEqual({
      email_subject: "Follow up",
      email_body: "Email body 2",
      wait_in_days: 4,
      thread_reply: false,
    });
    expect(sequenceSteps[2]).toEqual({
      email_subject: "Final",
      email_body: "Email body 3",
      wait_in_days: 1,
      thread_reply: false,
    });

    // 4. Defensive — NONE of the old flat-shape keys leak into the body
    //    (no `position`, `subject`, `body`, or `delay_days` at the root
    //    OR in any sequence_steps entry). This is the regression guard:
    //    the old wire format would fail EB 422 validation.
    expect(body).not.toHaveProperty("position");
    expect(body).not.toHaveProperty("subject");
    expect(body).not.toHaveProperty("body");
    expect(body).not.toHaveProperty("delay_days");
    for (const step of sequenceSteps) {
      expect(step).not.toHaveProperty("position");
      expect(step).not.toHaveProperty("subject");
      expect(step).not.toHaveProperty("body");
      expect(step).not.toHaveProperty("delay_days");
    }

    // 5. Authorization header is present (sanity — not the focus of this
    //    test but confirms the request pipeline is intact).
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);

    // ------ Return shape ------
    // Response is normalized to SequenceStep[] — position comes from
    // `order`, subject/body from EB's email_subject/email_body.
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: 101,
      campaign_id: CAMPAIGN_ID,
      position: 1,
      subject: "Hi there",
      body: "Email body 1",
      delay_days: 3,
    });
  });

  it("(a') HAPPY edge: semantic final-step gap 0 is clamped to wait_in_days=1 on the wire", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        data: [
          { id: 201, email_subject: "s", email_body: "b", wait_in_days: 1, order: 1 },
        ],
      }),
    );

    await client.createSequenceSteps(CAMPAIGN_ID, TITLE, [
      { position: 1, subject: "s", body: "b", delay_days: 0 },
    ]);

    const body = readFetchBody(fetchMock.mock.calls[0]);
    const sequenceSteps = body.sequence_steps as Array<Record<string, unknown>>;
    expect(sequenceSteps[0].wait_in_days).toBe(1);
  });

  it("(a'') clamps semantic zero gaps at any position to EB's minimum wait_in_days=1", async () => {
    fetchMock.mockResolvedValue(mockResponse(HAPPY_RESPONSE));

    await client.createSequenceSteps(CAMPAIGN_ID, TITLE, [
      { position: 1, subject: "s1", body: "b1", delay_days: 3 },
      { position: 2, subject: "s2", body: "b2", delay_days: 0 },
      { position: 3, subject: "s3", body: "b3", delay_days: 1 },
    ]);

    const body = readFetchBody(fetchMock.mock.calls[0]);
    const sequenceSteps = body.sequence_steps as Array<Record<string, unknown>>;
    expect(sequenceSteps[0].wait_in_days).toBe(3);
    expect(sequenceSteps[1].wait_in_days).toBe(1);
    expect(sequenceSteps[2].wait_in_days).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // BL-093 — thread_reply boolean + variable transform on the wire
  // ---------------------------------------------------------------------------
  //
  // EB schema (verified 2026-04-16 against canary EB 87 + live Lime
  // production campaigns): sequence_steps accept `thread_reply` boolean.
  // When true, EB (i) emits RFC 5322 reply headers and (ii) AUTO-PREPENDS
  // "Re: " to email_subject before storage. The client just forwards
  // whatever the caller passes — the email-adapter is responsible for
  // selecting the right subject (RAW step-1 subject for threaded follow-ups,
  // own subject for fresh threads).
  it("BL-093 (vendor-authoritative): thread_reply=true forwarded on the wire; canonical {FIRSTNAME} variable transformed to {FIRST_NAME}", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        data: [
          { id: 301, email_subject: "step 1", email_body: "body 1", wait_in_days: 1, order: 1 },
          { id: 302, email_subject: "Re: step 1", email_body: "body 2", wait_in_days: 3, order: 2 },
        ],
      }),
    );

    await client.createSequenceSteps(CAMPAIGN_ID, TITLE, [
      // Step 1 — fresh thread, populated subject, has variables.
      {
        position: 1,
        subject: "Hi {FIRSTNAME}",
        body: "Hello {FIRSTNAME}, about {COMPANYNAME}.\n\nCheers,\n{SENDER_FIRST_NAME}",
        delay_days: 0,
        thread_reply: false,
      },
      // Step 2 — threaded follow-up. Caller (email-adapter) passes the
      // RAW step-1 subject; EB will auto-prepend "Re:" server-side.
      // thread_reply=true tells EB to emit reply headers.
      {
        position: 2,
        subject: "Hi {FIRSTNAME}",
        body: "Following up, {FIRSTNAME}.",
        delay_days: 3,
        thread_reply: true,
      },
    ]);

    const body = readFetchBody(fetchMock.mock.calls[0]);
    const sequenceSteps = body.sequence_steps as Array<Record<string, unknown>>;
    expect(sequenceSteps).toHaveLength(2);

    // Step 1 — variables transformed at the wire boundary to EB vendor spec
    // (SINGLE-curly UPPER_SNAKE). SENDER_FIRST_NAME is vendor-native and
    // passes through unchanged.
    expect(sequenceSteps[0].email_subject).toBe("Hi {FIRST_NAME}");
    expect(sequenceSteps[0].email_body).toBe(
      "Hello {FIRST_NAME}, about {COMPANY}.\n\nCheers,\n{SENDER_FIRST_NAME}",
    );
    expect(sequenceSteps[0].thread_reply).toBe(false);

    // Step 2 — RAW step-1 subject (NOT prefixed) AND thread_reply=true.
    // Variable in the subject is also transformed to vendor spec.
    expect(sequenceSteps[1].email_subject).toBe("Hi {FIRST_NAME}");
    expect(sequenceSteps[1].email_body).toBe("Following up, {FIRST_NAME}.");
    expect(sequenceSteps[1].thread_reply).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (b) EMPTY steps — skip the HTTP call entirely
  // ---------------------------------------------------------------------------
  it("(b) EMPTY steps array: returns [] WITHOUT making a fetch call (no empty-batch 422)", async () => {
    const result = await client.createSequenceSteps(CAMPAIGN_ID, TITLE, []);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // (b') BL-085 TOLERANT PARSE — 200 with unexpected shape returns [] (no throw)
  // ---------------------------------------------------------------------------
  //
  // BL-085 (2026-04-16) — the v1.1 POST /sequence-steps response shape is
  // UNDOCUMENTED; the spike-notes shape we pinned to was from v1. In
  // production (canary Campaign cmneqixpv, EB 82, deploy cmo1ig1yf) EB
  // returned 200 with a body that failed our Zod schema, which previously
  // threw EmailBisonError("UNEXPECTED_RESPONSE", 200, ...). That throw was
  // then caught by the caller's `withRetry` wrap in email-adapter.ts Step 3,
  // which re-POSTED the full batch on every retry → EB appended the steps
  // again each time → 9 sequence steps from 3 steps × 3 retries.
  //
  // Fix: on HTTP 200, try Zod parse. On SUCCESS → map and return. On
  // FAILURE → log a descriptive warn and return []. The response body is
  // not actually consumed by email-adapter.ts (Step 3 idempotency reads
  // `getSequenceSteps` GET to determine missing positions), so returning
  // [] is safe. The warn preserves observability of schema drift.
  //
  // 4xx/5xx are still thrown by the underlying `request` helper — only
  // 200-with-unexpected-shape is tolerated here.
  describe("(b') BL-085 tolerant parse — 200 with unexpected shape", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    // Table-driven — each entry is a plausible shape EB v1.1 could have
    // returned that does NOT match our Zod schema. The production shape is
    // still unknown (the canary error message was truncated to 500 chars),
    // so we test the shapes most likely to appear: null data, absent
    // data, empty object, empty string, and the Phase 6a-v1.1-likely
    // alternative `{data: {}, success: true}` (EB wraps other endpoint
    // responses like this — docs reference pattern).
    const UNEXPECTED_SHAPES: Array<[label: string, body: unknown]> = [
      ["{data: null}", { data: null }],
      ["{success: true}", { success: true }],
      ["empty object {}", {}],
      ["empty string ''", ""],
      [
        "{data: {}, success: true} (v1.1-likely envelope)",
        { data: {}, success: true },
      ],
      // Another plausible v1.1 shape — data shape is array but entries
      // are missing the required `id` number field. Individual-element
      // schema failure cascades to the response-level Zod fail.
      [
        "{data: [{position: 1}]} (missing required id)",
        { data: [{ position: 1 }] },
      ],
    ];

    for (const [label, body] of UNEXPECTED_SHAPES) {
      it(`(b'-${label}) 200 with ${label} → returns [] + warns, does NOT throw`, async () => {
        fetchMock.mockResolvedValue(mockResponse(body));

        const result = await client.createSequenceSteps(
          CAMPAIGN_ID,
          TITLE,
          HAPPY_STEPS,
        );

        // No throw — returns empty array so caller proceeds.
        expect(result).toEqual([]);

        // Exactly one fetch call — the tolerant parse path must NOT retry
        // internally (that would re-trigger the amplifier bug the fix was
        // introduced to prevent).
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Warn MUST be emitted so schema drift is visible in ops logs.
        // Check for the BL-085 signature + the "tolerating drift" phrase
        // + evidence of the raw body preview.
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const warnArg = warnSpy.mock.calls[0][0] as string;
        expect(warnArg).toMatch(/createSequenceSteps/);
        expect(warnArg).toMatch(/tolerating drift/i);
        expect(warnArg).toMatch(/Raw \(first 500 chars\)/);
      });
    }

    // Regression guard — the specific canary scenario. Emulates what
    // happened on 2026-04-16: EB v1.1 returns 200 with a shape that
    // previously caused the Zod schema to fail, which in turn caused
    // the caller's withRetry to loop. With Fix A this returns [] and
    // with Fix B (withRetry removal) the single POST is never repeated.
    it("(b'-regression) canary Step 3 failure mode — returns [] without throwing", async () => {
      // Use the shape most likely to match what EB actually sent. Even
      // if the exact production shape is different, the tolerant parse
      // path covers all non-matching 200 responses.
      fetchMock.mockResolvedValue(
        mockResponse({ data: {}, success: true, campaign_id: CAMPAIGN_ID }),
      );

      const result = await client.createSequenceSteps(
        CAMPAIGN_ID,
        TITLE,
        HAPPY_STEPS,
      );

      // The key invariant: SINGLE fetch call, NO throw. This is what
      // prevents the 3× duplicate sequence steps the canary produced.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // (c) 422 response — EB rejection bubbles as EmailBisonApiError
  // ---------------------------------------------------------------------------
  it("(c) 422 response: throws EmailBisonApiError with status === 422 (no retry — 422 is non-retryable)", async () => {
    // EB's actual 422 body from Phase 6a canary. Using the real shape
    // rather than a bare `{ error: "bad" }` so the test also guards the
    // error-body parsing path if we ever add logic that reads
    // `err.parsedBody.message`.
    fetchMock.mockResolvedValue(
      mockResponse(
        {
          message: "The title field is required.",
          errors: {
            title: ["The title field is required."],
            sequence_steps: ["The sequence steps field is required."],
          },
        },
        422,
      ),
    );

    await expect(
      client.createSequenceSteps(CAMPAIGN_ID, TITLE, HAPPY_STEPS),
    ).rejects.toMatchObject({
      name: "EmailBisonApiError",
      status: 422,
    });

    // 422 is NOT in the retry set (RETRYABLE_STATUSES = 429/500/502/503/504)
    // so the client fails fast on the first attempt — exactly one fetch call.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Error is the documented type so callers can `instanceof`-branch on it.
    try {
      await client.createSequenceSteps(CAMPAIGN_ID, TITLE, HAPPY_STEPS);
    } catch (err) {
      expect(err).toBeInstanceOf(EmailBisonApiError);
    }
  });
});

// ---------------------------------------------------------------------------
// BL-074 follow-through (Phase 6.5b) — getSequenceSteps GET path migration
// ---------------------------------------------------------------------------
//
// Phase 6.5a fixed the CREATE path (POST) to use the v1.1 batch endpoint.
// Phase 6.5b fixes the READ path (GET) to also use v1.1 — the deprecated v1
// path `/campaigns/{id}/sequence-steps` was the last remaining reference.
//
// These tests assert the outgoing fetch URL uses the v1.1 path and that the
// response is parsed via Zod-at-boundary (schema drift throws loudly rather
// than silently casting). This mirrors the createSequenceSteps contract above.
// ---------------------------------------------------------------------------

describe("EmailBisonClient.getSequenceSteps — v1.1 READ path (BL-074 follow-through)", () => {
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

  it("GETs the v1.1 path and maps snake_case to the internal SequenceStep shape", async () => {
    // EB v1.1 response shape per docs line 1318 + spike notes:
    // `{ data: [ { id, email_subject, email_body, wait_in_days, order, ... } ] }`.
    fetchMock.mockResolvedValue(
      mockResponse({
        data: [
          {
            id: 301,
            email_subject: "Hi there",
            email_body: "Body 1",
            wait_in_days: 1,
            order: 1,
            variant: false,
          },
          {
            id: 302,
            email_subject: "Follow up",
            email_body: "Body 2",
            wait_in_days: 3,
            order: 2,
            variant: true,
          },
        ],
      }),
    );

    const result = await client.getSequenceSteps(CAMPAIGN_ID);

    // URL must hit the v1.1 path — asserts the deprecated v1
    // `/campaigns/{id}/sequence-steps` path is no longer used.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(`${EB_BASE}/campaigns/v1.1/${CAMPAIGN_ID}/sequence-steps`);
    expect(url).toContain("/v1.1/");
    // Defensive — the old v1 path segment `/campaigns/{id}/sequence-steps`
    // (with the campaign id immediately after /campaigns/) must NOT appear.
    expect(url).not.toMatch(
      new RegExp(`/campaigns/${CAMPAIGN_ID}/sequence-steps`),
    );

    // Method default is GET; the request helper omits the method header when
    // no body is passed. Just assert body is absent.
    const options = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(options?.body).toBeUndefined();

    // Response shape normalization: email_subject → subject, email_body → body,
    // wait_in_days → delay_days, order → position. campaign_id falls back to
    // the argument when absent from the response.
    expect(result).toEqual([
      {
        id: 301,
        campaign_id: CAMPAIGN_ID,
        position: 1,
        subject: "Hi there",
        body: "Body 1",
        delay_days: 1,
        variant: false,
      },
      {
        id: 302,
        campaign_id: CAMPAIGN_ID,
        position: 2,
        subject: "Follow up",
        body: "Body 2",
        delay_days: 3,
        variant: true,
      },
    ]);
  });

  it("accepts a bare-array response shape (historical EB behaviour)", async () => {
    // Historically EB has returned both `{ data: [...] }` and a bare array;
    // the Zod union tolerates both so a shape-flip in production doesn't
    // silently break the reader.
    fetchMock.mockResolvedValue(
      mockResponse([
        { id: 401, subject: "legacy", body: "legacy body", position: 1, delay_days: 0 },
      ]),
    );

    const result = await client.getSequenceSteps(CAMPAIGN_ID);

    expect(result).toEqual([
      {
        id: 401,
        campaign_id: CAMPAIGN_ID,
        position: 1,
        subject: "legacy",
        body: "legacy body",
        delay_days: 0,
      },
    ]);
  });

  it("throws UNEXPECTED_RESPONSE when the Zod schema fails (drift guard)", async () => {
    // EB returns something that's neither `{data:[...]}` nor a bare array —
    // e.g. a bare object. Zod parse must fail and surface an EmailBisonError
    // rather than silently returning an empty or malformed list.
    fetchMock.mockResolvedValue(mockResponse({ not_data: "oops" }));

    await expect(client.getSequenceSteps(CAMPAIGN_ID)).rejects.toThrow(
      /UNEXPECTED_RESPONSE|getSequenceSteps response failed schema validation/,
    );
  });
});

// ---------------------------------------------------------------------------
// EB-PUT variant requirement (2026-05-01)
// ---------------------------------------------------------------------------
//
// EB support confirmed that PUT /campaigns/v1.1/sequence-steps/{sequence_id}
// returns 500 unless each sequence_steps entry includes `variant`. This pins
// the update helper to the live-working wire shape verified against
// yoopknows campaign 123 / sequence 87 / step 363.
// ---------------------------------------------------------------------------

describe("EmailBisonClient.updateSequenceSteps — v1.1 UPDATE path requires variant", () => {
  let client: EmailBisonClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new EmailBisonClient(TOKEN);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("PUTs the v1.1 sequence update path and preserves caller-provided variant", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        data: {
          id: 87,
          type: "Campaign sequence",
          title: TITLE,
          sequence_steps: [
            {
              id: 363,
              email_subject: "Re: how {COMPANY} manages projects",
              email_body: "Body",
              wait_in_days: 7,
              order: 2,
              variant: true,
              thread_reply: false,
            },
          ],
        },
      }),
    );

    const result = await client.updateSequenceSteps(87, TITLE, [
      {
        id: 363,
        position: 2,
        subject: "Re: how {COMPANYNAME} manages projects",
        body: "Body",
        delay_days: 7,
        thread_reply: false,
        variant: true,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const options = call[1] as RequestInit;
    expect(url).toBe(`${EB_BASE}/campaigns/v1.1/sequence-steps/87`);
    expect(options.method).toBe("PUT");

    const body = readFetchBody(call);
    expect(body.title).toBe(TITLE);
    expect(body.sequence_steps).toEqual([
      {
        id: 363,
        order: 2,
        email_subject: "Re: how {COMPANY} manages projects",
        email_body: "Body",
        wait_in_days: 7,
        thread_reply: false,
        variant: true,
      },
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        id: 363,
        campaign_id: 0,
        position: 2,
        subject: "Re: how {COMPANY} manages projects",
        body: "Body",
        delay_days: 7,
        variant: true,
      },
    ]);
  });

  it("defaults omitted variant to false and warns so the PUT does not hit EB's 500 path", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        data: {
          id: 87,
          sequence_steps: [
            {
              id: 363,
              email_subject: "Subject",
              email_body: "Body",
              wait_in_days: 7,
              order: 2,
              variant: false,
            },
          ],
        },
      }),
    );

    await client.updateSequenceSteps(87, TITLE, [
      {
        id: 363,
        position: 2,
        subject: "Subject",
        body: "Body",
        delay_days: 7,
      },
    ]);

    const body = readFetchBody(fetchMock.mock.calls[0]);
    expect(body.sequence_steps).toEqual([
      {
        id: 363,
        order: 2,
        email_subject: "Subject",
        email_body: "Body",
        wait_in_days: 7,
        thread_reply: false,
        variant: false,
      },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/missing variant.*defaulting to false/i);
  });
});
