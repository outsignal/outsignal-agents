/**
 * BL-093 monty-qa F2 (2026-04-16) — pure-helper tests for
 * `buildSequenceStepsForEB`.
 *
 * The helper is shared between:
 *   - `EmailAdapter.deploy` Step 3 — covered by
 *     `email-adapter-reply-thread.test.ts` (full deploy integration with
 *     mocked EB client + Prisma).
 *   - `agents/campaign.ts` signal-campaign pre-provisioning — previously
 *     bypassed the thread_reply rules entirely and 422'd EB on activation
 *     of any sequence with empty-subject follow-ups.
 *
 * These tests exercise the helper directly so its semantics can drift
 * independently of the adapter's other concerns (Prisma / EB client mock
 * setup). If the deploy-path integration test file ever breaks for
 * reasons unrelated to thread_reply, these still keep the shared helper
 * locked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSequenceStepsForEB } from "@/lib/channels/email-adapter";

describe("buildSequenceStepsForEB (BL-093 F2 shared helper)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------
  // Signal-campaign-path scenarios — the regression that prompted the
  // helper extraction. Pre-extraction, `agents/campaign.ts` posted to EB
  // without `thread_reply`, so an empty-subject follow-up step landed
  // EB 422 "email_subject required". With the helper, signal campaigns
  // get the same threading rules as the deploy path.
  // ---------------------------------------------------------------------

  it("signal-path: 3-step sequence with empty-subject step 2 emits thread_reply=true on step 2 and false on the others", () => {
    // Mirrors the shape `agents/campaign.ts` signal-campaign-activate
    // hands to the helper — typed loosely as the runtime payload from
    // Campaign.emailSequence (Prisma JSON).
    const emailSeq = [
      {
        position: 1,
        subjectLine: "hello there",
        body: "body 1",
        delayDays: 0,
      },
      { position: 2, subjectLine: "", body: "body 2", delayDays: 3 },
      {
        position: 3,
        subjectLine: "fresh angle",
        body: "body 3",
        delayDays: 7,
      },
    ];

    const out = buildSequenceStepsForEB(
      emailSeq,
      "Signal campaign cmsig0001 ('Funding signal — fintech')",
    );

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      position: 1,
      subject: "hello there",
      body: "body 1",
      delay_days: 3,
      thread_reply: false,
    });
    // Step 2 — RAW step-1 subject, thread_reply true. Pre-helper this
    // step was sent as { subject: "", ... } and EB 422'd.
    expect(out[1]).toEqual({
      position: 2,
      subject: "hello there",
      body: "body 2",
      delay_days: 4,
      thread_reply: true,
    });
    expect(out[2]).toEqual({
      position: 3,
      subject: "fresh angle",
      body: "body 3",
      delay_days: 0,
      thread_reply: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("signal-path: empty step-1 subject emits placeholder + warn (defensive edge)", () => {
    const emailSeq = [
      { position: 1, subjectLine: "", body: "body 1", delayDays: 0 },
      { position: 2, subjectLine: "", body: "body 2", delayDays: 3 },
    ];

    const out = buildSequenceStepsForEB(
      emailSeq,
      "Signal campaign cmsig0002 ('Hiring spike')",
    );

    expect(out[0].subject).toBe("(no subject)");
    expect(out[0].thread_reply).toBe(false);
    expect(out[0].delay_days).toBe(3);
    expect(out[1].subject).toBe("(no subject)");
    expect(out[1].thread_reply).toBe(true);
    expect(out[1].delay_days).toBe(0);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMsg = String(warnSpy.mock.calls[0][0]);
    expect(warnMsg).toMatch(/BL-093/);
    expect(warnMsg).toMatch(/Signal campaign cmsig0002/);
    expect(warnMsg).toMatch(/'Hiring spike'/);
  });

  it("signal-path: all subjects populated → thread_reply=false on every step (no Re: injection)", () => {
    const emailSeq = [
      { position: 1, subjectLine: "first", body: "b1", delayDays: 0 },
      { position: 2, subjectLine: "second", body: "b2", delayDays: 3 },
      { position: 3, subjectLine: "third", body: "b3", delayDays: 7 },
    ];

    const out = buildSequenceStepsForEB(emailSeq, "Signal cmsig0003");

    for (const step of out) {
      expect(step.thread_reply).toBe(false);
    }
    expect(out.map((s) => s.subject)).toEqual(["first", "second", "third"]);
  });

  // ---------------------------------------------------------------------
  // Deploy-path-style scenarios — the helper takes a `shouldEmit`
  // predicate so the deploy flow can pass the FULL stored sequence
  // (preserving step-1 anchor identification) while only emitting steps
  // not yet present in EB. These tests pin that contract.
  // ---------------------------------------------------------------------

  it("deploy-path predicate: re-deploy with step 1 already in EB → emits step 2 ONLY but still threads under step 1's stored subject", () => {
    const emailSeq = [
      {
        position: 1,
        subjectLine: "anchor subject",
        body: "b1",
        delayDays: 0,
      },
      { position: 2, subjectLine: "", body: "b2", delayDays: 3 },
      {
        position: 3,
        subjectLine: "third subject",
        body: "b3",
        delayDays: 7,
      },
    ];
    const existingPositions = new Set([1, 3]);

    const out = buildSequenceStepsForEB(
      emailSeq,
      "Campaign cmtest ('Re-deploy')",
      (step) => !existingPositions.has(step.position),
    );

    // Only step 2 emitted, but it correctly threads under step 1's
    // subject — the bug the predicate guards against is computing the
    // anchor from the FILTERED list (which would mis-treat step 2 as
    // step 1 and thread_reply=false).
    expect(out).toHaveLength(1);
    expect(out[0].position).toBe(2);
    expect(out[0].subject).toBe("anchor subject");
    expect(out[0].thread_reply).toBe(true);
    expect(out[0].delay_days).toBe(4);
  });

  it("deploy-path predicate: nothing to emit → returns empty array (helper short-circuits via filter)", () => {
    const emailSeq = [
      { position: 1, subjectLine: "x", body: "b1", delayDays: 0 },
      { position: 2, subjectLine: "", body: "b2", delayDays: 3 },
    ];
    const out = buildSequenceStepsForEB(
      emailSeq,
      "Campaign cmtest",
      () => false,
    );
    expect(out).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Sort & body fallback — pin the small bits.
  // ---------------------------------------------------------------------

  it("identifies step 1 by lowest position even when input order is shuffled", () => {
    const emailSeq = [
      { position: 3, subjectLine: "third", body: "b3", delayDays: 7 },
      { position: 1, subjectLine: "first", body: "b1", delayDays: 0 },
      { position: 2, subjectLine: "", body: "b2", delayDays: 3 },
    ];
    const out = buildSequenceStepsForEB(emailSeq, "ctx");
    // Output preserves INPUT order (no resorting) — mirrors the
    // pre-extraction adapter behaviour. The position field carries the
    // semantic order; EB sorts by position server-side.
    expect(out.map((s) => s.position)).toEqual([3, 1, 2]);
    // But step 2 must STILL thread under step 1's subject.
    const step2 = out.find((s) => s.position === 2)!;
    expect(step2.subject).toBe("first");
    expect(step2.thread_reply).toBe(true);
  });

  it("falls back to bodyText when body is not present", () => {
    // signal-path callers may pass {body} OR {bodyText}; helper handles both.
    const emailSeq = [
      {
        position: 1,
        subjectLine: "x",
        bodyText: "fallback body",
        delayDays: 0,
      },
    ];
    const out = buildSequenceStepsForEB(emailSeq, "ctx");
    expect(out[0].body).toBe("fallback body");
  });

  it("defaults an unspecified next-step gap to 1 day while keeping the final step at 0", () => {
    const emailSeq = [
      { position: 1, subjectLine: "x", body: "b1" },
      { position: 2, subjectLine: "", body: "b2" },
    ];
    const out = buildSequenceStepsForEB(emailSeq, "ctx");
    expect(out[0].delay_days).toBe(1);
    expect(out[1].delay_days).toBe(0);
  });

  it("preserves delayDays=0 (nullish coalescing semantics)", () => {
    const emailSeq = [
      { position: 1, subjectLine: "x", body: "b1", delayDays: 0 },
    ];
    const out = buildSequenceStepsForEB(emailSeq, "ctx");
    expect(out[0].delay_days).toBe(0);
  });

  it("translates a 2-step absolute schedule [0, 3] into EB gap semantics [3, 0]", () => {
    const emailSeq = [
      { position: 1, subjectLine: "first", body: "b1", delayDays: 0 },
      { position: 2, subjectLine: "", body: "b2", delayDays: 3 },
    ];

    const out = buildSequenceStepsForEB(emailSeq, "ctx");

    expect(out[0].delay_days).toBe(3);
    expect(out[1].delay_days).toBe(0);
  });
});
