# Phase 46: Skill Architecture Foundation - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Security setup and architectural decisions that gate every downstream phase. Includes `.claudeignore`, `sanitize-output.ts`, shared rules directory, 200-line skill content budget, and dual-mode strategy. No skill files are written in this phase — only the infrastructure they depend on.

</domain>

<decisions>
## Implementation Decisions

### Dual-mode strategy
- **Shared rules files** — extract all agent behavioral rules to `.claude/rules/` as the single source of truth
- Both CLI skills and API agents reference the same rules files — true single source, zero drift
- **All agent rules** shared: copy quality (hyphen bans, tone constraints, sequence limits), discovery approval workflow, campaign state machine, KB search patterns — every agent's behavioral rules
- **Per-agent files** in `.claude/rules/`: `writer-rules.md`, `leads-rules.md`, `campaign-rules.md`, `research-rules.md`, `deliverability-rules.md`, `onboarding-rules.md`, `intelligence-rules.md`
- **API agents refactored** to read rules from `.claude/rules/` at prompt-build time — not keeping hardcoded prompts in TypeScript files

### Memory location
- **`.nova/memory/{slug}/`** at project root — dedicated Nova namespace, clear separation from Claude Code's own memory
- **Gitignored** — no client intelligence leaks to version control. Directory structure preserved via `.gitkeep`
- **Backup strategy**: Vercel Blob storage for accumulated intelligence (periodic snapshots via `nova-memory backup` / `nova-memory restore`)
- **Seed script** (`nova-memory seed`) for new workspaces or factory reset — regenerates baseline from DB (ICP, tone, recent campaigns)
- Accumulated intelligence (copy-wins, feedback, approval patterns) preserved in Blob — never lost on machine wipe

### Sanitization scope
- **Secrets only** — strip DATABASE_URL, API keys, tokens, passwords. PII (emails, names) stays because agents need it to do their job
- **Pattern-based detection** — regex for known secret formats (DATABASE_URL, sk_*, tr_*, Bearer tokens, ANTHROPIC_API_KEY, etc.)
- **Replacement format**: `[REDACTED:type]` — e.g. `[REDACTED:DATABASE_URL]`, `[REDACTED:API_KEY]`. Agent knows what was redacted but can't see the value

### Skill invocation UX
- **`/nova {slug}`** as primary entry point — orchestrator delegates to whichever agents are needed
- **`/nova-writer {slug}`**, `/nova-research {slug}`, `/nova-leads {slug}`, `/nova-campaign {slug}` for direct specialist access
- **New agent short names**: `/nova-deliver`, `/nova-onboard`, `/nova-intel`
- **No slug = workspace picker** — shows list of all 8 workspaces to select from
- Full agent list: nova (orchestrator), nova-writer, nova-research, nova-leads, nova-campaign, nova-deliver, nova-onboard, nova-intel

### Claude's Discretion
- `.claudeignore` file content and patterns beyond `.env*`
- Exact regex patterns for secret detection in `sanitize-output.ts`
- Internal structure of per-agent rules files
- 200-line budget enforcement mechanism (documentation only vs automated check)

</decisions>

<specifics>
## Specific Ideas

- The orchestrator is the natural entry point — campaign work spans multiple agents (research → leads → writer → campaign), so manual agent selection should be the exception not the rule
- Memory backup to Vercel Blob should be script-driven (`nova-memory backup/restore/seed`) — no Google Drive dependency
- Rules files should be extractable from existing TypeScript agent prompts — the content already exists in `orchestrator.ts`, `writer.ts`, etc.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 46-skill-architecture-foundation*
*Context gathered: 2026-03-23*
