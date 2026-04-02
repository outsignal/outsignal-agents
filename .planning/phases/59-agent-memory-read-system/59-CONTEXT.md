# Phase 59: Agent Memory Read System - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning
**Source:** Direct from session analysis of broken memory system

<domain>
## Phase Boundary

Fix the broken read side of Nova's persistent agent memory system. The write side works (agents successfully append learnings to `.nova/memory/{slug}/`), but there is NO mechanism to load those learnings back into agents on subsequent sessions. Every session starts from scratch — agents don't learn, don't know system state, and repeat mistakes.

This phase delivers: a 3-layer context loading system that ensures every agent session is informed by system-wide state, cross-client patterns, and workspace-specific history.

**Out of scope:** Memory write improvements (already working), new agent creation, UI changes.

</domain>

<decisions>
## Implementation Decisions

### Memory Architecture — 3 Layers (Locked)
Every agent session must load 3 layers of context, in priority order (workspace overrides cross-client overrides system):

1. **System-wide context** — Full MEMORY.md from the Claude Code memory system (`/Users/jjay/.claude/projects/-Users-jjay-programs/memory/MEMORY.md`). Contains: current tool stack, cancelled services, infrastructure state, operational rules, client roster, architectural decisions. Load the ENTIRE file, not condensed.

2. **Cross-client learnings** — `.nova/memory/global-insights.md`. Contains: patterns that work across all workspaces (copy strategies by vertical, channel effectiveness, benchmark data). Lower priority than workspace-specific but informs new campaigns.

3. **Workspace memory** — `.nova/memory/{slug}/learnings.md`, `.nova/memory/{slug}/campaigns.md`, `.nova/memory/{slug}/feedback.md`, `.nova/memory/{slug}/profile.md`. Contains: ICP learnings, copy wins/losses, client preferences, approval patterns. Highest priority — workspace-specific overrides everything.

### Dynamic System Prompts (Locked)
- Agent system prompts are currently built STATICALLY at module load time (e.g. `const WRITER_SYSTEM_PROMPT = ...` in writer.ts)
- Must change to DYNAMIC per-session construction: static rules + injected memory context
- The `runAgent()` function in `runner.ts` should handle this — merge static rules with dynamic memory before calling `generateText()`

### Memory Loading Approach (Locked)
- Memory loaded at agent startup, NOT via tool calls during execution
- System-wide + cross-client loaded once when orchestrator starts
- Workspace memory loaded when workspace slug is known (either from task params or detected during conversation)
- Memory injected into system prompt section, clearly labelled so agents can distinguish rules from memory

### Context Window Protection (Locked)
- Truncate individual memory files if over 200 lines (configurable)
- Total memory context should not exceed ~2000 tokens across all 3 layers
- If truncation needed, keep most recent entries (they're most relevant)
- Log a warning if truncation occurs

### Graceful Degradation (Locked)
- Missing memory files = empty context for that layer (not an error)
- Malformed memory files = skip that file, log warning
- MEMORY.md not found = proceed without system context (shouldn't happen but don't crash)

### Claude's Discretion
- Exact format of memory injection in system prompt (markdown sections, XML tags, etc.)
- Whether to use a single `loadAllContext()` function or separate functions per layer
- How to handle the orchestrator's context loading vs specialist agent context loading
- Whether workspace memory is loaded by the orchestrator and passed to delegates, or each specialist agent loads its own

</decisions>

<specifics>
## Specific Implementation Details

### Files That Need Changing

**Core Memory Module:**
- `src/lib/agents/memory.ts` — Add `readMemory()`, `loadWorkspaceContext()`, `loadSystemContext()`, `loadCrossClientContext()` functions

**Agent Runner:**
- `src/lib/agents/runner.ts` — Inject memory context into system prompt before calling `generateText()`

**Agent Configs (dynamic prompt construction):**
- `src/lib/agents/orchestrator.ts` — Load system-wide + cross-client context at startup
- `src/lib/agents/leads.ts` — Accept and use workspace memory in system prompt
- `src/lib/agents/writer.ts` — Accept and use workspace memory (campaigns.md + feedback.md critical for learning)
- `src/lib/agents/campaign.ts` — Accept and use workspace memory
- `src/lib/agents/research.ts` — Accept and use workspace memory (learnings.md)
- All other agent configs that exist

**Additional Fixes:**
- Clean up malformed memory entries (1210-solutions has "undefined: undefined")
- Clean up nonsensical data in global-insights.md (310.6% reply rate)
- Validate `appendToMemory()` prevents malformed writes

### Current Broken State (Reference)
- `appendToMemory()` exists and works (one-way write)
- No `readMemory()` function exists
- System prompts built at `const WRITER_SYSTEM_PROMPT = \`...\`` — static, never updated
- `runner.ts` uses `config.systemPrompt` directly — no memory injection point
- Each agent session is completely isolated
- 12 workspaces have memory directories with seeded templates
- Lime has 4 real agent-written entries, Rise has 2, 1210 has 1 malformed entry
- global-insights.md has nonsensical validation test data

</specifics>

<deferred>
## Deferred Ideas

- Memory archiving/rotation when files get too large (future — handle with truncation for now)
- Memory search/retrieval (semantic search over past learnings — future enhancement)
- Inter-agent memory sharing within a session (agent A writes, agent B reads in same session)
- Memory versioning/history
- Admin UI for reviewing/editing agent memory

</deferred>

---

*Phase: 59-agent-memory-read-system*
*Context gathered: 2026-04-01 from session analysis*
