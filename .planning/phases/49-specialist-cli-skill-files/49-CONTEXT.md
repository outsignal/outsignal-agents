# Phase 49: Specialist CLI Skill Files - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Create Claude Code skill files (.claude/commands/*.md) for all 7 specialist agents + update the orchestrator (nova.md). Each skill injects client memory at startup, references compiled CLI wrappers for tool calls, and follows behavioral rules from .claude/rules/. The 3 new agent rules files (deliverability, onboarding, intelligence) are fleshed out from stubs. All 7 existing rules files are reviewed and updated for CLI context.

</domain>

<decisions>
## Implementation Decisions

### Memory injection pattern
- **All 4 memory files loaded for every agent** — profile.md, campaigns.md, feedback.md, learnings.md all injected via `! cat` at skill invocation. Every agent gets full workspace context
- **Global-insights.md is intelligence-agent-only** — only nova-intel loads global-insights.md. Other agents focus on their workspace
- **Raw cat injection** — `! cat .nova/memory/{slug}/profile.md .nova/memory/{slug}/campaigns.md .nova/memory/{slug}/feedback.md .nova/memory/{slug}/learnings.md` in each skill file. Simple, transparent, no formatting script
- **Memory write-back at agent discretion** — skill instructions tell agents: "If you learned something new about this client, append it to the relevant memory file before ending." Agent decides what's worth saving. Not every session writes

### Skill file structure & content
- **Skill file = identity + tools + memory** — each skill file contains: agent role/purpose, tool call table (script paths + args + descriptions), memory injection (! cat), memory write-back reminder. Within 200-line budget
- **Rules file = behavioral rules** — all behavioral rules (quality checks, banned phrases, workflows, approval patterns, memory write governance) live in .claude/rules/. Referenced via @-file syntax
- **Tool table format** — markdown table listing each tool: name, script path, args pattern, brief description. Compact and scannable
- **@ file reference for rules** — use `@.claude/rules/writer-rules.md` syntax in skill files. Claude Code auto-loads the referenced file into context
- **Update existing nova.md** — keep nova.md as the orchestrator entry point. Update it to delegate to 7 specialists and inject memory

### Orchestrator delegation model
- **Agent tool subagents** — orchestrator uses Claude Code's Agent tool to spawn specialist subagents. Each specialist runs with full context (memory + rules) in its own context window
- **Workspace picker when no slug** — if no slug provided, list all workspaces with names and slugs for user to pick
- **Auto-detect specialist from request** — orchestrator infers which specialist to invoke from the user's request. "Write emails" → writer, "Find CTOs" → leads, "Create campaign" → campaign
- **Auto-chain multi-step workflows** — for pipelines (research → leads → writer → campaign), orchestrator chains specialists automatically without stopping between steps. User sees the final output

### Agent-specific behavior rules
- **Flesh out all 3 new agents now** — deliverability, onboarding, and intelligence get comprehensive rules based on existing codebase knowledge. Not stubs
- **Review and update all 7 rules files** — ensure all rules reference CLI tools (dist/cli/) not API tool functions, and add any missing guidance for the CLI context
- **Memory write governance in rules files** — each agent's rules file specifies: which memory files it can write to, what constitutes a writeable insight, append format with ISO timestamp
- **Deliverability uses CLI wrappers only** — calls sender-health.js, domain-health.js, bounce-stats.js, inbox-status.js for data. Can suggest triggering a fresh domain-health scan via Trigger.dev if real-time data needed

### Claude's Discretion
- Exact line count per skill file (within 200-line budget)
- How the orchestrator formats workspace picker output
- Internal structure of each rules file update
- Which memory files each agent is allowed to write to (beyond the general "append to relevant file" instruction)
- How auto-chaining passes context between spawned specialists

</decisions>

<specifics>
## Specific Ideas

- The orchestrator should feel like a single entry point — user says what they want, orchestrator figures out who to involve and chains them together
- Memory injection must happen BEFORE the agent's first turn — the agent should reference client tone/ICP in its very first response
- The 200-line budget is strict — if a skill file is getting close, move more content to the rules file
- Existing nova.md already has some orchestrator logic — preserve what works, update the delegation mechanism

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 49-specialist-cli-skill-files*
*Context gathered: 2026-03-24*
