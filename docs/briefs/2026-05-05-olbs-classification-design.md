# OLBS Classification Phase 0 Design

Date: 2026-05-05
Scope: 1210 Solutions OLBS-sourced transport target lists
Status: design-only, no schema or data changes

## Summary

The 1210 "transport" source lists are not pure transport-business lists. They are DVSA OLBS operator-licence holders stored as `Lead` rows with `source = "olbs"` and OLBS metadata embedded in `Lead.enrichmentData`. That metadata is strong enough to support a first-pass company-level classifier, but not strong enough to rely on any single signal.

Recommendation: create a company-level OLBS classification layer in a future Phase 1, backed by persistent Companies House lookup cache and a dry-run confusion matrix before any target-list mutation. Do not store this on `Person`/`Lead`; the classification is about the operator/company.

## Inventory Findings

### Where OLBS Data Lives

OLBS data is currently stored on the Prisma `Person` model, which maps to SQL table `Lead`.

Relevant schema:

- `Person.source` is `"olbs"` for OLBS rows.
- `Person.company`, `companyDomain`, `firstName`, `lastName`, `location` hold operator/person-ish fields.
- `Person.enrichmentData` is a JSON string containing OLBS fields.
- `TargetListPerson` links target lists to those `Person`/`Lead` rows.
- `Company` is populated for resolved domains but does not carry OLBS-specific fields.

Representative `Lead.enrichmentData` keys from a 500-row OLBS sample:

```text
allDirectors
aprSlice
companyRegNumber
continuationDate
correspondenceAddress
fleetBand
licenceNumber
licenceType
ocAddress
olbsImport
operatorType
region
subCampaign
trailersAuthorised
transportManager
vehiclesAuthorised
```

Example row shape:

```json
{
  "source": "olbs",
  "company": "PARSONS NATIONWIDE DISTRIBUTION LTD",
  "companyDomain": "parsonsnationwide.co.uk",
  "firstName": "Noreen Anne",
  "lastName": "Hoskin",
  "location": "West of England",
  "enrichmentData": {
    "olbsImport": true,
    "fleetBand": "11-50",
    "companyRegNumber": "3746821",
    "operatorType": "Limited Company",
    "licenceType": "Standard International",
    "licenceNumber": "OH0223357",
    "vehiclesAuthorised": 50,
    "trailersAuthorised": 40,
    "transportManager": "RICHARD HOSKIN",
    "region": "West of England",
    "aprSlice": true,
    "subCampaign": "regional_5_50"
  }
}
```

### 1210 OLBS Target Lists

Nine 1210 target lists currently match OLBS transport/restricted sourcing:

| List | Rows |
| --- | ---: |
| Transport - East of England - Apr 2026 | 3020 |
| Transport - London and South East - Apr 2026 | 1450 |
| Transport - North East - Apr 2026 | 2073 |
| Transport - North West - Apr 2026 | 1604 |
| Transport - Scotland - Apr 2026 | 1287 |
| Transport - Wales - Apr 2026 | 899 |
| Transport - West Midlands - Apr 2026 | 1384 |
| Transport - West of England - Apr 2026 | 1601 |
| future_direct_employer_restricted | 6103 |

Aggregate over those nine lists:

| Metric | Count |
| --- | ---: |
| Target-list memberships | 19421 |
| Distinct people/leads | 19421 |
| `source = "olbs"` | 19421 |
| `companyRegNumber` present | 17572 |
| `companyRegNumber` missing | 1849 |
| `companyDomain` present | 5810 |
| `companyDomain` missing | 13611 |
| Matching `Company` rows by domain | 5536 |

Licence-type distribution:

| Licence type | Count |
| --- | ---: |
| Standard National | 9051 |
| Standard International | 4267 |
| Restricted | 6103 |

Operator-type distribution:

| Operator type | Count |
| --- | ---: |
| Limited Company | 17522 |
| Sole Trader | 1142 |
| Partnership | 716 |
| Limited Liability Partnership | 41 |

Fleet-band distribution:

| Fleet band | Count |
| --- | ---: |
| 5-10 | 12230 |
| 11-50 | 6693 |
| 51-100 | 498 |

### Stable Keys

Preferred identity key order:

1. `companyRegNumber` from OLBS enrichment data. Present on 90.5% of OLBS target-list memberships. This is the best Companies House key when available.
2. `licenceNumber` as OLBS-specific provenance. Useful for audit, but a company may hold multiple licences.
3. Normalized company name + region/operator address for rows without a registration number.
4. `companyDomain` as evidence and optional Company-table link, not as canonical identity. Only 30% of the OLBS target-list memberships have a domain.

The design should not assume every OLBS row is a limited company. Sole traders and partnerships often have no `companyRegNumber`; they need a fallback path and likely manual review.

### Existing Industry / Classification Data

The existing `Company` table has some enrichment fields but is sparse for OLBS domains:

| Field on Company | Populated among OLBS domains |
| --- | ---: |
| `industry` | 375 |
| `industries` JSON | 0 |
| `naicsCodes` JSON | 0 |
| `description` | 358 |
| `headcount` | 355 |
| `companyKeywords` | 0 |
| `crawlMarkdown` | 5793 |

There is no stored SIC-code field today. `Company.naicsCodes` exists but is not populated for the sampled OLBS companies and is the wrong taxonomy for UK Companies House anyway.

### W-of-E Manual-Review Sample

Sample lookup for the eight companies mentioned in the canary review:

| Company | Current stored signal | Notes |
| --- | --- | --- |
| Parsons Nationwide Distribution | OLBS Lead present, reg `3746821`, Standard International, 50 vehicles, domain `parsonsnationwide.co.uk`; Company row has no industry/description. | Looks like a true transport-direct positive. |
| First Bus | Company row exists for `firstbus.co.uk`; simple OLBS Lead-name search did not find an exact row. | Passenger transport; likely transport-adjacent unless 1210 explicitly wants bus operators. |
| Mears Group | Company row exists, industry `Facilities Services`, description says housing/care/repairs. | Likely non-transport despite any operator licence. |
| Select Plant Hire | OLBS Lead present, Restricted, 3 vehicles, company reg `1973463`; Company row exists by domain only. | Plant hire; restricted should not auto-exclude, but this likely needs non-transport/adjacent classification. |
| Forge Recycling | Company row exists by domain, no OLBS Lead found by simple name search. | Recycling; likely transport-adjacent or non-transport depending whether own fleet is targetable. |
| Hills Building Group | No exact row found by simple name search. | Needs better lookup by domain/name variant. |
| Alutec | Company rows exist for `aluteckk.co.uk` and `marleyalutec.co.uk`; one enriched industry is manufacturing. | Likely non-transport/manufacturing unless transport division evidence exists. |
| Marley | Mixed: existing `Marley` company/person plus several OLBS Marley rows. `MARLEY LIMITED` has Restricted licence, 2 vehicles. | Name collision risk; classifier must key by registration number when available. |

## Proposed Taxonomy

Use four classes:

- `transport-direct`: core haulage, logistics, freight, pallet distribution, warehousing/distribution operators, road transport companies, courier/fleet operators where transport is a sold service or core operation.
- `transport-adjacent`: own-account fleets, restricted licence holders at meaningful scale, passenger transport/bus operators, plant/equipment businesses with substantial logistics operations, recyclers/aggregates where fleet operations are material but not the main ICP.
- `non-transport`: construction, plant hire, manufacturing, facilities, housing, retail/ecommerce, recycling, agriculture, or other businesses where OLBS licence is incidental to a non-transport business.
- `unknown`: insufficient or conflicting evidence; requires manual review.

Restricted licence holders must not be auto-excluded. They usually start as `transport-adjacent` or `unknown` unless SIC/website evidence clearly says non-transport or transport-direct.

## Storage Recommendation

Add a new company-level table in Phase 1 rather than columns on `Company`.

Suggested model shape:

```prisma
model OlbsCompanyClassification {
  id                    String   @id @default(cuid())
  workspaceSlug         String
  companyRegNumber      String?
  licenceNumbers        Json?
  normalizedCompanyName String
  companyDomain         String?
  companyId             String?
  classification        String   // transport-direct | transport-adjacent | non-transport | unknown
  confidence            Float
  signals               Json     // raw signal values + weighted contributions
  evidence              Json?    // SIC, CH name/status, website snippets, OLBS fields
  reviewedAt            DateTime?
  reviewedBy            String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([workspaceSlug, classification])
  @@index([companyRegNumber])
  @@index([companyDomain])
  @@index([normalizedCompanyName])
}
```

Why a separate table:

- The classification is OLBS/source-specific, not a generic company attribute.
- Many OLBS rows do not have a domain and therefore do not reliably attach to `Company`.
- A company can have multiple OLBS licences; audit needs licence-level provenance.
- We need confidence, evidence, review state, and future reclassification history without bloating `Company`.

The table is still company-level. It is not person-level.

## Proposed Signals and Weighting

Do not make SIC code the only decision source. Use a weighted multi-signal classifier:

| Signal | Proposed effect |
| --- | --- |
| Companies House SIC in transport/logistics buckets (`49xxx`, `52xxx`) | Strong positive toward `transport-direct`. |
| Companies House SIC in construction/plant hire/manufacturing/facilities/recycling | Strong negative toward `non-transport`, unless website/OLBS evidence clearly shows transport service line. |
| Licence type `Standard National` / `Standard International` | Positive, but not conclusive. |
| Licence type `Restricted` | Neutral to mild adjacent; never automatic exclusion. |
| Fleet size 5-100 | Positive operational signal; larger fleet increases confidence but does not prove ICP fit. |
| Website crawl evidence | Strong positive/negative depending whether site sells haulage/logistics/fleet services vs construction/plant/recycling/manufacturing. |
| Company name/domain keywords | Weak supporting signal only; high collision risk. |
| Existing `Company.industry` / description | Useful when populated, but sparse. |

Initial scoring rule of thumb:

- `transport-direct`: transport SIC or strong website transport evidence, plus Standard licence or fleet evidence.
- `transport-adjacent`: Restricted licence, passenger transport, own-account fleet, or mixed evidence.
- `non-transport`: non-transport SIC plus website evidence showing construction/plant/manufacturing/facilities/recycling as the primary business.
- `unknown`: missing Companies House match and no website/domain, or conflicting signals.

## Companies House Strategy

Use Companies House primarily by `companyRegNumber`, not name search.

Plan:

1. Build a persistent Companies House cache table or file-backed cache before scale-up.
2. For rows with `companyRegNumber`, call Companies House company profile endpoint and cache:
   - company number
   - registered name
   - company status
   - SIC codes
   - company type
   - date fetched
   - raw response
3. For rows without `companyRegNumber`, use name search only as a lower-confidence fallback. Store match confidence and the matched company number.
4. Respect rate limits. Free tier is around 600 requests per 5 minutes. At roughly 17.5k registration-number lookups, the theoretical minimum is about 2.5 hours; with backoff/retries and name-search fallback, plan an overnight or multi-day resumable job.
5. Never call Companies House live inside target-list mutation. Classify/cache first, then filter lists from cached evidence.

## Dry-Run and Confusion Matrix Plan

Before any write to target lists:

1. Build a dry-run classifier that reads OLBS rows and cached Companies House evidence.
2. Run on:
   - the eight W-of-E reviewed companies above
   - a random Wales sample of 50 companies
   - 20 known transport-direct positives from obvious haulage/logistics names/domains
   - 20 known non-transport negatives from construction/plant/facilities/manufacturing examples
3. Produce a confusion matrix:

| Ground truth | Predicted direct | Predicted adjacent | Predicted non-transport | Predicted unknown |
| --- | ---: | ---: | ---: | ---: |
| transport-direct | | | | |
| transport-adjacent | | | | |
| non-transport | | | | |
| unknown | | | | |

Acceptance before scale-up: at least 90% accuracy on direct vs non-transport for the manually reviewed sample, with ambiguous cases allowed to land in `transport-adjacent` or `unknown`.

## Proposed Phase Breakdown

### Phase 1: Cache and Classifier Dry Run

- Add Companies House cache storage.
- Add `OlbsCompanyClassification` storage.
- Implement read-only/dry-run classifier.
- No target-list mutation.
- Produce stats by target list and region.

### Phase 2: Review and Tune

- Run confusion matrix.
- Review false positives/false negatives.
- Tune weights and thresholds.
- Decide whether passenger transport and restricted own-account fleets are targetable for 1210.

### Phase 3: Clean List Builder

- Create a new clean target list per region.
- Exclude `non-transport`.
- Include `transport-direct`.
- Put `transport-adjacent` and `unknown` into review/quarantine lists unless Jonathan chooses otherwise.

### Phase 4: Operationalize

- Reuse cache/classifier before any new OLBS import creates a 1210 list.
- Add reporting: classification distribution, unknown rate, and top exclusion reasons.

## Open Questions for Jonathan

1. Should passenger transport operators such as bus companies be `transport-direct` for 1210, or `transport-adjacent`/review?
2. Should `transport-adjacent` be included in canaries, quarantined for manual review, or excluded by default?
3. For restricted licence holders with fleet 10+ and strong logistics website evidence, should the classifier be allowed to promote to `transport-direct`?
4. What confidence threshold is acceptable for creating a clean list without manual review?
5. Do we want a human-reviewed seed set beyond the W-of-E eight and Wales 50 before Phase 1 writes classification rows?

## Non-Goals for Phase 0

- No DB columns or schema migrations.
- No classification writes.
- No Companies House bulk calls.
- No target-list changes.
- No vendor discovery calls.

