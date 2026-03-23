# Project Research Summary

**Project:** Nova CLI Agent Teams — v7.0 Outsignal Milestone
**Domain:** CLI skill conversion — API-based agent system to Claude Code CLI skills with persistent client-specific memory
**Researched:** 2026-03-23
**Confidence:** HIGH

## Executive Summary

The v7.0 Nova milestone converts an existing, production API-based agent system (orchestrator + 4 specialists, all running via Anthropic SDK `generateText()`) into Claude Code CLI skills with per-client persistent memory. The core value driver is cost: specialist agent calls via Claude Code Max Plan are effectively free versus Anthropic API Opus calls at ~$15/MTok. The approach requires no new npm dependencies, no new model providers, and no replacement of existing agent logic — only a new thin invocation layer (skill `.md` files + CLI wrapper scripts) and a flat-file memory system under `.claude/memory/{workspace-slug}/`. The existing codebase already validates the core pattern through the working `nova.md` skill and `scripts/chat.ts`.

The recommended approach is strictly additive: build CLI wrapper scripts first, then create per-client memory files with seeded content, then define specialist skill files, then add the CLI spawn utility to the orchestrator (feature-flagged via `USE_CLI_AGENTS`). The existing API agents remain fully intact as a fallback. The dashboard chat UI requires no changes — the orchestrator's delegation tools are the only modified code, gaining a new CLI path alongside the existing direct-call path. Memory is stored as version-controlled flat markdown files per workspace (not DB-backed, not machine-local auto-memory) so it is portable, inspectable, and correctable by the admin.

The two highest risks are credential exposure and memory governance. Claude Code auto-loads `.env` files into agent context without explicit permission (CVE-2025-59536), meaning secrets reach the LLM if `.claudeignore` is absent. On the memory side, agents without strict write schemas will pollute client memory files with stale and contradictory intelligence within weeks, causing the writer agent to generate copy that contradicts current client direction. Both risks must be addressed in Phase 1 (architecture) and Phase 2 (memory design) respectively — they cannot be retrofitted safely.

## Key Findings

### Recommended Stack

No new packages are required. The stack is entirely the existing project toolchain: `tsx` via `npx tsx` for wrapper script execution, `@ai-sdk/anthropic` + Vercel AI SDK for agent invocation, `@prisma/client` for DB queries, and `dotenv` for environment loading. All of these are already installed and follow established patterns in `scripts/chat.ts` and the existing `nova.md` skill.

The only new artifacts are text files (skill `.md` definitions), TypeScript CLI wrapper scripts under `scripts/cli/`, and per-workspace memory markdown files under `.claude/memory/`. The skill system uses Claude Code's `.claude/commands/` path (verified as current and explicitly supported alongside the newer `.claude/skills/` path). Key skill frontmatter fields: `disable-model-invocation: true` (user-triggered flows), `allowed-tools: Bash(npx tsx *)` (pre-approves tool calls without per-use prompts), `argument-hint` for autocomplete, and `!` shell injection syntax for loading client memory before Claude sees the prompt.

**Core technologies:**
- `npx tsx scripts/cli/*.ts` — CLI wrapper execution, zero build step, established project pattern
- Claude Code `.claude/commands/*.md` skill files — define agent roles, tool invocation instructions, memory read/write rules; replaces hardcoded system prompts
- `.claude/memory/{slug}/` flat markdown files — version-controlled per-client persistent intelligence (profile, copy-wins, feedback, icp-learnings, approval-patterns, campaign-history)
- `src/lib/agents/cli-spawn.ts` (new) — `spawnCliAgent()` orchestrator utility, feature-flagged via `USE_CLI_AGENTS`
- All existing `src/lib/agents/*.ts` files — unchanged, retained as fallback

### Expected Features

This is an additive milestone on a production system. All existing agent capabilities (orchestrator, research, writer, leads, campaign; 30+ tools; AgentRun audit; copy strategies; discovery adapters; enrichment) are preserved unchanged. v7.0 adds:

**Must have (table stakes — P1):**
- 5 skill definition files (`nova.md` updated + 4 new specialist skills) — without these there is no CLI skill system
- Bash CLI wrapper scripts for the top 10 most-used tool functions — agents must be able to do real work
- Per-workspace MEMORY.md files seeded with tone, ICP, and last 3 campaigns — cold-start is unacceptable on day one
- Memory read at skill invocation start via `!` shell injection — every session is client-aware from the first turn
- Dashboard-to-CLI bridge for writer and orchestrator agents — covers 80% of usage
- API agent fallback preserved and verified working

**Should have (competitive — P2, add after CLI path is proven):**
- Memory accumulation from real agent usage (auto-write learnings after sessions)
- Approval pattern tracking in per-client `feedback.md`
- Bridge extended to leads and campaign agents
- Cross-client global learning namespace (`global-insights.md`)

**Defer (v2+):**
- Copy wins feedback loop — requires 2+ months of CLI agent data to build reliably
- Memory-driven copy strategy auto-selection — requires solid approval pattern data first
- Automated memory pruning beyond inline agent instructions

### Architecture Approach

The architecture is a new thin invocation layer on top of an unchanged core. The orchestrator's `delegateToX` tools gain a new parallel execution path (`spawnCliAgent()`) that spawns Claude Code CLI skills as subprocesses, while the existing `runWriterAgent()` etc. calls remain as fallback. The tool layer (all `src/lib/agents/*.ts` files) is completely unchanged — CLI wrapper scripts in `scripts/cli/` are the only new code that touches the tool layer, acting as thin JSON-in/JSON-out adapters for existing TypeScript functions.

**Major components:**
1. `.claude/commands/nova-*.md` skill files — agent prompts, tool invocation instructions, memory read/write rules (new invocation layer for writer, research, leads, campaign; orchestrator updated)
2. `scripts/cli/*.ts` wrapper scripts — thin Node.js scripts that call existing lib functions and print JSON to stdout; no agent logic; the hard boundary between prompt and data
3. `.claude/memory/{slug}/` flat markdown files — per-client persistent intelligence read at skill startup, written at skill completion
4. `src/lib/agents/cli-spawn.ts` (new) — `spawnCliAgent()` handling subprocess creation, 300s timeout, stdout buffering, error translation
5. Modified `orchestrator.ts` — delegation tools gain `spawnCliAgent()` path alongside existing direct-call path, controlled by `USE_CLI_AGENTS` env var

**Build order is dependency-driven:** CLI wrappers first (testable in isolation), then memory file initialization, then specialist skill files, then `cli-spawn.ts`, then orchestrator modification, then dashboard bridge validation.

### Critical Pitfalls

1. **Skill prompt bloat causing context overflow** — Copying existing 290-line system prompts verbatim into SKILL.md creates 4,000-6,000 token overhead per skill; five skills in one session = 15,000-20,000 tokens consumed before real work begins. Apply a hard 200-line / 3,000-token budget per SKILL.md. Extract banned phrases, quality rules, and examples into `.claude/rules/` reference files loaded only on demand.

2. **Credential exposure via auto-loaded .env** — Claude Code silently loads `.env` into agent context (CVE-2025-59536). Add `**/.env*` to `.claudeignore` before the first CLI agent session. All tool scripts must sanitize output via a shared `sanitize-output.ts` utility. Agents must never receive `DATABASE_URL` directly in their environment.

3. **Memory pollution from undisciplined writes** — Agents writing freely to MEMORY.md produce contradictory, stale, low-signal entries within weeks. Design a strict schema with named sections (ICP Wins, Copy Rules, Campaign History, Feedback Log, Archived) and write governance rules enforced in skill instructions before any agent session runs. All entries must be timestamped; DB fields always take precedence over memory file intelligence.

4. **npx tsx cold-start latency** — Each `npx tsx` invocation adds 2-5 seconds (npm registry check + Node.js spawn + Prisma init). Six tool calls per session = 12-30 seconds of overhead. Compile tool scripts to `dist/cli/*.js` before Phase 4 and call `node dist/cli/script.js`. Build compilation into Phase 3 setup, not as a retrofit.

5. **Dual-mode divergence** — Maintaining API agent code and CLI skill files independently means behavioral rules will diverge silently within weeks. Choose one strategy before writing the first skill: Strategy A (extract shared rules to `.claude/rules/` files imported by both) or Strategy B (time-box fallback to 30 days then delete). The decision cannot wait.

## Implications for Roadmap

The dependency graph is clear and maps directly to a 6-phase build order. All phases are local development — no deployment required until Phase 6 validation.

### Phase 1: Skill Architecture Foundation
**Rationale:** Structural decisions made here (content budget, shared-source vs fallback strategy, security approach) cannot be safely retrofitted once skill files and memory files are written. This phase has no business logic code — only decisions, setup files, and the `sanitize-output.ts` utility.
**Delivers:** `.claudeignore` with `**/.env*` entries; `.claude/rules/` directory structure defined; skill content budget (200 lines) documented; dual-mode strategy decision recorded; `sanitize-output.ts` utility written and tested; memory write governance rules drafted.
**Addresses:** Table-stakes skill definition architecture; fallback preservation decision
**Avoids:** Skill prompt bloat (Pitfall 1), credential exposure (Pitfall 2), dual-mode divergence (Pitfall 5)

### Phase 2: Client Memory Namespace
**Rationale:** Memory schema must be designed and approved before any agent session writes to memory. Retroactively cleaning polluted memory files risks discarding real intelligence accumulated in early sessions.
**Delivers:** `.claude/memory/{slug}/` directory structure for all 8 clients; MEMORY.md schema (ICP Wins, Copy Rules, Campaign History, Feedback Log, Archived) with timestamp requirements; seeded profile content from existing workspace DB fields; memory-write governance rules finalized.
**Addresses:** MEMORY.md per workspace (seeded), memory read at skill start
**Avoids:** Memory pollution (Pitfall 3), memory staleness (Pitfall 7)

### Phase 3: CLI Wrapper Scripts
**Rationale:** Wrappers depend only on existing `src/lib/` code (unchanged). They must exist and be compiled before skills can reference them. Security (`sanitize-output.ts` applied to all scripts) and latency (compiled output) are non-negotiable here.
**Delivers:** `scripts/cli/` with 10 wrapper scripts for top tool functions; compiled output in `dist/cli/`; output sanitization via `sanitize-output.ts` imported in every script; each script independently testable with `node dist/cli/workspace-get.js rise`.
**Addresses:** Bash CLI wrapper scripts for top 10 tool functions
**Avoids:** npx tsx latency (Pitfall 4), credential exposure at tool output layer (Pitfall 2)

### Phase 4: Specialist CLI Skill Files
**Rationale:** Skill files reference both CLI wrappers (Phase 3) and memory files (Phase 2) — both must exist first. Writer skill is highest priority (most-used agent). The existing `nova.md` is updated to inject memory via `!` syntax.
**Delivers:** 4 new `.claude/commands/nova-{writer,research,leads,campaign}.md` files; updated `nova.md` with memory injection; each skill within the 200-line budget; all wrapper references using `node dist/cli/` paths.
**Addresses:** SKILL.md definitions for all 5 agents
**Avoids:** Skill prompt bloat (size enforced at authoring), monolithic skill anti-pattern

### Phase 5: Orchestrator CLI Spawn Integration
**Rationale:** `cli-spawn.ts` interface is designed with actual skill names and output formats from Phase 4. The orchestrator modification is feature-flagged — safe to ship alongside existing code without regression risk. Dashboard bridge uses Trigger.dev task queue (not subprocess from Vercel API route) to avoid timeout issues.
**Delivers:** `src/lib/agents/cli-spawn.ts` with `spawnCliAgent()` (300s timeout, stdout buffering, error translation to user-facing messages); modified `orchestrator.ts` delegation tools with `USE_CLI_AGENTS` feature flag; both CLI and API fallback paths tested end-to-end; dashboard bridge validated.
**Addresses:** Dashboard-to-CLI bridge (writer + orchestrator path), API fallback verified
**Avoids:** Dashboard bridge complexity (Pitfall 6 — Trigger.dev task queue, not raw subprocess from Vercel)

### Phase 6: Memory Accumulation and Full Validation
**Rationale:** Only run after Phase 5 is proven stable. Adds intelligence accumulation to the working skill system and extends the bridge to remaining agents. End-to-end validation confirms no regression in dashboard chat.
**Delivers:** Memory write instructions added to all specialist skills; approval pattern tracking in `feedback.md`; dashboard bridge extended to leads and campaign agents; `USE_CLI_AGENTS=true` in local `.env`; end-to-end campaign generation session tested for context overflow and quality.
**Addresses:** Memory accumulation from real usage, approval pattern memory, bridge extension to all agents
**Avoids:** Stale memory (timestamp enforcement validated in practice); context overflow (full session audit)

### Phase Ordering Rationale

- **Security and architecture first (Phase 1):** `.claudeignore` and shared-source strategy must exist before any skill file is written or any agent session runs. Impossible to retrofit safely.
- **Memory schema before memory writes (Phase 2 before Phase 4):** Agents will write to memory files from their first session. Schema without governance means immediate pollution.
- **Wrappers before skills (Phase 3 before Phase 4):** Skill files are text files that reference tool scripts. Referenced scripts must exist and be testable before skill authoring begins.
- **Skills before spawn utility (Phase 4 before Phase 5):** `cli-spawn.ts` needs actual skill names, argument formats, and expected stdout format — which are defined in Phase 4.
- **Validation last (Phase 6):** Accumulation features require a stable working baseline. Extending the bridge to lower-priority agents only makes sense once the primary path (writer + orchestrator) is proven.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Bridge):** The Trigger.dev task queue pattern for dashboard-to-CLI delegation is recommended by pitfall research but the specific design (task schema, SSE polling vs Suspense-based polling, progress event DB schema) needs a dedicated planning pass before Phase 5 implementation begins.
- **Phase 3 (Compilation):** TypeScript path alias resolution (`@/lib/...`) in compiled `dist/cli/` output should be verified against the existing `tsconfig.json` configuration before scripting all 10 wrappers. A mismatch here breaks every compiled wrapper.

Phases with standard, well-documented patterns (skip additional research):
- **Phase 1:** Security setup (`.claudeignore`, sanitize utility) is fully specified in PITFALLS.md with exact implementation steps.
- **Phase 2:** Memory directory structure and markdown schema is fully specified in ARCHITECTURE.md and STACK.md with example file content.
- **Phase 4:** Skill file format is verified against official Claude Code docs with working examples in the live codebase (`nova.md`).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official Claude Code docs verified 2026-03-23; all patterns confirmed against live working codebase (`nova.md`, `scripts/chat.ts`, 7 agent files inspected directly) |
| Features | HIGH | Official Claude Code docs verified; feature set is bounded and clear — this is additive on an existing production system, not greenfield |
| Architecture | HIGH | Based on direct code inspection of all 7 agent files and the full project structure; build order derived from actual dependency graph |
| Pitfalls | HIGH | Official CVE documentation for credentials; npm issue tracker for npx latency; multiple community post-mortems for memory pollution and context overflow; all prevention strategies are concrete and actionable |

**Overall confidence:** HIGH

### Gaps to Address

- **Trigger.dev bridge design (Phase 5):** PITFALLS.md recommends the task queue pattern for the dashboard-to-CLI bridge but does not specify the exact Trigger.dev task schema or the polling/streaming mechanism for the dashboard. This needs a planning decision before Phase 5 implementation.

- **TypeScript path alias resolution in compiled output (Phase 3):** The project uses `@/lib/...` path aliases. Whether these resolve correctly when compiling `scripts/cli/*.ts` to `dist/cli/*.js` should be verified early in Phase 3 before scripting all 10 wrappers. A quick compilation test of a single wrapper using an `@/lib/` import will confirm.

- **Memory file git inclusion (Phase 2):** PITFALLS.md recommends against committing memory files to git (client intelligence exposure risk). STACK.md recommends committing them for portability and version control. This conflict requires a decision before Phase 2: likely the answer is to `.gitignore` the per-client memory files while committing the directory structure via `.gitkeep` files, but this needs to be explicitly decided and documented.

## Sources

### Primary (HIGH confidence)
- [Claude Code Skills docs](https://code.claude.com/docs/en/slash-commands) — Full skill format, frontmatter reference, `$ARGUMENTS`, shell injection, `allowed-tools`, `context: fork` — verified 2026-03-23
- [Claude Code Memory docs](https://code.claude.com/docs/en/memory) — CLAUDE.md hierarchy, auto memory storage location, 200-line limit, `.claude/rules/` — verified 2026-03-23
- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams) — Subagent orchestration patterns — verified 2026-03-23
- [CVE-2025-59536](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) — RCE and API key exfiltration via Claude Code; .env auto-loading confirmed
- [Knostic.ai .env auto-load research](https://www.knostic.ai/blog/claude-loads-secrets-without-permission) — .claudeignore remediation confirmed
- Direct code inspection: `src/lib/agents/orchestrator.ts` (683 LOC), `runner.ts`, `writer.ts`, `leads.ts`, `research.ts`, `campaign.ts`, `shared-tools.ts`, `types.ts`
- Direct code inspection: `.claude/commands/nova.md`, `scripts/chat.ts`, `scripts/generate-copy.ts`
- [tsx npm package documentation](https://tsx.is/getting-started) — cold start behavior, no persistent process pool
- [npx slow cached packages — GitHub Issue #7295](https://github.com/npm/cli/issues/7295) — registry check adds 3+ seconds per invocation

### Secondary (MEDIUM confidence)
- [Inside Claude Code Skills — mikhail.io](https://mikhail.io/2025/10/claude-code-skills/) — Community skill structure analysis
- [Claude Code Context Management — Sitepoint](https://www.sitepoint.com/claude-code-context-management/) — `/compact` behavior, 60% compact threshold
- [The Problem with AI Agent Memory — Medium](https://medium.com/@DanGiannone/the-problem-with-ai-agent-memory-9d47924e7975) — Memory pollution mechanics; conflicting context reconciliation
- [Why LLM Memory Still Fails — DEV Community](https://dev.to/isaachagoel/why-llm-memory-still-fails-a-field-guide-for-builders-3d78) — Context rot; semantic retrieval without temporal relevance
- [Claude Code Skills token budget — GitHub Gist](https://gist.github.com/mellanon/50816550ecb5f3b239aa77eef7b8ed8d) — 82% token recovery from content layering into reference files

---
*Research completed: 2026-03-23*
*Ready for roadmap: yes*
