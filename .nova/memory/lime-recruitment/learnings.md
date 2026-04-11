<!-- learnings.md | workspace: lime-recruitment | seeded: 2026-03-24 | re-seed: skips if exists -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. Never delete existing entries. -->

# lime-recruitment — Learnings

## ICP Learnings

<!-- Agent: append entries as: [ISO date] — [what you learned about who responds, e.g. "CTOs at 50-200 person SaaS respond best", "Ignore VP Sales titles for this client"] -->

(No ICP learnings recorded yet)

## Lead Source Effectiveness

<!-- Agent: append entries as: [ISO date] Source: [Apollo|Prospeo|AI Ark|etc] — [quality rating and notes, e.g. "Apollo CTOs at fintech companies 70% valid email rate"] -->

(No lead source data recorded yet)

## Recruitment Services — Vertical-Specific Insights

<!-- Agent: append entries as: [ISO date] — [industry pattern, trend, or insight specific to this client's vertical] -->

(No vertical-specific insights recorded yet)

[2026-04-10T09:00:00Z] — Re-enrichment cohort: same Person.email persistence bug that affected 290 YoopKnows people likely also affected Lime people
    Cause: pre-fix enrichment code never persisted email to Person.email. Code fix deployed in v20260409.26.
    Lime impact: specific count unknown, needs audit on next enrichment cycle.
    Action: include Lime in the same re-enrichment cohort when the YoopKnows re-enrichment task is executed.
    Recovered from stash@{0} 2026-04-11.
