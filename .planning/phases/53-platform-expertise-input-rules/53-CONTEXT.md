# Phase 53: Platform Expertise + Input Rules - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Encode deep platform expertise into leads-rules.md so the leads agent arrives at every session knowing exactly how to use each discovery platform — optimal filters, cost models, known bugs, two-path search routing, and pre-search input validation. Add a shared CLI validation module that enforces rules at the wrapper level as a safety net. This phase covers rules and validation only — no changes to search execution, enrichment, or quality gates (those are Phase 56).

</domain>

<decisions>
## Implementation Decisions

### Platform Knowledge Depth
- **Full playbooks** per platform — not just gotchas, but example filter combos for common ICP types (enterprise B2B, SMB, ecommerce, local), pagination tips, rate limits, and common mistakes
- **Active platforms only**: Prospeo, AI Ark, Apollo (free), Leads Finder, Google Maps, Ecommerce Stores — no placeholders for future platforms
- **Full credit accounting**: credits per search, credits per enrichment, monthly credit budgets, burn rate warnings, recommended batch sizes to stay within budget
- **Decision logic included**: explicit routing rules like "ecommerce ICP -> Ecommerce Stores first, then Prospeo for people" — agent follows routing guidance, not just per-platform docs
- **Consistent template per platform**: each gets the same sections — Overview, Filters, Cost Model, Known Issues, Example Combos, Routing Guidance

### Two-Path Search Routing
- **Both paths in parallel** when domains AND ICP filters are available — domain-based search for known companies AND ICP-filter search for broader discovery, dedup after. Maximises coverage.
- **Always verify domains** even when provided — quick-verify they're valid/current. Catches typos, redirects, dead domains before burning credits.
- **Always all three sources** for ICP-filter path: Prospeo + AI Ark + Apollo free for every search. Each has unique records, cost difference is negligible.
- **State + reasoning** in plan presentation — agent explains WHY it chose the routing (e.g. "Using domain-based search on Prospeo because you provided 104 company domains. Also running AI Ark ICP filters to catch companies not on your list.")

### Input Validation Rules
- **Hard-block** on known-bad filter combos — agent must fix filters before proceeding, no override
- **All four check types enforced**:
  1. Company name instead of domain (the exact Prospeo bug that burnt $100)
  2. Missing required ICP fields (no title AND no seniority AND no industry = too broad)
  3. Filter mismatch to platform (e.g. SIC codes on AI Ark, which only Prospeo supports)
  4. Budget exceeded warning (estimated cost vs remaining monthly credits)
- **ICP mismatch flagging**: compare search filters against workspace ICP, flag if they don't align (admin can override but sees warning)
- **Both layers enforcement**: rules in leads-rules.md guide the agent during plan generation, AND CLI wrapper scripts enforce as a safety net with error messages

### Knowledge Format + Loading
- **Extend existing leads-rules.md** — add Platform Expertise section. Agent already loads this at startup via loadRules(), no new file needed.
- **Replace and consolidate** the existing Source Selection Guide — Platform Expertise subsumes it as the single authoritative section for all platform knowledge
- **Shared validation module**: new discovery-validation.ts with reusable check functions. Each CLI search wrapper imports and calls validate() before executing the search.

### Claude's Discretion
- Exact template layout within the consistent per-platform structure
- How domain verification is implemented (DNS lookup, HTTP check, etc.)
- Internal organisation of the shared validation module (function signatures, error message format)
- How budget tracking state is maintained across searches within a session

</decisions>

<specifics>
## Specific Ideas

- The Prospeo company-name-instead-of-domain bug is the canonical example of what input validation must catch — agent searched by company.names instead of company.websites, producing junk data and burning ~$100 in credits
- AI Ark's contact.department and contact.keyword filters are known broken — must be documented as hard-blocked in the platform expertise
- AI Ark searches must always use the two-step company-then-people workaround — this is a non-negotiable platform quirk
- Routing logic should be concrete enough that the agent never has to "figure out" which platform to use — the rules tell it based on ICP characteristics

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 53-platform-expertise-input-rules*
*Context gathered: 2026-03-30*
