# Phase 54: Writer Agent Overhaul - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

The writer never saves copy that violates quality rules — it self-reviews before every save, sees the full campaign as a unit (all email steps + LinkedIn messages), and rewrites automatically when violations are found. This is the writer's internal quality loop. The external Validator Agent (Phase 55) provides an additional semantic review layer after the writer is done.

</domain>

<decisions>
## Implementation Decisions

### Self-Review Gate Mechanics
- **copy-quality.ts structural checks only** — semantic checks (tone, coherence, filler spintax) are the Validator Agent's job (Phase 55)
- **Three-layer validation**: (1) per-step structural checks, (2) per-sequence cross-step checks (repeated CTAs/angles), (3) Validator Agent as final semantic review
- **CLI wrapper invocation** — new `validate-copy` CLI script that the writer calls like other tools. Keeps the agent pattern consistent (agents use CLI tools, not imports).
- **Before and after validation** — pre-check confirms rules are loaded/understood, post-check validates the generated output

### Campaign-Holistic Awareness
- **Load all channels** — when generating any step, load ALL existing email steps AND LinkedIn messages for the campaign. Writer sees the full picture across channels.
- **Explicit tracking list** — writer builds an internal list of used angles and CTAs from existing steps before generating. References it during generation to prevent duplication.
- **Auto-pick new angle** on dedup detection — writer silently picks a different angle rather than flagging to admin. Autonomous quality is the goal.
- **Within-campaign dedup only** — writer deduplicates angles/CTAs within the current campaign. Cross-campaign angle variety is encouraged (test more angles to find what works). Lead overlap prevention across campaigns is the Pipeline's job (Phase 57, PIPE-02).

### Rewrite Loop Behavior
- **2 retries max** — generate -> validate -> rewrite -> validate -> rewrite -> validate. If still failing after 2 rewrites, escalate. Matches COPY-02 requirement.
- **Specific violation feedback** — full CheckResult list passed to each rewrite attempt: which check failed, the value, the limit, severity. Writer knows exactly what to fix.
- **Carry-forward context** — each rewrite attempt knows what the previous attempt failed on (e.g. "Your last version was 85 words. Trim to under 70 without losing the core message.")
- **Escalation: save with review notes** — if violations persist after 2 retries, save the best attempt with inline notes flagging what's still wrong. Admin sees violations in the existing approval flow.

### KB Consultation Depth
- **Cite in internal notes** — writer silently applies KB principles in the copy, but includes metadata notes like "Applied: curiosity-hook framework from doc #42". Admin can see what influenced the copy.
- **Flag + proceed on empty results** — if KB search returns nothing for the strategy+vertical combo, note "No KB docs found for [strategy]+[vertical]. Using general best practices." Admin knows there's a KB gap.
- **Enforce application only** — keep the existing 3-tier KB consultation flow (strategy+industry, strategy-only, general). This phase adds the requirement that results must be visibly applied, not just "searched KB".
- **Traceability for all strategies** — every strategy (PVP, Creative Ideas, One-liner, Custom) must trace its core angle to a KB doc, case study, or differentiator. Not just Creative Ideas.

### Claude's Discretion
- Exact format of the validate-copy CLI wrapper output
- How the "taken angles/CTAs" tracking list is structured internally
- How pre-generation rule confirmation is implemented
- Format of inline review notes on escalation saves

</decisions>

<specifics>
## Specific Ideas

- The three-layer validation model: (1) writer self-review per-step (structural), (2) writer cross-step check (angle/CTA dedup), (3) Validator Agent (semantic) — gives three gates before copy reaches admin
- Cross-campaign angle variety is a feature, not a bug — testing different angles across campaigns for the same ICP helps discover what works. The pipeline prevents the same lead receiving messages from multiple campaigns.
- "Applied: [principle]" in draft metadata lets the admin trace why copy reads the way it does, which is especially useful when reviewing or giving feedback

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 54-writer-agent-overhaul*
*Context gathered: 2026-03-30*
