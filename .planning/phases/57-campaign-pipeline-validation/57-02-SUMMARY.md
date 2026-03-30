---
phase: 57-campaign-pipeline-validation
plan: 02
status: complete
started: "2026-03-30"
completed: "2026-03-30"
---

# Plan 57-02 Summary

## One-Liner
Integrated validation modules into the campaign pipeline: portal approve-content returns HTTP 422 on hard copy violations, publishForReview gates on list quality and overlap detection, and portal UI handles error states.

## What Was Built
Added runFullSequenceValidation to copy-quality.ts that aggregates all copy quality checks (banned patterns, word count, greeting, CTA, subject line, LinkedIn spintax) with severity classification. Updated the portal approve-content route to return HTTP 422 with structured violation list when hard violations exist, and 200 with warnings for soft-only violations. Enhanced publishForReview in operations.ts to run validateListForChannel (hard-blocks on channel requirement failures), runDataQualityPreCheck (warnings for data quality issues), and detectOverlaps (warnings for cross-campaign overlaps). Updated portal campaign-approval-content.tsx with red violation banner on 422 (approve button hidden, Request Changes shown) and amber warning banner on 200 with soft warnings.

## Key Files
### Created
- None

### Modified
- `src/lib/copy-quality.ts` — Added runFullSequenceValidation and FullValidationResult (+105 lines)
- `src/app/api/portal/campaigns/[id]/approve-content/route.ts` — Replaced checkSequenceQuality with runFullSequenceValidation, returns 422 on hard violations
- `src/lib/campaigns/operations.ts` — Enhanced publishForReview with list validation, overlap detection, and data quality checks (+86 lines)
- `src/components/portal/campaign-approval-content.tsx` — Added 422 error state UI with violation list and warning banners (+121 lines)
- `src/app/api/campaigns/[id]/publish/route.ts` — Minor updates for validation integration

## Self-Check: PASSED

## Deviations
None — executed as single squash commit by parallel agent.
