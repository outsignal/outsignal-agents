# Brief: Discovery Pipeline — Quality Gates & Dedup

## Problem
The BlankTag lead pipeline produced 994 records but after investigation:
- 249 were duplicates (same person from multiple sources)
- 310 were not ICP-fit (wrong job titles — Volunteers, Board Members, Photographers, Assistants)
- Off-ICP companies slipped through (Cancer Research UK, The New Yorker, Twinings — not Shopify ecommerce brands)

Root causes:
1. **No pre-search dedup** — pipeline searched domains that already had contacts from a previous run, producing cross-source duplicates
2. **No ICP title filtering at discovery time** — adapters return anyone at the company, not just ICP-fit decision-makers
3. **No company-type filtering** — non-profits, media companies, and enterprise organisations not excluded
4. **Dedup runs at promotion, not staging** — duplicates accumulate in DiscoveredPerson table and waste enrichment credits

## Fixes Required

### 1. Pre-search domain coverage check
Before searching any domain through a discovery adapter, check if DiscoveredPerson already has contacts for that domain + workspace. Skip domains that are already covered. This is the waterfall logic the user requested: "only run the full waterfall for any companies we don't find info for."

Implementation: Add a `getUncoveredDomains(workspaceSlug, domains)` utility that queries DiscoveredPerson for existing coverage and returns only gap domains.

### 2. Dedup at staging, not promotion
When staging a DiscoveredPerson record, check if a record with the same linkedinUrl (or firstName+lastName+companyDomain) already exists for this workspace. Skip if duplicate. This prevents duplicate records from accumulating and wasting enrichment credits.

### 3. ICP title filtering at discovery time
After each discovery search returns results, filter out contacts whose job titles don't match the ICP before staging. The ICP titles are defined per workspace (in the workspace profile). Non-matching titles should be logged but not staged.

Common junk titles to always exclude: Volunteer, Board Member, Photographer, Cartoonist, Writer (unless content role), Editor, Journalist, Intern, Stylist, Supervisor, Key Holder, Jeweller, Processor, Scholar, Contributor.

### 4. Company-type filtering
Exclude companies that are clearly off-ICP:
- Non-profits / charities (Cancer Research UK)
- Media / publishing (The New Yorker)
- Enterprise / FTSE 100 (Twinings) — unless the ICP specifically targets enterprise
- Government organisations

This could be done via employee count thresholds, industry classification, or a blocklist.

## Key Files
- `src/lib/discovery/adapters/prospeo-search.ts` — Prospeo adapter
- `src/lib/discovery/adapters/aiark-search.ts` — AI Ark adapter
- `src/lib/discovery/adapters/apify-leads-finder.ts` — Leads Finder adapter
- `src/lib/discovery/staging.ts` or wherever `stageDiscoveredPeople` lives — dedup logic
- `src/lib/agents/leads.ts` — Leads agent (orchestrates discovery)

## Impact
Without these fixes, every discovery run wastes credits on duplicates and junk, requires manual cleanup, and erodes trust in the pipeline output. With them, the pipeline produces campaign-ready leads directly.
