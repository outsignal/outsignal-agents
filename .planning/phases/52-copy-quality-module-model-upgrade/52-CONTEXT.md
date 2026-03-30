# Phase 52: Copy Quality Module + Model Upgrade - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend copy-quality.ts to cover the full structural rule set (tiered word counts, all banned phrases from writer-rules.md, greeting check, CTA softness + action + human-sounding check, variable format, subject line rules, LinkedIn-specific checks). Upgrade all Nova CLI skill agents to Opus 4.6 via a single config variable. This is the deterministic foundation — every downstream quality gate (writer self-review, validator agent, portal hard-block) depends on these checks existing in code.

</domain>

<decisions>
## Implementation Decisions

### Validation Tiering
- **Hard-block** (must fix before save): banned phrases, wrong variable format (double braces or lowercase), missing greeting on step 1 email, spintax in LinkedIn messages, statement CTAs (no question mark), vague/AI-cliche CTAs
- **Soft-block** (save with review flag, admin sees in approval flow): word count within 10% grace of limit, filler spintax (semantically valid but low-quality), subject line slightly over 6 words
- Both outbound sequences AND reply suggestions are validated — replies skip spintax checks (replies don't use spintax)

### CTA Quality Rules
- CTA must be a question (ends with ?)
- CTA must suggest a concrete next step (not just "thoughts?" or "interested?")
- CTA must sound human — not AI-cliche output
- **Banned CTA phrases (hard-block):** "worth a chat?", "open to exploring?", "ring any bells?", "sound familiar?", "thoughts?", "interested?", "make sense?", "make sense for your team?"
- **Pass examples:** "open to a quick call this week?", "want me to send over some examples?", "shall I put something together?"
- **Fail examples:** "worth a chat?" (AI cliche), "thoughts?" (no action), "interested?" (lazy), "make sense for your team?" (no action)

### Word Count Thresholds (per strategy)
- PVP: 70 words max
- Creative Ideas: 90 words max
- One-liner: 50 words max
- Custom: 80 words max
- LinkedIn messages: 100 words max
- **10% grace period**: up to 10% over = soft-block (warning). Over 10% = hard-block.
- Same limit applies to ALL steps in a sequence (follow-ups are not shorter)

### Rules Consolidation
- copy-quality.ts is the **single source of truth** for all enforceable rules
- writer-rules.md references copy-quality.ts but does not duplicate rule definitions
- All ~25+ banned phrases from writer-rules.md consolidated into copy-quality.ts
- Existing 13 banned patterns expanded to full set

### Model Upgrade
- **Scope:** CLI skills only — API fallback agents and Trigger.dev tasks stay as-is
- **All Nova agents on Opus 4.6:** orchestrator + all 7 specialists (writer, leads, campaign, research, deliverability, intelligence, onboarding)
- **All GSD agents on Opus 4.6:** planner, executor, researcher, verifier, checker
- **Single config variable:** one place to change model for all Nova skill files (e.g. in .claude config or env var). Not hardcoded per skill file.
- Model ID: `claude-opus-4-6`

### Claude's Discretion
- Exact implementation of CTA quality detection (regex vs pattern matching vs keyword check)
- How the single model config variable is exposed to skill files (env var, .claude config, or shared constant)
- Internal structure of the expanded banned phrases list (flat array vs categorized)
- How soft-block review flags are attached to saved drafts/sequences

</decisions>

<specifics>
## Specific Ideas

- "worth a chat?" is the canonical example of an AI-cliche CTA — it sounds robotic and is overused. The check should catch patterns like this, not just literal strings.
- The 10% grace period exists because a 71-word PVP email might be genuinely good and trimming it could hurt quality. But 85 words is clearly over.
- Reply suggestions get the same banned phrases and em dash checks as outbound, just without spintax validation (replies are direct, not broadcast).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 52-copy-quality-module-model-upgrade*
*Context gathered: 2026-03-30*
