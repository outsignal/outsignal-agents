---
vendor: Apify
created: 2026-05-06T14:03:44Z
created_by: codex
status: placeholder
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
related_spec: docs/api-specs/apify-platform-v1.md
---

# Apify Empirical Sanity Check

No production dataset rows are included in Phase 0b. Phase 1 should add redacted output samples for each actor used by the repo.

## Planned Checks

| Actor | Sample count | Source | Status | Notes |
| --- | ---: | --- | --- | --- |
| `code_crafter/leads-finder` | 0 | pending | pending | Confirm people-search fields. |
| `compass/crawler-google-places` | 0 | pending | pending | Confirm place fields and URL/phone aliases. |
| `ecommerce_leads/store-leads-14m-e-commerce-leads` | 0 | pending | pending | Confirm store/company fields. |
| `automation-lab/tech-stack-detector` | 0 | pending | pending | Confirm technology field structure. |
| `lexis-solutions/google-ads-scraper` | 0 | pending | pending | Confirm ad creative and advertiser fields. |

## Redaction Checklist

- Replace place/company names, domains, phones, and ad copy with synthetic equivalents.
- Preserve actor-specific field names and nesting.
