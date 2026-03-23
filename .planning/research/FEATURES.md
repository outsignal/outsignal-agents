# Feature Research

**Domain:** CLI-based agent teams with persistent memory (Nova v7.0)
**Researched:** 2026-03-23
**Confidence:** HIGH (official Claude Code docs verified)

---

## Context

This is a **subsequent milestone** on an existing codebase. The research question is what is NEW:
converting the existing API-based agent system to Claude Code CLI skills with client-specific
persistent memory. Existing features (orchestrator, 4 specialist agents, 30+ tool functions,
dashboard chat, AgentRun audit, quality gates, copy strategies, discovery, enrichment) are
**already built and in production**. This research covers only what v7.0 adds.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the CLI agent system must have for it to be considered functional. Without these it is
not a real skill system — it is just a renamed API call.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| SKILL.md definition per agent | The fundamental unit of a Claude Code skill. Without it you have no skill system. | LOW | One SKILL.md per agent (orchestrator, research, writer, leads, campaign). Frontmatter: name, description, disable-model-invocation (for user-triggered flows), allowed-tools |
| Skill reads workspace context on invoke | CLI agents need to know which client they are operating for before doing any work | LOW | Pass workspaceSlug as `$ARGUMENTS[0]` or embed in invocation prompt. Agent reads workspace CLAUDE.md or client memory file first |
| Bash wrapper scripts for existing tool functions | Existing TypeScript tool functions (DB queries, EmailBison API, discovery adapters, KB search) must be callable from CLI agents via Bash tool | MEDIUM | Thin node scripts in `scripts/agents/`. Each script: read args from stdin or argv, call existing lib function via dynamic require, return JSON stdout. Agent calls via `!` injection or Bash tool |
| MEMORY.md file per workspace | Standard Claude Code auto-memory pattern. First 200 lines loaded every session. Client-specific context persists across runs | LOW | One MEMORY.md per workspace slug under `.claude/memory/[slug]/`. Claude reads/writes during sessions |
| Memory read at skill invocation start | Agent must load client context before acting. Without this, every invocation is stateless | LOW | Skill frontmatter `!` injection: `!cat .claude/memory/[slug]/MEMORY.md` or agent reads via Bash tool at start of execution |
| Dashboard-to-CLI bridge (API route to CLI exec) | Existing dashboard chat must still work. Users expect no regression in the chat interface | MEDIUM | Next.js API route executes `claude --print -p "[prompt]"` as child process via Node `exec`. Returns streamed or buffered response. Replaces direct `runAgent()` Anthropic SDK call |
| Fallback preserved (existing API agents) | Production system must not break if CLI invocation fails | LOW | Existing `runAgent()` / `generateText()` code stays. CLI bridge catches exec failures and falls back to API path. Feature flag controls routing |

### Differentiators (Competitive Advantage)

Features that make this more than a simple port — the actual value of v7.0.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Client-specific memory namespacing | Each workspace accumulates its own tone profile, copy wins, ICP learnings, campaign history, feedback patterns — independent of other clients | MEDIUM | Directory per workspace: `.claude/memory/[slug]/`. Separate topic files: `tone.md`, `copy-wins.md`, `icp.md`, `campaigns.md`, `feedback.md`. MEMORY.md as index. Auto-memory builds this over time, manual seeding bootstraps it |
| Memory accumulation from real usage | Writer agent auto-writes to `copy-wins.md` when a campaign performs above benchmark. Research agent updates `icp.md` when new patterns found. Campaign agent logs approval patterns | MEDIUM | Agents instructed in SKILL.md to write structured entries to memory files when they complete work. Uses Claude Code built-in Write/Edit tools. Standard auto-memory pattern from official docs |
| Copy wins feedback loop | When reply rate exceeds threshold, agent reads existing copy, extracts what worked, and writes a structured entry to `copy-wins.md`. Next writer invocation loads this as context | HIGH | Requires: campaign performance query tool + threshold check + Claude analysis + write to memory. Trigger: campaign agent or scheduled check. High value: grounded in real performance data not training assumptions |
| Approval pattern memory | Writer agent records which copy strategies the client approved vs rejected. Shapes future generation toward patterns that get approved | MEDIUM | Structured log in `feedback.md`: date, strategy, element, outcome (approved or rejected), note. Writer skill reads last 30 entries as context. Reduces revision cycles |
| Cross-client learning namespace | A separate global memory file stores cross-client insights (e.g. "one-liner CTAs outperform PVP for recruitment verticals"). Shared across all agents | MEDIUM | Separate from per-client memory. Agents instructed to read global insights before per-client context. Written by admin explicitly or by orchestrator after pattern detection |
| Zero API cost for primary agent operations | Moves primary orchestration from Anthropic API (paid) to Claude Code Max Plan (covered). Signal campaign Haiku calls remain as the only paid path | LOW | This is the architecture goal, not an implementation feature. CLI exec uses Max Plan credits not API credits. Fallback to API only on CLI failure |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like natural extensions but would create serious problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Custom agent runtime / process manager | "We should own the execution environment" | You already have one: Claude Code. Building a custom runtime duplicates auth, tool management, context windowing, model routing — all solved by Claude Code | Use Claude Code CLI directly. Deploy via Node child_process exec from Next.js |
| Database-backed memory (PostgreSQL/Redis) | "Memory should be queryable" | Massive over-engineering. CLAUDE.md and MEMORY.md are the standard pattern. DB adds schema migration, connection management, query layer — all for what is essentially a config file | Flat markdown files per workspace. Claude reads them natively. No query layer needed |
| Memory schema enforcement / validation | "We need typed memory fields" | Memory is prose-first. Enforcing a schema fights Claude's native reading pattern and makes memory brittle when the agent writes something slightly differently | Write memory in structured markdown sections. Agent follows section headings as loose schema. No runtime validation |
| Real-time memory sync across sessions | "Multiple agents should share live memory" | Claude Code sessions are independent. "Shared live memory" requires a coordination layer that does not exist in the skill system | Each session reads from disk at start. Writes flush to disk immediately. Next session picks up writes. File locking on concurrent writes is the only edge case worth handling |
| Separate memory cleanup daemon / cron | "Old memory should expire automatically" | Adds operational complexity for marginal value. 200-line MEMORY.md limit is self-managing. Agents prune naturally when near limit | Include pruning instructions in SKILL.md: "If MEMORY.md exceeds 150 lines, summarize oldest entries". Agent handles it inline |
| Full agent conversation history in memory | "Store every interaction for context" | Violates the 200-line MEMORY.md limit. Bloats context. Claude has conversation context within a session — persisting all of it is redundant | Store only distilled learnings and patterns, not raw conversations. AgentRun table already covers audit/history needs |
| Replace AgentRun audit trail | "CLI agents don't need DB logging" | AgentRun table is used by the dashboard for agent monitoring. Removing it breaks the admin UI | Keep AgentRun. CLI bridge writes to AgentRun via a lightweight POST to the existing `/api/agent-runs` endpoint after CLI exec returns |

---

## Feature Dependencies

```
[SKILL.md definitions]
    └──requires──> [Bash wrapper scripts] (agents need tools to call)
                       └──requires──> [Existing tool functions preserved]

[Dashboard-to-CLI bridge]
    └──requires──> [SKILL.md definitions] (something to invoke)
    └──requires──> [Fallback preserved] (production safety)

[Client memory namespacing]
    └──requires──> [SKILL.md definitions] (agent must know to read memory)
    └──enables──> [Memory accumulation from real usage]
                      └──enables──> [Copy wins feedback loop]
                      └──enables──> [Approval pattern memory]

[Cross-client learning namespace]
    └──enhances──> [Client memory namespacing] (adds global layer on top of per-client)
    └──requires──> [Memory accumulation from real usage] (needs data to generalize from)

[Memory read at skill invocation start]
    └──requires──> [Client memory namespacing] (need the files to read)
```

### Dependency Notes

- **Bash wrappers require existing tools preserved:** Wrappers must not reimplement tool logic. They call the existing TypeScript functions via `node -e` or dedicated script files. This is a hard constraint — the same tool code serves both the API path (Vercel) and the CLI path (local).

- **Dashboard bridge requires fallback:** Bridge goes to production. It must not break existing dashboard users. Fallback to existing `runAgent()` is a day-one requirement, not an optimization.

- **Copy wins loop requires campaign data tools:** The agent needs to query real campaign metrics. This is already in the existing `getCampaignPerformance` tool (writer.ts). The wrapper just needs to expose it.

- **Memory namespace requires per-client directory structure:** Must be established before any accumulation features. Bootstrap with seed content (tone prompt, ICP summary) from existing workspace DB fields.

---

## MVP Definition

### Launch With (v1 — Phase 1-3 of v7.0)

Minimum viable CLI skill system. Proves the architecture. Gets the cost savings.

- [ ] SKILL.md for all 5 agents (orchestrator, research, writer, leads, campaign) — defines the CLI interface
- [ ] Bash wrapper scripts for top 10 most-used tool functions (getWorkspaceIntelligence, searchKnowledgeBase, getCampaignPerformance, queryPeople, getCampaigns, getLeadsList, createTargetList, saveWriterOutput, getCampaignContext, getReplies) — agents can actually do work
- [ ] MEMORY.md file per workspace with seeded context (tone, ICP, last 3 campaigns) — gives agents immediate value from day one
- [ ] Memory read at skill start — agents behave as client-aware from first invocation
- [ ] Dashboard-to-CLI bridge for writer and orchestrator agents — covers 80% of usage
- [ ] Fallback to existing API agents — production safety net

### Add After Validation (v1.x — Phase 4-5 of v7.0)

Once CLI path is proven stable and agents are behaving well:

- [ ] Memory accumulation from real usage — trigger: first week of CLI agent operation shows stable results
- [ ] Approval pattern memory — trigger: admin uses writer agent 5+ times via CLI
- [ ] Bridge extended to leads and campaign agents — trigger: writer bridge working cleanly
- [ ] Cross-client learning namespace — trigger: 3+ clients have meaningful per-client memory built up

### Future Consideration (v2+ — post v7.0)

Defer until pattern is well understood from real usage:

- [ ] Copy wins feedback loop — requires measuring impact of memory-informed generation vs baseline. Needs at least 2 months of data. High value but premature to build now.
- [ ] Automated memory pruning beyond inline instructions — complex, low current need
- [ ] Memory-driven copy strategy auto-selection — agent picks strategy based on past approval patterns without prompting. Requires solid approval pattern data first.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| SKILL.md definitions (5 agents) | HIGH | LOW | P1 |
| Bash wrapper scripts (top 10 tools) | HIGH | MEDIUM | P1 |
| Dashboard-to-CLI bridge (writer + orchestrator) | HIGH | MEDIUM | P1 |
| Fallback to existing API agents | HIGH | LOW | P1 |
| MEMORY.md per workspace (seeded) | HIGH | LOW | P1 |
| Memory read at skill start | HIGH | LOW | P1 |
| Memory accumulation from real usage | HIGH | MEDIUM | P2 |
| Approval pattern memory | MEDIUM | MEDIUM | P2 |
| Bridge extended to leads + campaign | MEDIUM | LOW | P2 |
| Cross-client learning namespace | MEDIUM | MEDIUM | P2 |
| Copy wins feedback loop | HIGH | HIGH | P3 |
| Memory-driven strategy auto-selection | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch — core architecture and production safety
- P2: Should have, add when CLI path is proven
- P3: Nice to have, requires real usage data to build well

---

## Skill Invocation Patterns (Reference)

Verified against official Claude Code docs (March 2026):

**User-triggered via dashboard bridge:**
Dashboard POST to `/api/chat` -> Node exec `claude --print -p "invoke /writer rise write pvp sequence for Q2 campaign"` -> streamed or buffered response back to UI.

**CLI direct invocation:**
`/writer rise "write pvp email sequence for Q2 pharmaceutical campaign"`

**Agent auto-load:**
User message matching skill description triggers Claude to load full skill content automatically. No slash required.

**Memory injection at invocation (! syntax):**
Frontmatter in SKILL.md: `!cat /path/to/project/.claude/memory/$ARGUMENTS[0]/MEMORY.md 2>/dev/null || echo "No memory yet"`
This runs before Claude sees the skill content — output is injected as context.

**Bash wrapper call pattern (inside skill instructions):**
```
To get workspace intelligence: run `node scripts/agents/get-workspace.js $ARGUMENTS[0]`
To search knowledge base: run `node scripts/agents/search-kb.js "$query"`
```

**Memory write pattern (inside skill instructions):**
```
After completing copy generation, append to .claude/memory/[slug]/copy-wins.md:
- Date: [date]
- Campaign: [name]
- Strategy: [pvp/creative-ideas/one-liner]
- What worked: [brief description]
```

---

## Sources

- [Extend Claude with skills — Claude Code Docs](https://code.claude.com/docs/en/skills) — HIGH confidence, official, verified March 2026
- [How Claude remembers your project — Claude Code Docs](https://code.claude.com/docs/en/memory) — HIGH confidence, official, verified March 2026
- [Orchestrate teams of Claude Code sessions — Claude Code Docs](https://code.claude.com/docs/en/agent-teams) — HIGH confidence, official, verified March 2026
- [Inside Claude Code Skills: Structure, prompts, invocation](https://mikhail.io/2025/10/claude-code-skills/) — MEDIUM confidence, community analysis
- Existing codebase `src/lib/agents/` — tool functions, types, runner pattern — HIGH confidence (read directly)

---
*Feature research for: Nova CLI Agent Teams with Persistent Memory (v7.0)*
*Researched: 2026-03-23*
