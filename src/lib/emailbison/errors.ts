/**
 * Shared EmailBison error narrowing helpers.
 *
 * --------------------------------------------------------------------------
 * BL-078 — the dual-class problem (Phase 6a-rollback QA F1, 2026-04-16).
 * --------------------------------------------------------------------------
 * EmailBisonClient.getCampaign can throw TWO distinct error classes for the
 * same "record not found" semantic:
 *
 *   1. `EmailBisonApiError` (src/lib/emailbison/client.ts) — thrown when the
 *      HTTP response is non-2xx. Has `status: number` and an
 *      `isRecordNotFound: boolean` getter that checks
 *      `status === 404 && body.type === 'record_not_found'`.
 *
 *   2. `EmailBisonError` (src/lib/emailbison/types.ts) — thrown when the HTTP
 *      response is 200 but the body is empty/missing `data` (e.g. during
 *      EmailBison's async DELETE queue window — see
 *      `docs/emailbison-dedi-api-reference.md:572-589`). Has `code: string`
 *      (e.g. `'CAMPAIGN_NOT_FOUND'`) and `statusCode: number` (e.g. `404`).
 *      Does NOT have `status` or `isRecordNotFound`.
 *
 * Callers that narrowed to ONE class (`e as EmailBisonApiError`,
 * `err instanceof EmailBisonApiError && err.isRecordNotFound`) silently
 * mis-handled the other. In the Phase 6a-rollback incident the maintenance
 * script rethrew spuriously when EB returned 200-with-empty-data during the
 * DELETE-queue window because its catch only narrowed to EmailBisonApiError
 * and `err.isRecordNotFound` was `undefined` on the EmailBisonError instance
 * it actually received.
 *
 * `isNotFoundError` returns true iff the argument represents a 404 /
 * record-not-found semantic regardless of which error class it is wrapped
 * in. Use it wherever the intent is "is this a 404 so I can take the
 * not-found branch":
 *
 *   ```ts
 *   try {
 *     await ebClient.getCampaign(id);
 *   } catch (err) {
 *     if (isNotFoundError(err)) {
 *       // 404 handling — treat as absence, skip, mark deleted, etc.
 *     } else {
 *       throw err;
 *     }
 *   }
 *   ```
 *
 * Non-Error values (`null`, `undefined`, strings, plain objects, numbers,
 * symbols) return `false`. The helper never throws.
 */

import { EmailBisonApiError } from "./client";
import { EmailBisonError } from "./types";

/**
 * True iff `e` represents a 404 / record-not-found semantic from EmailBison,
 * regardless of which error class it was thrown as.
 *
 * Covers:
 *   - `EmailBisonApiError` with `status === 404` OR `isRecordNotFound === true`
 *     (HTTP-404 path — the client saw a non-2xx response).
 *   - `EmailBisonError` with `code === 'CAMPAIGN_NOT_FOUND'`
 *     OR `statusCode === 404`
 *     (semantic-404 path — the client got 200-with-empty-data and translated
 *     it to a not-found condition).
 *
 * Returns `false` for any other shape, including plain Error, non-Error
 * values (string, number, symbol, null, undefined, plain objects that
 * coincidentally have a `status: 404` property), and EB errors whose shape
 * does not match.
 *
 * This is a plain `boolean` rather than a type predicate — callers that
 * need narrowing should `instanceof`-check inside the 404 branch. Type
 * predicates here would falsely imply the error is one of two specific
 * classes, which would not help callers that want to access
 * `err.status`/`err.statusCode` for logging.
 */
export function isNotFoundError(e: unknown): boolean {
  if (e instanceof EmailBisonApiError) {
    return e.status === 404 || e.isRecordNotFound === true;
  }
  if (e instanceof EmailBisonError) {
    return e.code === "CAMPAIGN_NOT_FOUND" || e.statusCode === 404;
  }
  return false;
}
