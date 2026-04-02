# Brief: Leads Agent — Job Title Expansion

## Problem
When the Leads agent searches for decision-makers, it uses exact job titles from the ICP (e.g., "CEO", "Founder", "Head of Marketing"). This misses equivalent titles like "Chief Executive Officer", "Co-Founder", "VP Marketing", "Marketing Director" — people who are the same ICP fit but use different title conventions.

## Goal
Build a title expansion utility that the Leads agent calls before running discovery searches. Takes ICP job titles and returns an expanded set with common variations, keeping results ICP-specific.

## Expansion Logic

The utility should handle these expansion categories:

1. **Abbreviation ↔ Full form**: CEO ↔ Chief Executive Officer, CFO ↔ Chief Financial Officer, CMO ↔ Chief Marketing Officer, CTO ↔ Chief Technology Officer, COO ↔ Chief Operating Officer, VP ↔ Vice President
2. **Role variants**: Founder → Co-Founder, Co-founder. Director → Head of. Manager → Lead.
3. **Seniority equivalents**: Head of X → VP X, X Director, Senior X Manager. VP X → Head of X, X Director.
4. **Department naming**: Marketing → Growth, Digital Marketing, Performance Marketing. Digital → Online, eCommerce.
5. **Common suffixes**: Manager, Lead, Director, Head, VP, Chief, Senior

## Rules
- Only expand within the same seniority band (don't expand "CEO" to "Marketing Coordinator")
- Don't expand into unrelated departments (don't expand "Head of Marketing" to "Head of Engineering")
- Deduplicate the expanded list
- Keep original titles in the output (expansion is additive, not replacement)
- Log what was expanded so the user can see what the agent searched for

## Implementation

Create `src/lib/discovery/title-expansion.ts`:

```typescript
export function expandJobTitles(titles: string[]): string[]
```

This should be a pure function with a static mapping — no API calls, no LLM. Fast and deterministic.

Then wire it into the Leads agent (`src/lib/agents/leads.ts`) so it's called automatically before any discovery search that uses job title filters. The expanded titles should be passed to the discovery adapters instead of the raw ICP titles.

## Example

Input: `["CEO", "Founder", "Head of Marketing", "Head of Performance", "Digital Marketing Manager", "Head of Digital"]`

Output:
```
CEO, Chief Executive Officer,
Founder, Co-Founder, Co-founder,
Head of Marketing, VP Marketing, Vice President Marketing, Marketing Director, VP of Marketing,
Head of Performance, Head of Performance Marketing, Performance Marketing Manager, Performance Director,
Digital Marketing Manager, Digital Marketing Lead, Online Marketing Manager,
Head of Digital, Digital Director, VP Digital, Head of Online
```

## Key Files
- `src/lib/agents/leads.ts` — Leads agent (wire in before discovery searches)
- `src/lib/discovery/adapters/prospeo-search.ts` — accepts jobTitles filter
- `src/lib/discovery/adapters/aiark-search.ts` — accepts jobTitles filter
- `src/lib/discovery/adapters/apify-leads-finder.ts` — accepts job_title filter

## Success Criteria
1. `expandJobTitles()` is a pure function with no external dependencies
2. Leads agent automatically expands titles before every discovery search
3. Expansion stays within ICP seniority band and department
4. Original titles are preserved (additive expansion)
5. Expanded titles are logged for transparency
