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
  { position: 1, subject: "Hi there", body: "Email body 1", delay_days: 1 },
  { position: 2, subject: "Follow up", body: "Email body 2", delay_days: 3 },
  { position: 3, subject: "Final", body: "Email body 3", delay_days: 7 },
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
      wait_in_days: 1,
      order: 1,
      variant: false,
    },
    {
      id: 102,
      email_subject: "Follow up",
      email_body: "Email body 2",
      wait_in_days: 3,
      order: 2,
      variant: false,
    },
    {
      id: 103,
      email_subject: "Final",
      email_body: "Email body 3",
      wait_in_days: 7,
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

    expect(sequenceSteps[0]).toEqual({
      email_subject: "Hi there",
      email_body: "Email body 1",
      wait_in_days: 1,
    });
    expect(sequenceSteps[1]).toEqual({
      email_subject: "Follow up",
      email_body: "Email body 2",
      wait_in_days: 3,
    });
    expect(sequenceSteps[2]).toEqual({
      email_subject: "Final",
      email_body: "Email body 3",
      wait_in_days: 7,
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
      delay_days: 1,
    });
  });

  it("(a') HAPPY edge: delay_days=0 is clamped to wait_in_days=1 on the wire", async () => {
    // EB rejects wait_in_days<1 (spike notes line 170: "wait_in_days:
    // required, minimum 1 (NOT 0)"). Callers passing the consumer-facing
    // `delay_days: 0` for a day-0 initial email must still produce a
    // valid wire payload. The client clamps at the boundary.
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

  // ---------------------------------------------------------------------------
  // (b) EMPTY steps — skip the HTTP call entirely
  // ---------------------------------------------------------------------------
  it("(b) EMPTY steps array: returns [] WITHOUT making a fetch call (no empty-batch 422)", async () => {
    const result = await client.createSequenceSteps(CAMPAIGN_ID, TITLE, []);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
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
