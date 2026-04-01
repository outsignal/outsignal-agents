# Phase 61: Complete Agent Memory Coverage - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning
**Source:** Conversation decisions

<domain>
## Phase Boundary

Build the 3 missing specialist agents (Deliverability, Intelligence, Onboarding) as proper agents with configs, tools, onComplete hooks, and memory writes. Fix the Orchestrator to write memory after sessions.

**Current state:**
- 4 specialist agents are fully built with memory read+write: Writer, Leads, Campaign, Research
- 3 agents exist as rule files only (`.claude/rules/*-rules.md`) but have no code in `src/lib/agents/`: Deliverability, Intelligence, Onboarding
- Validator runs inline in the writer pipeline — no standalone agent needed
- Orchestrator has code (`orchestrator.ts`) but no `onComplete` hook and bypasses `runAgent()` via chat.ts

**In scope:**
- Build deliverability.ts agent (config, tools, onComplete → learnings.md)
- Build intelligence.ts agent (config, tools, onComplete → learnings.md + global-insights.md)
- Build onboarding.ts agent (config, tools, onComplete → learnings.md + feedback.md)
- Add orchestrator onComplete hook for session-level memory writes
- Wire all 3 new agents as orchestrator delegation targets
- Fix chat.ts to save orchestrator memory (it bypasses runAgent)

**Out of scope:**
- Validator agent (runs inline, no standalone needed)
- Changes to existing 4 specialist agents (already complete)
- Memory-to-DB migration (deferred)

</domain>

<decisions>
## Implementation Decisions

### Architecture Pattern
- Follow the EXACT same pattern as writer.ts, leads.ts, campaign.ts, research.ts:
  - AgentConfig with name, model, systemPrompt (loaded from rules file via load-rules.ts), tools, maxSteps, onComplete
  - Tools wrapping existing CLI scripts (same as other agents)
  - runXxxAgent() public API function
  - onComplete hook calling appendToMemory() with workspace-specific insights
- Each agent's system prompt is loaded from its rules file via `loadRulesFile()` in load-rules.ts

### Deliverability Agent
- **Tools**: senderHealth, domainHealth, bounceStats, inboxStatus (wrapping existing CLI scripts: sender-health.js, domain-health.js, bounce-stats.js, inbox-status.js)
- **onComplete writes to**: `learnings.md` — blacklist incidents, recovery timelines, warmup rates, DNS issues
- **Orchestrator delegation**: add `delegateToDeliverability` tool alongside existing 4 delegation tools
- **Model**: same as other specialists (NOVA_MODEL from orchestrator)

### Intelligence Agent
- **Tools**: cachedMetrics, insightList, workspaceIntelligence, campaignsGet, readGlobalInsights (wrapping existing CLIs)
- **onComplete writes to**: `learnings.md` (per-workspace analytics patterns) + `global-insights.md` via appendToGlobalMemory (cross-client patterns)
- **Orchestrator delegation**: add `delegateToIntelligence` tool
- **Model**: same as other specialists

### Onboarding Agent
- **Tools**: workspaceCreate, workspaceGet, workspacePackageUpdate, memberInvite (wrapping existing CLIs)
- **onComplete writes to**: `learnings.md` (setup observations like DNS provider, complications) + `feedback.md` (client preferences noted during setup)
- **Orchestrator delegation**: add `delegateToOnboarding` tool
- **Model**: same as other specialists

### Orchestrator Memory
- Cannot use onComplete (orchestrator bypasses runAgent in chat.ts)
- Instead: add memory write at end of each chat turn in chat.ts
- After each orchestrator response, extract key actions taken (delegation calls, workspace changes) and append to the active workspace's learnings.md
- Keep it lightweight — only write when tool calls were made (skip pure-text responses)

### Claude's Discretion
- Exact tool parameter schemas (follow existing patterns in other agents)
- Whether to use shared-tools.ts for common tool definitions
- How to extract "key actions" from orchestrator responses for memory writes
- Exact fields to extract from each specialist for onComplete entries

</decisions>

<specifics>
## Specific Ideas

### Key Files
- src/lib/agents/writer.ts — reference pattern for agent config + onComplete (lines 707-723)
- src/lib/agents/leads.ts — reference pattern (lines 1222-1234)
- src/lib/agents/orchestrator.ts — needs delegation tools added (currently 4: research, leads, writer, campaign)
- src/lib/agents/load-rules.ts — loads system prompts from .claude/rules/ files
- src/lib/agents/shared-tools.ts — shared tool definitions
- src/lib/agents/runner.ts — runAgent() with memory injection (lines 38-50)
- src/lib/agents/memory.ts — appendToMemory() + appendToGlobalMemory()
- src/lib/agents/types.ts — AgentConfig type definition
- scripts/chat.ts — orchestrator CLI (needs memory write after responses)

### Rules Files (system prompts)
- .claude/rules/deliverability-rules.md — already specifies tools, diagnostic flow, memory governance
- .claude/rules/intelligence-rules.md — already specifies tools, analysis methodology, memory governance
- .claude/rules/onboarding-rules.md — already specifies tools, workflow steps, memory governance

### Existing CLI Scripts to Wrap as Tools
- Deliverability: sender-health.js, domain-health.js, bounce-stats.js, inbox-status.js
- Intelligence: cached-metrics.js, insight-list.js, workspace-intelligence.js, campaigns-get.js
- Onboarding: workspace-create.js, workspace-get.js, workspace-package-update.js, member-invite.js

### Memory Governance (from rules files)
Each rules file already specifies exactly what the agent may/must-not write to:
- Deliverability: MAY write learnings.md. MUST NOT write profile.md, campaigns.md, feedback.md
- Intelligence: MAY write learnings.md + global-insights.md. MUST NOT write profile.md, campaigns.md, feedback.md
- Onboarding: MAY write learnings.md + feedback.md. MUST NOT write profile.md, campaigns.md

</specifics>

<deferred>
## Deferred Ideas

- Validator as standalone agent (runs inline, not needed)
- Memory-to-DB migration (for Vercel/Trigger.dev agents)
- Agent-to-agent delegation (agents calling other agents directly)

</deferred>

---

*Phase: 61-complete-agent-memory-coverage*
*Context gathered: 2026-04-01 via conversation decisions*
