# Fix Leads Agent — Multi-Source Discovery Brief

## Problem
The leads agent only uses one paid source per discovery run (usually Prospeo due to prompt bias). We have both Prospeo and AI Ark available and want BOTH used on every run to maximise coverage — their databases partially overlap but aren't identical.

## Root Cause
All in `src/lib/agents/leads.ts` system prompt:
- "Default to Apollo + one paid source" — limits to one
- Prospeo listed first in every comparison — LLM picks it by default
- AI Ark described less confidently ("not a fallback — a full peer") — defensive framing
- AI Ark departments filter noted as bugged — LLM avoids it
- No instruction to multi-source

## Tasks

### 1. Update Source Selection Guide
In `src/lib/agents/leads.ts`, rewrite the Source Selection Guide section:

**Replace** "default to Apollo + one paid source that adds unique filters" with:

```
ALWAYS use ALL available paid sources (Prospeo + AI Ark) for every discovery run. Their databases partially overlap but each returns unique leads the other misses. Running both doubles your coverage at minimal extra cost.

Source execution order:
1. Apollo (free) — broad search, no emails, use for initial volume
2. Prospeo ($0.001/credit) — full enrichment, 20+ filters
3. AI Ark (~$0.003/call) — full enrichment, comparable filters to Prospeo

For Apify sources (Leads Finder, Google Maps, Ecommerce Stores), add these when the ICP specifically calls for:
- Local/map-based businesses → searchGoogleMaps
- Ecommerce companies → searchEcommerceStores
- Verified emails at scale → searchLeadsFinder
- Web presence signals → searchGoogle (Serper)
```

### 2. Rewrite AI Ark Tool Description
Make it match Prospeo's assertiveness. Replace current description with:
```
"AI Ark B2B people search. 15+ filters including title, seniority, industry, location, company size, revenue, funding, technologies, company type, NAICS codes, and company keywords. Different database to Prospeo — use BOTH for maximum coverage."
```

### 3. Fix Departments Bug Note
Either:
- Remove the "AI Ark currently ignores this filter" note if it's been fixed
- Or change it to a neutral note: `.describe("Person departments (may have limited support)")` — so the LLM doesn't avoid the entire adapter

### 4. Update Discovery Plan Builder
In the `buildDiscoveryPlan` tool or wherever the plan is constructed, ensure the plan template includes BOTH Prospeo and AI Ark as default steps. The plan should look like:

```
Step 1: Apollo search (free, broad match)
Step 2: Prospeo search (paid, same filters)
Step 3: AI Ark search (paid, same filters)
Step 4: Deduplicate results by email
Step 5: Enrich & verify
```

### 5. Deduplication
Since both sources will return overlapping results, ensure there's deduplication logic:
- After both searches complete, deduplicate by email address
- Keep the record with more enrichment data
- Tag source on each lead so we can track which source provided unique vs overlapping leads

Check if dedup already exists in the discovery flow. If not, add it.

### 6. Update Comparisons
In the "When to use which paid source" section, remove all Prospeo-first comparisons. Replace with:

```
Prospeo and AI Ark are PEERS — always use both. Each has unique records the other misses. Cost difference is negligible (~$0.002/lead).
```

## Do NOT
- Change adapter code (the adapters work fine)
- Change the enrichment waterfall (that's post-discovery)
- Add new adapters
- Change the approval flow

## Key Files to Modify
- `src/lib/agents/leads.ts` — system prompt + tool descriptions only

## Success Criteria
- Every discovery plan includes BOTH Prospeo and AI Ark
- Discovery results show leads from both sources
- Deduplication prevents duplicate leads
- AI Ark usage shows up in enrichment cost tracking
