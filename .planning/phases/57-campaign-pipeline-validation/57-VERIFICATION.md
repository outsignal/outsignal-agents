# Phase 57 Verification Checklist

## Success Criteria (from ROADMAP.md)

1. [ ] An email campaign list built from a LinkedIn-only discovery run fails the data quality pre-check — the error names the specific gap ("0 verified emails in this list")
   - **Plan 01**: validateListForChannel("email", list) returns hard failure with message
   - **Plan 02**: publishForReview throws with this message

2. [ ] When a person appears in two active campaigns for the same workspace, list-building returns a warning naming the overlapping campaign before proceeding
   - **Plan 01**: detectOverlaps returns OverlapResult[] with campaign name
   - **Plan 02**: publishForReview includes overlap warnings in response

3. [ ] Company names in a list pass through normalizeCompanyNameForCopy() before any {COMPANYNAME} variable is used in copy generation
   - **Plan 01**: normalize.ts exports normalisation functions; list-validation checks normalisation
   - **Plan 02**: publishForReview runs normalisation checks

4. [ ] The portal approve-content route returns HTTP 422 (not 200 with warnings) when structural copy violations exist — the portal UI handles the error state and displays the violation to the client
   - **Plan 02**: approve-content returns 422 on hard violations; portal component handles 422

5. [ ] A cost breakdown is accessible after any pipeline run: discovery cost + enrichment cost + total cost-per-verified-lead
   - **Plan 01**: PipelineCostLog model + getCampaignCostBreakdown function

## Requirement Coverage

| Requirement | Plan | How |
|-------------|------|-----|
| PIPE-01 | 01 + 02 | validateListForChannel in 01, wired into publishForReview in 02 |
| PIPE-02 | 01 + 02 | detectOverlaps in 01, wired into publishForReview in 02 |
| PIPE-03 | 01 + 02 | normalizeJobTitle/Location/Industry in 01, normalisation check in list-validation |
| PIPE-04 | 01 + 02 | runDataQualityPreCheck in 01, wired into publishForReview in 02 |
| PIPE-05 | 02 | runFullSequenceValidation + 422 in approve-content + portal error UI |
| PIPE-06 | 01 | PipelineCostLog model + logPipelineCost + getCampaignCostBreakdown |
