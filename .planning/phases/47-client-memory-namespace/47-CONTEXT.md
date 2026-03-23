# Phase 47: Client Memory Namespace - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Per-workspace memory directory structure seeded with real intelligence from the database. Memory governance rules established before any agent writes. Global insights namespace created for cross-client patterns. No agent skills are written in this phase — only the memory infrastructure they depend on.

</domain>

<decisions>
## Implementation Decisions

### Memory file structure
- **4 files per workspace** (grouped, not granular):
  - `profile.md` — company name, vertical, ICP description, tone/voice, outreach channel prefs, package type, key contacts, website URL, **standing instructions** (admin-editable client-specific rules like "Rise prefers short sequences", "BlankTag is LinkedIn-only")
  - `campaigns.md` — campaign history with performance data (name, channel, status, reply rate, open rate, lead count) + copy wins/losses
  - `feedback.md` — client feedback, approval patterns, what they approved/rejected and why
  - `learnings.md` — ICP learnings, lead source effectiveness, vertical-specific insights accumulated over time
- Directory: `.nova/memory/{slug}/` (decided in Phase 46 context)
- All files gitignored, directory structure via `.gitkeep`

### Seeding strategy
- **Rich seed** — pull maximum available data from DB:
  - ICP description, tone prompt, all campaigns (names + status + channel + reply rate + open rate + lead count)
  - Last 10 replies with classifications, approval history, workspace package
  - Website URL, key contacts
- **Re-run behavior**: seed script overwrites `profile.md` only (always fresh from DB). Leaves `campaigns.md`, `feedback.md`, `learnings.md` untouched (accumulated intelligence preserved)
- Campaigns.md seeded with **names + performance data** (not full copy sequences)

### Write governance
- **Append with timestamp** — agents append new entries at the bottom with ISO timestamps. Never delete or overwrite existing entries
- **200-line limit per file** — matches Claude Code's own memory limit
- **Overflow handling**: when a file hits 200 lines, agent summarises the oldest 50 entries into 5-10 lines, deletes the originals. Preserves intelligence in compressed form
- **No validation** — trust agents to write sensible entries. Admin reviews periodically. No dedup or contradiction checking

### Global insights
- **Content**: benchmarks (cross-client reply rates, open rates, best channels per vertical) + copy patterns (subject lines, structures, styles that work across clients) + operational insights (send times, lead source quality, ICP scoring patterns)
- **Single writer**: only `nova-intel` (intelligence agent) can write to `global-insights.md`. Other agents read only
- **Seeded from DB**: pull current cross-client averages as initial baseline (reply rates, open rates by vertical, lead source rankings)
- Location: `.nova/memory/global-insights.md`

### Claude's Discretion
- Exact markdown format/headers within each memory file
- How the seed script queries and formats DB data
- Whether to include email templates in campaigns.md seeding (decided: no, just names + performance)
- Exact summary format when compressing old entries

</decisions>

<specifics>
## Specific Ideas

- Standing instructions in profile.md are the key differentiator — this is where per-client rules accumulate that no other system captures (e.g. "never use hyphens in Rise copy", "Covenco wants formal tone")
- The seed script should be a CLI command: `nova-memory seed [slug]` for one workspace, `nova-memory seed --all` for all 8
- Profile.md is the only file that gets regenerated on re-seed — everything else is append-only accumulated intelligence

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 47-client-memory-namespace*
*Context gathered: 2026-03-23*
