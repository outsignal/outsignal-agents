# Architecture Research

**Domain:** CLI Skill System integration with existing TypeScript agent architecture
**Researched:** 2026-03-23
**Confidence:** HIGH — based on direct code inspection of all existing agent files

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      INVOCATION LAYER                               │
│                                                                      │
│  ┌──────────────────┐        ┌─────────────────────────────────┐   │
│  │  Dashboard Chat  │        │   Claude Code CLI (nova skill)  │   │
│  │  /api/chat POST  │        │   .claude/commands/nova.md      │   │
│  │  streamText()    │        │   Bash → npx tsx scripts/chat   │   │
│  └────────┬─────────┘        └─────────────────┬───────────────┘   │
└───────────┼──────────────────────────────────  ┼ ───────────────────┘
            │                                    │
            ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (Sonnet 4, 12 steps)                │
│           src/lib/agents/orchestrator.ts (683 LOC)                  │
│   AgentConfig + orchestratorTools + ORCHESTRATOR_SYSTEM_PROMPT      │
│                                                                      │
│   Delegation tools          Dashboard tools (direct)                │
│   ─────────────────         ───────────────────────                 │
│   delegateToResearch        listWorkspaces                          │
│   delegateToLeads           getWorkspaceInfo                        │
│   delegateToWriter          getCampaigns / getReplies               │
│   delegateToCampaign        queryPeople / listProposals             │
│                             searchKnowledgeBase                     │
└───────────┬───────┬────────────────────┬──────────────┬────────────┘
            │       │                    │              │
            ▼       ▼                    ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Research   │ │   Writer     │ │   Leads      │ │  Campaign    │
│   Agent      │ │   Agent      │ │   Agent      │ │  Agent       │
│   (Opus, 8)  │ │   (Opus, 8)  │ │   (Opus, 8)  │ │  (Opus, 8)  │
│ research.ts  │ │ writer.ts    │ │ leads.ts     │ │ campaign.ts  │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │                  │
       └────────────────┴────────────────┴──────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       TOOL LAYER                                    │
│                                                                      │
│   DB (Prisma)    EmailBison API    Discovery Adapters    KB Search  │
│   src/lib/db     src/lib/email     src/lib/discovery    store.ts   │
└─────────────────────────────────────────────────────────────────────┘
```

### Current Architecture (v6 — Pre-migration)

The existing system has two invocation paths that share the same orchestrator:

1. **Dashboard Chat** (`/api/chat/route.ts`) — `streamText()` with `orchestratorTools`, returns streaming UI response. Sanitizes user input before delegating.

2. **CLI (nova.md skill)** — Executes `npx tsx` inline to call `generateText()` directly importing `orchestratorConfig` and `orchestratorTools`. One-shot, not persistent.

Both paths load the full TypeScript agent code at runtime. The specialist agents (research, writer, leads, campaign) are called inside the orchestrator's delegation tool `execute()` functions — they never run as separate processes.

The `runner.ts` is the shared execution engine: creates `AgentRun` audit records in Postgres, calls `generateText()`, extracts tool call steps, and persists output. Every agent invocation hits the Anthropic API and costs money.

---

## Target Architecture (v7 — CLI Skill System)

### Migration Goal

Replace direct Anthropic API calls in specialist agents with Claude Code CLI invocations. The key insight is that Claude Code (Max Plan) covers API costs, so running agents as Claude subprocesses is free vs Opus calls at ~$15/MTok input.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      INVOCATION LAYER (unchanged)                   │
│                                                                      │
│  ┌──────────────────┐        ┌─────────────────────────────────┐   │
│  │  Dashboard Chat  │        │   Claude Code CLI (nova skill)  │   │
│  │  /api/chat POST  │        │   .claude/commands/nova.md      │   │
│  │  (thin bridge)   │        │   (unchanged — calls scripts)   │   │
│  └────────┬─────────┘        └─────────────────┬───────────────┘   │
└───────────┼──────────────────────────────────  ┼ ───────────────────┘
            │ HTTP POST                           │ Bash exec
            ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│               ORCHESTRATOR BRIDGE (thin, Sonnet or Haiku)           │
│           No longer calls runResearchAgent() etc. directly          │
│           Instead: spawns claude --skill nova-{agent} --workspace   │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ CLI subprocess (claude --skill)
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │ nova-research │ │ nova-writer  │ │ nova-leads   │
        │ .claude/      │ │ .claude/     │ │ .claude/     │
        │ commands/     │ │ commands/    │ │ commands/    │
        │ nova-         │ │ nova-        │ │ nova-        │
        │ research.md   │ │ writer.md    │ │ leads.md     │
        │               │ │              │ │              │
        │ Uses Bash     │ │ Uses Bash    │ │ Uses Bash    │
        │ to call thin  │ │ to call thin │ │ to call thin │
        │ CLI wrappers  │ │ CLI wrappers │ │ CLI wrappers │
        └──────┬────────┘ └──────┬───────┘ └──────┬───────┘
               └─────────────────┼─────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CLI WRAPPER SCRIPTS (thin)                       │
│                  scripts/cli/                                        │
│                                                                      │
│  db-query.ts        emailbison.ts     kb-search.ts                  │
│  leads-search.ts    leads-export.ts   research-crawl.ts             │
│  campaign-crud.ts   workspace-get.ts  memory-read.ts                │
│  memory-write.ts                                                     │
│                                                                      │
│  Each script: load .env → call existing TypeScript lib → stdout JSON│
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EXISTING TOOL LAYER (unchanged)                  │
│                                                                      │
│  src/lib/agents/*.ts  src/lib/leads/  src/lib/discovery/            │
│  src/lib/emailbison/  src/lib/knowledge/store.ts                    │
│  prisma/schema.prisma                                                │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                CLIENT MEMORY FILES (new — flat file)                │
│                                                                      │
│  .claude/memory/{workspace-slug}/                                   │
│    profile.md          — ICP, tone, copy rules, writing style       │
│    copy-wins.md        — Subject lines and sequences that worked    │
│    campaign-history.md — Completed campaigns summary                │
│    feedback.md         — Client feedback log (most recent 10)       │
│    icp-learnings.md    — Qualification patterns and signals that fit│
│    approval-patterns.md — What client approves vs requests changes  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Recommended Project Structure

### New Files Required

```
/Users/jjay/programs/outsignal-agents/
├── .claude/
│   ├── commands/
│   │   ├── nova.md                   # EXISTING — orchestrator skill (thin, keep)
│   │   ├── nova-research.md          # NEW — research specialist skill
│   │   ├── nova-writer.md            # NEW — writer specialist skill
│   │   ├── nova-leads.md             # NEW — leads specialist skill
│   │   └── nova-campaign.md          # NEW — campaign specialist skill
│   └── memory/
│       └── {workspace-slug}/         # NEW — per-client memory namespace
│           ├── profile.md
│           ├── copy-wins.md
│           ├── campaign-history.md
│           ├── feedback.md
│           ├── icp-learnings.md
│           └── approval-patterns.md
│
├── scripts/
│   ├── chat.ts                       # EXISTING — interactive orchestrator CLI
│   ├── generate-copy.ts              # EXISTING — deprecated, keep as reference
│   └── cli/                          # NEW — thin CLI wrappers
│       ├── db-query.ts               # Prisma queries → stdout JSON
│       ├── workspace-get.ts          # getWorkspaceDetails → stdout JSON
│       ├── kb-search.ts              # searchKnowledge → stdout JSON
│       ├── research-crawl.ts         # Firecrawl crawl/scrape → stdout JSON
│       ├── leads-search.ts           # leads/operations.searchPeople → stdout JSON
│       ├── leads-export.ts           # leads/operations.exportToEmailBison → stdout JSON
│       ├── campaign-crud.ts          # Campaign CRUD ops → stdout JSON
│       ├── emailbison.ts             # EmailBison client calls → stdout JSON
│       ├── memory-read.ts            # Read .claude/memory/{slug}/*.md → stdout
│       └── memory-write.ts           # Append/update memory files
│
└── src/lib/agents/
    ├── orchestrator.ts               # EXISTING — modified: add CLI spawn tools
    ├── runner.ts                     # EXISTING — unchanged (kept as fallback)
    ├── research.ts                   # EXISTING — unchanged (kept as fallback)
    ├── writer.ts                     # EXISTING — unchanged (kept as fallback)
    ├── leads.ts                      # EXISTING — unchanged (kept as fallback)
    ├── campaign.ts                   # EXISTING — unchanged (kept as fallback)
    ├── shared-tools.ts               # EXISTING — unchanged
    ├── types.ts                      # EXISTING — extend with CLI invocation types
    ├── utils.ts                      # EXISTING — unchanged
    └── cli-spawn.ts                  # NEW — spawnCliAgent() utility
```

### Structure Rationale

- **`scripts/cli/`** — Thin wrappers isolated from agent logic. Each is a standalone Node.js script: `load .env → import lib function → call → print JSON → exit`. No agent intelligence, no prompts. This is the tool boundary.

- **`.claude/commands/nova-*.md`** — Skill definitions contain the agent prompt and tool invocation instructions. They tell Claude Code what to do and how to call the CLI wrappers. Skills replace `generateText()` calls.

- **`.claude/memory/{slug}/`** — Flat markdown files per workspace. Claude Code reads these directly into context. No DB required. Files are human-readable and version-controllable.

- **Existing `src/lib/agents/`** — Kept intact as fallback. No files deleted. The orchestrator gains a new "CLI spawn" path alongside the existing "direct call" path.

---

## Architectural Patterns

### Pattern 1: Skill as Prompt + Tool Instructions

**What:** A `.md` file in `.claude/commands/` defines an agent role as a Claude Code skill. The file contains: system prompt, tool usage instructions (which CLI scripts to call), memory read/write instructions, and output format. Claude Code executes the skill as a subagent.

**When to use:** For specialist agents that benefit from persistent memory and should run under the Claude Code Max Plan to eliminate API costs.

**Trade-offs:** Skills are stateless text files — no TypeScript type safety. But memory files provide cross-session persistence that the current architecture lacks entirely.

**Example structure:**
```markdown
# nova-writer

You are the Outsignal Writer Agent...

## Tools (call via Bash)

Get workspace intelligence:
  npx tsx scripts/cli/workspace-get.ts {workspace-slug}

Search knowledge base:
  npx tsx scripts/cli/kb-search.ts "subject line best practices" --tags cold-email

Read client memory:
  npx tsx scripts/cli/memory-read.ts {workspace-slug} copy-wins

Write to memory (append a copy win):
  npx tsx scripts/cli/memory-write.ts {workspace-slug} copy-wins "Subject: {line} — {reply-rate}"
```

### Pattern 2: Thin CLI Wrapper

**What:** A standalone `scripts/cli/*.ts` script that loads `.env`, imports an existing lib function, calls it with CLI args, prints JSON to stdout, and exits. Zero agent logic. Zero prompts. Pure data bridging.

**When to use:** To expose any existing TypeScript function to Claude Code Bash tool calls without rewriting the underlying logic.

**Trade-offs:** Each script must re-initialize Prisma client — small overhead (~300ms) per call. Acceptable for agent workflows which are measured in seconds.

**Example:**
```typescript
// scripts/cli/workspace-get.ts
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { getWorkspaceDetails } from "../../src/lib/workspaces";

const slug = process.argv[2];
if (!slug) { console.error("Usage: workspace-get.ts <slug>"); process.exit(1); }

getWorkspaceDetails(slug)
  .then(ws => { console.log(JSON.stringify(ws ?? { error: "not found" })); })
  .catch(err => { console.error(JSON.stringify({ error: err.message })); process.exit(1); });
```

### Pattern 3: Flat-File Memory Namespace

**What:** Per-workspace directory at `.claude/memory/{slug}/` containing markdown files. Each file covers one memory domain (copy-wins, feedback, profile). Claude Code reads them with the Read tool at skill startup and appends to them via `memory-write.ts`.

**When to use:** For any intelligence that should persist across agent sessions and accumulate over time. Replaces the current "no memory" state where each agent run starts cold.

**Trade-offs:** Files can grow unbounded. Need a pruning strategy (trim to last N entries, or summarize quarterly). Markdown is human-readable — admin can inspect and correct.

**Memory file format:**
```markdown
# Copy Wins — Rise

## 2026-03-15 | Campaign: Rise Q1 Static
- Subject: "branded merch for your team" — 4.2% reply rate
- Step 1 angle: cost anchor vs competitors → worked well
- Step 3 (breakup): "worth a quick chat?" → highest CTR

## 2026-03-01 | Campaign: Rise Launch
- "we outfit X teams" social proof opener — 3.8% reply rate
```

### Pattern 4: Orchestrator Bridge

**What:** The orchestrator's delegation tools (`delegateToResearch`, `delegateToWriter`, etc.) are modified to spawn Claude Code CLI skills instead of calling `runResearchAgent()` directly. The orchestrator passes context as flags or via stdin. Results come back as stdout text.

**When to use:** This is the core migration pattern. The orchestrator gains a new code path without removing the existing one.

**Trade-offs:** Subprocess spawning adds ~2-5 seconds latency per delegation. Acceptable because specialist agent runs already take 30-120 seconds. Error handling must capture non-zero exit codes and stderr.

**Invocation pattern:**
```typescript
// In orchestrator.ts delegation tool execute():
// New CLI path (feature-flagged):
const result = await spawnCliAgent("nova-writer", {
  workspace: workspaceSlug,
  task: task,
  args: ["--channel", channel ?? "email"],
});
// result.stdout = agent's text output
// result.exitCode = 0 on success

// Fallback path (existing, unchanged):
const result = await runWriterAgent({ workspaceSlug, task, channel });
```

---

## Data Flow

### Flow 1: Dashboard Chat → CLI Agent (Post-Migration)

```
User types in dashboard chat
    ↓
POST /api/chat → route.ts (streamText + orchestrator system prompt)
    ↓
Orchestrator decides to delegate to Writer
    ↓
delegateToWriter.execute() → spawnCliAgent("nova-writer", {...})
    ↓
Bash: claude --skill nova-writer --workspace rise --task "..."
    ↓
nova-writer.md skill loads → reads .claude/memory/rise/copy-wins.md
    ↓
Skill calls: npx tsx scripts/cli/workspace-get.ts rise
    ↓
workspace-get.ts → getWorkspaceDetails("rise") → stdout JSON
    ↓
Skill calls: npx tsx scripts/cli/kb-search.ts "subject line"
    ↓
Skill generates copy → calls memory-write.ts to log result
    ↓
Skill outputs campaign JSON to stdout
    ↓
spawnCliAgent resolves → orchestrator formats response
    ↓
streamText continues → UI receives token stream
```

### Flow 2: Memory Read/Write Cycle

```
Agent session starts
    ↓
Skill .md reads memory files (via Read tool or memory-read.ts)
    ↓
[profile.md, copy-wins.md, feedback.md loaded into context]
    ↓
Agent does work using accumulated knowledge
    ↓
Agent writes new learnings:
  npx tsx scripts/cli/memory-write.ts rise copy-wins "..."
    ↓
memory-write.ts appends dated entry to .claude/memory/rise/copy-wins.md
    ↓
Next session starts with updated context
```

### Flow 3: Dashboard Chat Bridge (Thin Path)

```
User message arrives at /api/chat
    ↓
route.ts sanitizes input (existing sanitizePromptInput — unchanged)
    ↓
streamText() with orchestratorConfig system prompt
    ↓
Orchestrator: simple query? → use dashboardTools directly (no spawn)
Orchestrator: complex task? → delegation tool → spawnCliAgent
    ↓
Result streams back to UI
    ↓
No change to frontend — UI is already thin
```

### Flow 4: Nova CLI Skill → Orchestrator (Unchanged)

```
User in Claude Code terminal: /nova "write copy for rise"
    ↓
nova.md skill executes
    ↓
Bash: cd /Users/jjay/programs/outsignal-agents && npx tsx -e "..."
    ↓
Inline script imports orchestratorConfig, orchestratorTools
    ↓
generateText() called with orchestrator config
    ↓
Orchestrator delegates → spawnCliAgent (new) or direct runAgent (fallback)
    ↓
Result printed to terminal
```

---

## Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `nova.md` | Entry point skill — orchestrator invocation via CLI | EXISTING, keep as-is |
| `nova-writer.md` | Writer specialist skill — prompts + tool call instructions | NEW |
| `nova-research.md` | Research specialist skill | NEW |
| `nova-leads.md` | Leads specialist skill | NEW |
| `nova-campaign.md` | Campaign specialist skill | NEW |
| `scripts/cli/*.ts` | Thin data wrappers exposing lib functions to Bash | NEW |
| `.claude/memory/{slug}/` | Per-client persistent memory files | NEW |
| `src/lib/agents/cli-spawn.ts` | `spawnCliAgent()` utility for orchestrator | NEW |
| `orchestrator.ts` | Central coordinator — gains `spawnCliAgent()` path | MODIFIED |
| `runner.ts` | Existing execution engine — kept as fallback | UNCHANGED |
| `research.ts` / `writer.ts` / `leads.ts` / `campaign.ts` | Existing specialist agents — fallback | UNCHANGED |
| `/api/chat/route.ts` | Dashboard chat bridge | UNCHANGED |

---

## Integration Points

### Skill ↔ CLI Wrapper Boundary

The boundary between skill (`.md` prompt file) and tool code (CLI script) is the stdout/stdin interface:

- Skills call wrappers via Bash: `npx tsx scripts/cli/workspace-get.ts rise`
- Wrappers output JSON to stdout, errors to stderr, exit code 0/1
- Skills parse stdout as JSON for structured data, or treat as text for KB results
- Skills never import TypeScript directly — they are text files

This boundary is critical. Tools should never contain prompt logic. Skills should never contain database logic.

### Orchestrator ↔ CLI Skill Boundary

The orchestrator's `delegateToX` tools currently call TypeScript functions directly. The migration adds a parallel path controlled by an env var:

```
// Current path (keep as fallback, activated when USE_CLI_AGENTS != "true"):
execute: async ({ task }) => await runWriterAgent({ task })

// New CLI path (activated when USE_CLI_AGENTS="true"):
execute: async ({ task }) => await spawnCliAgent("nova-writer", { task })
```

The `spawnCliAgent()` utility in `src/lib/agents/cli-spawn.ts` handles: subprocess creation, timeout (300 seconds), stdout buffering, exit code checking, and error formatting.

### Memory ↔ Agent Boundary

Memory files are read at skill startup and written at skill completion:

- **Read** — Claude Code's built-in Read tool loads markdown files into context. Skills instruct the agent to read specific files at startup.
- **Write** — `memory-write.ts` script appends entries. The script creates the directory/file if it does not exist.
- **Schema** — No enforced schema. Files are markdown with dated sections. This keeps them human-editable and correctable by admin.

### Dashboard Chat ↔ Orchestrator Boundary (unchanged)

The `/api/chat` route calls `streamText()` with `orchestratorTools`. After migration, `orchestratorTools` contains the same delegation tools — but their `execute()` functions now spawn CLI skills when `USE_CLI_AGENTS=true`. The dashboard chat sees no change.

### External Service Boundaries

| Service | Accessed By | How |
|---------|-------------|-----|
| PostgreSQL (Neon) | CLI wrappers via Prisma | `scripts/cli/*.ts` load `.env` |
| EmailBison API | `scripts/cli/emailbison.ts` | `getClientForWorkspace()` |
| Firecrawl | `scripts/cli/research-crawl.ts` | `crawlWebsite()` |
| Anthropic API | `runner.ts` fallback only | `generateText()` via AI SDK |
| Knowledge Base | `scripts/cli/kb-search.ts` | `searchKnowledge()` |
| Memory files | CLI skill via Read tool + `memory-write.ts` | Flat file system |

---

## Build Order (Dependency-Aware)

This sequence is required because each phase unblocks the next:

### Phase 1: CLI Wrapper Scripts (no dependencies)

Build `scripts/cli/` scripts first. They depend only on existing `src/lib/` code which is unchanged. Can be tested immediately with `npx tsx scripts/cli/workspace-get.ts rise`. Each script is independently testable.

Scripts to build in this order:
1. `memory-read.ts` + `memory-write.ts` — filesystem only, no Prisma
2. `workspace-get.ts` + `kb-search.ts` — read-only Prisma queries
3. `leads-search.ts` — read-only leads operations
4. `research-crawl.ts` — Firecrawl integration
5. `campaign-crud.ts` + `leads-export.ts` — write operations (test carefully)
6. `emailbison.ts` — external API calls

### Phase 2: Memory File Initialization (depends on: Phase 1)

Create `.claude/memory/` directory structure. Populate initial `profile.md` files for each workspace from existing Workspace DB records. Use a one-time init script that calls `workspace-get.ts` for each slug and formats the output as markdown.

Per workspace: `profile.md` (from `getWorkspaceDetails`), empty `copy-wins.md`, `campaign-history.md`, `feedback.md`, `icp-learnings.md`, `approval-patterns.md`.

### Phase 3: Specialist CLI Skills (depends on: Phases 1 + 2)

Write the four `nova-*.md` skill definition files. Each skill references specific CLI wrapper scripts from Phase 1 and memory files from Phase 2. Writer skill is highest priority (most used). Research skill second.

Skill files to write:
1. `nova-writer.md` — references `workspace-get`, `kb-search`, `memory-read/write`
2. `nova-research.md` — references `research-crawl`, `workspace-get`, `memory-write`
3. `nova-leads.md` — references `leads-search`, `leads-export`, `workspace-get`
4. `nova-campaign.md` — references `campaign-crud`, `workspace-get`

### Phase 4: CLI Spawn Utility (depends on: Phase 3 for interface design)

Write `src/lib/agents/cli-spawn.ts` — the `spawnCliAgent()` function that the orchestrator uses. This needs the skill names and expected output format defined in Phase 3 before the API can be designed correctly.

### Phase 5: Orchestrator Migration (depends on: Phases 1-4)

Modify `orchestrator.ts` delegation tools to call `spawnCliAgent()` when `USE_CLI_AGENTS=true`. Keep existing `runResearchAgent()` etc. calls as fallback. Test both paths. Validate end-to-end through dashboard chat.

### Phase 6: Dashboard Chat Validation (depends on: Phase 5)

Verify `/api/chat` still works end-to-end. No code changes expected — the orchestrator change is transparent to the chat route. Test multi-turn conversations, delegation round-trips, and memory accumulation across sessions.

---

## Anti-Patterns

### Anti-Pattern 1: Logic in Skill Files

**What people do:** Put TypeScript-equivalent logic in skill `.md` files (conditionals, data transformations, threshold checks).

**Why it's wrong:** Skill files are prompts. Prompts are unreliable for deterministic logic. If a workspace has a `monthlyCampaignAllowance`, checking it should happen in a CLI wrapper that returns a boolean, not in a prompt that might hallucinate the check.

**Do this instead:** Put any data logic in CLI wrapper scripts that output JSON. Skills consume the JSON and make decisions based on clear data.

### Anti-Pattern 2: Bypassing CLI Wrappers

**What people do:** Skills use `node -e "..."` inline scripts to access the database, because it seems faster than writing a wrapper.

**Why it's wrong:** This duplicates logic that already exists in `src/lib/`. It creates two code paths for the same operation, and the inline version won't have error handling, type safety, or Prisma connection cleanup.

**Do this instead:** Always route through `scripts/cli/` wrappers. If a wrapper does not exist yet, create one. One hour to write the wrapper saves days debugging divergent behavior.

### Anti-Pattern 3: Growing Memory Files Without Pruning

**What people do:** Append to memory files indefinitely, reasoning that "more context is better."

**Why it's wrong:** Claude Code context windows are finite. A `copy-wins.md` with 2 years of entries will push out current campaign context. Agent performance degrades as memory files bloat.

**Do this instead:** Design memory files with a rolling window. `copy-wins.md` keeps last 10 entries. `feedback.md` keeps last 10. `campaign-history.md` keeps a 1-line summary per campaign. Create a quarterly memory compaction script that summarizes and prunes.

### Anti-Pattern 4: One Giant Nova Skill

**What people do:** Put all specialist agent logic in a single `nova.md` skill file, reasoning that one context window is simpler.

**Why it's wrong:** The existing architecture deliberately separates concerns. A monolithic skill file loses the ability to run specialists in parallel and creates a 10,000+ token prompt that degrades reasoning quality.

**Do this instead:** Keep the orchestrator + specialist pattern. `nova.md` stays as the orchestrator entry point. Each specialist gets its own skill file. The orchestrator spawns the right specialist for each task.

### Anti-Pattern 5: Deleting Existing Agent Code

**What people do:** Remove `runner.ts`, `writer.ts`, `leads.ts` etc. once CLI skills are working.

**Why it's wrong:** The existing TypeScript agents are the fallback path for the dashboard chat and for programmatic use (signal campaigns, cron jobs). They also serve as the ground truth for what tools each specialist should have.

**Do this instead:** Keep all existing agent code. Add the CLI skill path as an additive feature controlled by `USE_CLI_AGENTS`. Mark old scripts as deprecated only after 30 days of stable CLI agent operation.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (8 clients) | Single `.claude/memory/` directory, flat files, manual pruning sufficient |
| 20-50 clients | Add automated memory compaction script (quarterly), consider memory file size limits |
| 50+ clients | DB-backed memory (migrate markdown files to `ClientMemory` Prisma model), keep CLI interface identical |

### Scaling Priorities

1. **First bottleneck: Memory file bloat** — At 8 clients with weekly campaigns, files stay manageable. At 50+ clients with daily operations, file-per-client will need compaction automation.

2. **Second bottleneck: CLI spawn latency** — Each `claude --skill` invocation adds ~2-5 seconds startup. For parallel operations across multiple workspaces, consider a process pool. Not a problem at current scale.

---

## Sources

- Direct code inspection: `src/lib/agents/orchestrator.ts` (683 LOC), `runner.ts`, `types.ts`, `writer.ts`, `leads.ts`, `shared-tools.ts`, `utils.ts`
- Direct code inspection: `src/app/api/chat/route.ts`, `scripts/chat.ts`, `scripts/generate-copy.ts`
- Direct code inspection: `.claude/commands/nova.md` (existing skill definition)
- Direct inspection: global `~/.claude/skills/nextjs16-skills/SKILL.MD` (skill format reference)
- Direct inspection: global `~/.claude/skills/ui-ux-pro-max/SKILL.md` (skill with scripts/data subdirs)
- Project context: `.planning/PROJECT.md` (v7.0 milestone definition)

---
*Architecture research for: Nova CLI Agent Teams — v7.0 Outsignal milestone*
*Researched: 2026-03-23*
