<!-- learnings.md | workspace: yoopknows | seeded: 2026-03-24 | re-seed: skips if exists -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. Never delete existing entries. -->

# yoopknows — Learnings

## ICP Learnings

<!-- Agent: append entries as: [ISO date] — [what you learned about who responds, e.g. "CTOs at 50-200 person SaaS respond best", "Ignore VP Sales titles for this client"] -->

(No ICP learnings recorded yet)

## Lead Source Effectiveness

<!-- Agent: append entries as: [ISO date] Source: [Apollo|Prospeo|AI Ark|etc] — [quality rating and notes, e.g. "Apollo CTOs at fintech companies 70% valid email rate"] -->

(No lead source data recorded yet)

## Architecture Project Management — Vertical-Specific Insights

<!-- Agent: append entries as: [ISO date] — [industry pattern, trend, or insight specific to this client's vertical] -->

(No vertical-specific insights recorded yet)

[2026-04-10T09:00:00Z] — Re-enrichment cohort: 290 YoopKnows people have verified emails in Person.enrichmentData but null Person.email
    Cause: pre-fix enrichment code never persisted the email to Person.email. Code fix deployed in v20260409.26.
    Backfill impossible: the verification code never stored the email in enrichmentData either (confirmed by scripts/backfill-enrichment-emails.ts finding 0 recoverable). Re-enrichment from scratch is the only recovery path.
    Action: re-enrich these 290 people on next enrichment run cadence.
    Status: Monty platform fix DONE; Nova re-enrichment task PENDING.
    Recovered from stash@{0} 2026-04-11.
