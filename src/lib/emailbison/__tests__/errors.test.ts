/**
 * isNotFoundError — shared 404-narrowing helper (BL-078).
 *
 * Exercises BOTH EmailBison error classes and a full negative matrix:
 *
 *   - EmailBisonApiError (HTTP 404 path):
 *       * status=404 plain → true
 *       * status=404 + record_not_found body (isRecordNotFound getter) → true
 *       * status=500 → false
 *       * status=400 → false
 *
 *   - EmailBisonError (semantic-404 path — 200-with-empty-data during EB's
 *     async DELETE queue window, Phase 6a-rollback QA F1):
 *       * code='CAMPAIGN_NOT_FOUND' + statusCode=404 → true
 *       * code='UNEXPECTED_RESPONSE' + statusCode=200 → false
 *       * code='OTHER' + statusCode=404 → true (statusCode alone sufficient)
 *
 *   - Non-Error inputs (null/undefined/string/plain object/number/symbol):
 *       * all → false (helper never throws, never mis-reports)
 *
 *   - Plain Error (unrelated throw) → false (we only match EB classes, not
 *     any Error with `status: 404`).
 */

import { describe, expect, it } from "vitest";

import { EmailBisonApiError } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";
import { isNotFoundError } from "@/lib/emailbison/errors";

describe("isNotFoundError", () => {
  // ---------------------------------------------------------------------
  // EmailBisonApiError — HTTP-404 path
  // ---------------------------------------------------------------------

  it("returns true for EmailBisonApiError with status=404 (plain body)", () => {
    const err = new EmailBisonApiError(404, "Not found");
    expect(isNotFoundError(err)).toBe(true);
  });

  it("returns true for EmailBisonApiError with status=404 AND isRecordNotFound=true (record_not_found body)", () => {
    const err = new EmailBisonApiError(
      404,
      JSON.stringify({ data: { record_not_found: { campaign: "79" } } }),
    );
    // Sanity: the getter must agree — if it doesn't, the helper test is
    // covering the wrong shape.
    expect(err.isRecordNotFound).toBe(true);
    expect(isNotFoundError(err)).toBe(true);
  });

  it("returns false for EmailBisonApiError with status=500", () => {
    const err = new EmailBisonApiError(500, "Internal server error");
    expect(isNotFoundError(err)).toBe(false);
  });

  it("returns false for EmailBisonApiError with status=400", () => {
    const err = new EmailBisonApiError(400, "Bad request");
    expect(isNotFoundError(err)).toBe(false);
  });

  // ---------------------------------------------------------------------
  // EmailBisonError — semantic-404 path
  // ---------------------------------------------------------------------

  it("returns true for EmailBisonError with code='CAMPAIGN_NOT_FOUND' and statusCode=404", () => {
    const err = new EmailBisonError(
      "CAMPAIGN_NOT_FOUND",
      404,
      "No campaign data returned for id=79",
    );
    expect(isNotFoundError(err)).toBe(true);
  });

  it("returns false for EmailBisonError with code='UNEXPECTED_RESPONSE' and statusCode=200", () => {
    const err = new EmailBisonError(
      "UNEXPECTED_RESPONSE",
      200,
      "Shape drift on /campaigns/{id}",
    );
    expect(isNotFoundError(err)).toBe(false);
  });

  it("returns true for EmailBisonError with a different code but statusCode=404 (statusCode alone is sufficient)", () => {
    const err = new EmailBisonError(
      "SOME_OTHER_CODE",
      404,
      "Some other 404 variant",
    );
    expect(isNotFoundError(err)).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Unrelated Error + non-Error inputs — helper must never mis-report
  // ---------------------------------------------------------------------

  it("returns false for a plain Error with no EB-specific shape", () => {
    expect(isNotFoundError(new Error("random"))).toBe(false);
  });

  it("returns false for null, undefined, strings, and plain objects (including plain objects with status=404)", () => {
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError("some string")).toBe(false);
    // Plain object that LOOKS like an EB error but isn't an instance of one.
    // The helper must reject it — we only trust real instanceof checks.
    expect(isNotFoundError({ status: 404 })).toBe(false);
    expect(isNotFoundError({ code: "CAMPAIGN_NOT_FOUND", statusCode: 404 })).toBe(false);
  });

  it("returns false for symbols and numbers", () => {
    expect(isNotFoundError(Symbol("nope"))).toBe(false);
    expect(isNotFoundError(404)).toBe(false);
    expect(isNotFoundError(0)).toBe(false);
  });
});
