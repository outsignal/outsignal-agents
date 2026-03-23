# Stack Research

**Domain:** CLI skill conversion — converting API-based agents to Claude Code CLI skills with persistent, client-specific memory
**Researched:** 2026-03-23
**Confidence:** HIGH (skill/command system verified against official Claude Code docs at code.claude.com; wrapper patterns verified against existing working codebase)

---

## Previous Stack Research

The previous STACK.md (2026-03-12) covered Trigger.dev background jobs migration. That research remains valid.
This file covers the v7.0 Nova CLI milestone stack additions only.

---

## Recommended Stack

### No New npm Dependencies Required

This is the most important finding: **zero new packages needed**. Everything required to execute CLI skills already exists in the codebase.

| Existing Dependency | Version | Role in CLI Skills |
|---------------------|---------|-------------------|
| `tsx` (via `npx tsx`) | latest | Runs TypeScript orchestrator scripts directly — already used by `npm run chat` and the `nova.md` skill |
| `ai` (Vercel AI SDK) | installed | `generateText` + `stepCountIs` drive agent loops — same pattern as current `runner.ts` |
| `@ai-sdk/anthropic` | installed | Anthropic model provider — already authenticated via `ANTHROPIC_API_KEY` |
| `dotenv` | installed | `.env` + `.env.local` loading in CLI scripts — same pattern as `scripts/chat.ts` |
| `@prisma/client` | 6.x | DB queries from wrapper scripts — already used in all scripts |
| `chalk` | installed | Terminal output formatting — used in `scripts/chat.ts` |

The only "additions" are text files (`.claude/skills/*/SKILL.md`, memory markdown files) and TypeScript wrapper scripts following patterns already established in `scripts/`.

---

### Core Mechanism: Claude Code Skills (formerly "custom commands")

**What they are:** Markdown files that give Claude Code a named `/slash-command` with instructions, tool permissions, and context.

**Official docs:** https://code.claude.com/docs/en/slash-commands (HIGH confidence — fetched 2026-03-23)

**Two equivalent file locations (both work):**

| Location | Path | Scope |
|----------|------|-------|
| Legacy commands | `.claude/commands/<name>.md` | This project (already used — `nova.md` exists here) |
| Skills (recommended) | `.claude/skills/<name>/SKILL.md` | This project |
| Personal skills | `~/.claude/skills/<name>/SKILL.md` | All projects on machine |

The existing `.claude/commands/nova.md` **already works and is the right pattern**. Skills add optional extras (supporting files, `context: fork`) but the `.claude/commands/` path is not deprecated — it's explicitly documented as equivalent.

**Recommendation:** Keep existing `nova.md` in `.claude/commands/`. Add new specialist agent skills there too, not in `.claude/skills/`, to keep all Nova skills co-located.

---

### Skill File Format

Every skill is a markdown file with optional YAML frontmatter:

```markdown
---
name: nova-writer
description: Generate email and LinkedIn copy for a client workspace. Use when writing cold outreach sequences, revising copy, or running the Writer Agent.
argument-hint: <workspace-slug> [channel] [campaign-name]
disable-model-invocation: true
allowed-tools: Bash(npx tsx *)
---

You are the Nova Writer skill...

$ARGUMENTS
```

**Frontmatter fields used for Nova skills:**

| Field | Value | Why |
|-------|-------|-----|
| `name` | `nova-writer`, `nova-leads`, etc. | Becomes the `/nova-writer` slash command |
| `description` | What it does + when to use it | Claude uses this to decide when to auto-load; keep specific |
| `argument-hint` | `<workspace-slug> [options]` | Shows in autocomplete UI |
| `disable-model-invocation: true` | Set on all Nova agent skills | We control timing — don't want Claude auto-running campaign operations |
| `allowed-tools` | `Bash(npx tsx *)` | Pre-approves the specific bash commands the skill needs without prompting |

**String substitutions available inside skill content:**

| Variable | Replaced With |
|----------|---------------|
| `$ARGUMENTS` | Everything typed after `/nova-writer` |
| `$ARGUMENTS[0]` | First argument (e.g. workspace slug) |
| `$ARGUMENTS[1]` | Second argument (e.g. channel) |
| `${CLAUDE_SESSION_ID}` | Current session ID — useful for memory file naming |
| `${CLAUDE_SKILL_DIR}` | Absolute path to the skill's directory |

**Dynamic context injection (shell commands in skill content):**

The `` !`<command>` `` syntax runs a shell command before Claude sees the prompt and injects the output inline. Use this to load client memory into the skill at invocation time:

```markdown
## Client Memory
!`cat /Users/jjay/programs/outsignal-agents/.nova/memory/$ARGUMENTS[0]/MEMORY.md 2>/dev/null || echo "No memory yet for this workspace"`
```

This is preprocessing — the command runs first, output replaces the placeholder, Claude sees the result. This is the mechanism for injecting client-specific memory.

---

### Memory Architecture

Claude Code offers two memory mechanisms. Both matter for Nova.

**Mechanism 1: CLAUDE.md — Persistent project instructions (loaded every session)**

Location: `.claude/CLAUDE.md` (already used by GSD and existing instructions)

Add a section to the project's `.claude/CLAUDE.md` referencing the Nova memory structure:

```markdown
## Nova Agent Memory

Nova agent skills read client memory from `.nova/memory/<workspace-slug>/MEMORY.md`.
When working with Nova skills, always check this file for client-specific intelligence.
```

**Mechanism 2: Client-namespaced memory files — Per-workspace persistent intelligence**

Store in: `.nova/memory/<workspace-slug>/MEMORY.md` (committed to repo, not `.claude/` auto memory)

Why not use Claude Code's built-in auto memory (`~/.claude/projects/.../memory/`)? Because:
- Auto memory is machine-local (not shared across machines)
- Auto memory's 200-line limit and `MEMORY.md` index structure is designed for general session notes
- Client intelligence (tone profile, copy wins, ICP learnings, approval patterns) needs to be workspace-namespaced, version-controlled, and portable

The `.nova/memory/` directory approach:
- Version-controlled in the repo — memory persists across machines
- Skills can read it via `!` shell injection at invocation time
- Agents can write to it via Bash tool (Claude Code's `Write` or `Bash` tool)
- One file per workspace, additional topic files (e.g. `copy-wins.md`, `icp-learnings.md`) when MEMORY.md grows past 200 lines

**Memory file structure per workspace:**

```
.nova/
  memory/
    rise/
      MEMORY.md           # Index: tone, ICP, standing instructions (keep <200 lines)
      copy-wins.md        # What's worked in campaigns (loaded on demand)
      icp-learnings.md    # ICP refinements from replies/approvals
    lime-recruitment/
      MEMORY.md
    yoopknows/
      MEMORY.md
    outsignal/
      MEMORY.md
    myacq/
      MEMORY.md
    1210-solutions/
      MEMORY.md
    blanktag/
      MEMORY.md
    covenco/
      MEMORY.md
```

**MEMORY.md format per workspace (example):**

```markdown
# Nova Memory: Rise (Branded Merchandise)

**Last updated:** 2026-03-20
**Workspace slug:** rise

## Tone & Voice
- Casual, direct, no corporate speak
- Uses "kit" not "merchandise", "promo" not "promotional products"
- First email punchy: under 80 words

## ICP Refinements
- Best respondents: Marketing Managers at 50-500 person companies in events/hospitality
- Avoid: finance companies (bad fit historically)
- UK + US outperforms EU by 2x on reply rate

## What Works
- Subject: "quick q on branded kit" — 12% OR on rise-q1 campaign
- Hook: referencing their LinkedIn event content outperforms generic openers
- Follow-up on day 5 outperforms day 3 (based on campaign analytics data)

## Approval Patterns
- Client approves 95%+ first draft — high trust
- Prefers 4-step email sequences over 3-step
- Always wants A/B subject line variants

## Standing Instructions
- Never mention competitor pricing
- Always include a case study in step 3 when available
```

---

### CLI Wrapper Script Architecture

The thin wrapper scripts expose TypeScript tool functions to skills via Bash. The existing `scripts/chat.ts` and the `nova.md` skill already validate this pattern.

**Wrapper design principle:** Each script does one job. The skill handles orchestration logic; the script is a pure executor.

**Pattern (already proven in `nova.md` + `scripts/chat.ts`):**

```typescript
// scripts/nova-run.ts — thin wrapper the skill calls via npx tsx
import { config } from 'dotenv';
config({ path: '.env' });
config({ path: '.env.local' });

import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { orchestratorConfig, orchestratorTools } from '../src/lib/agents/orchestrator';

const [workspaceSlug, ...messageParts] = process.argv.slice(2);
const userMessage = messageParts.join(' ');

(async () => {
  const result = await generateText({
    model: anthropic(orchestratorConfig.model),
    system: orchestratorConfig.systemPrompt +
      `\nCurrent workspace: ${workspaceSlug}\nInterface: CLI`,
    messages: [{ role: 'user', content: userMessage }],
    tools: orchestratorTools,
    stopWhen: stepCountIs(orchestratorConfig.maxSteps ?? 12),
  });
  console.log(result.text);
})().catch(err => { console.error(err); process.exit(1); });
```

**Why `npx tsx` not a compiled binary:** Zero build step. Dotenv + path aliases (`@/lib/...`) work via `tsconfig.json`. Already the established project pattern. No maintenance overhead.

**Why NOT to create separate scripts for each specialist agent:** The orchestrator already handles delegation to research/writer/leads/campaign agents. Skills call the orchestrator; orchestrator delegates. Same layering as dashboard chat. One wrapper script per access pattern (orchestrator, writer-only, leads-only), not one per agent.

**Proposed wrapper scripts (add to `scripts/`):**

| Script | When Used | What It Calls |
|--------|-----------|---------------|
| `scripts/nova-run.ts` | Nova orchestrator skill — full pipeline | `orchestratorConfig` + `orchestratorTools` |
| `scripts/nova-writer.ts` | Writer-only skill — copy generation/revision | `runWriterAgent()` directly |
| `scripts/nova-leads.ts` | Leads-only skill — search, list build | `runLeadsAgent()` directly |
| `scripts/nova-memory.ts` | Memory update utility | Reads/writes `.nova/memory/<slug>/MEMORY.md` |

The `nova-writer.ts` and `nova-leads.ts` scripts skip the orchestrator when a specialist is invoked directly (avoids paying for an orchestrator model turn on simple tasks).

---

### Dual-Mode Architecture: CLI Primary + API Fallback

The existing agent code (`runner.ts`, `orchestrator.ts`, etc.) runs identically in both modes because both use the same `generateText` + `orchestratorTools` pattern. No changes needed to agent code.

**What changes:**
- Dashboard chat route (`/api/agents/chat/route.ts` or similar) continues calling `runAgent()` via the API path
- CLI skills call the same agents via `npx tsx scripts/nova-run.ts`
- The same `orchestratorTools`, `writerTools`, etc. are shared — no duplication

**What does NOT change (do not touch):**
- `src/lib/agents/orchestrator.ts`
- `src/lib/agents/runner.ts`
- `src/lib/agents/writer.ts`, `leads.ts`, `research.ts`, `campaign.ts`
- `src/lib/agents/types.ts`
- Any Trigger.dev tasks
- Any dashboard UI code

The only code that changes is the entry point layer: new thin wrapper scripts under `scripts/nova-*.ts`.

---

### Skill Invocation Pattern

**How a Nova skill gets invoked in Claude Code:**

1. User types `/nova rise` in Claude Code terminal
2. Claude Code reads `.claude/commands/nova.md` (existing) or `.claude/commands/nova-writer.md` (new)
3. `$ARGUMENTS` gets replaced with `rise`
4. `!`cat ...`` shell injections fire — client memory gets loaded into the prompt
5. Claude reads the skill instructions and calls `Bash` tool with `npx tsx scripts/nova-run.ts rise "user message here"`
6. `nova-run.ts` loads dotenv, calls `generateText` with orchestrator, streams tool calls to stdout
7. Claude reads stdout, reports result to user

**The `allowed-tools: Bash(npx tsx *)` frontmatter field** pre-approves those bash calls without requiring per-use permission prompts. This is critical for smooth operation — without it, every `npx tsx` invocation requires manual approval.

---

### What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| New npm package for CLI arg parsing | Overkill — `process.argv.slice(2)` is sufficient for simple slug + message patterns | `process.argv` (already used in existing scripts) |
| Compiled TypeScript binaries | Build step required, no path alias support without config — adds friction | `npx tsx` (already the pattern) |
| MCP server for agent tools | More complex than needed — Claude Code already calls agents via Bash | `npx tsx` wrapper scripts (simpler, already working) |
| `context: fork` on Nova skills | Forks lose conversation history — breaks multi-turn workflows | Default context (inline in conversation) |
| Agent tool definitions as Claude Code tools (via MCP) | Duplicates existing Vercel AI SDK tool definitions — maintenance burden | Call `orchestratorTools` directly from wrapper scripts |
| Storing memory in `~/.claude/projects/` auto memory | Machine-local, not version-controlled, 200-line limit on auto-load | `.nova/memory/<slug>/` in repo — version-controlled and portable |
| Separate orchestrator per client | Creates 8 near-identical skill files — hard to maintain | Single `nova.md` skill that accepts workspace slug as `$ARGUMENTS[0]` |

---

### Skills Map for v7.0

The milestone requires 5 skills total. These extend/replace the existing `nova.md`:

| Skill File | Command | Purpose | `allowed-tools` |
|------------|---------|---------|-----------------|
| `.claude/commands/nova.md` | `/nova` | Orchestrator — full pipeline, any workspace | `Bash(npx tsx *)` |
| `.claude/commands/nova-writer.md` | `/nova-writer` | Writer-only shortcut — skip orchestrator for copy tasks | `Bash(npx tsx *)` |
| `.claude/commands/nova-leads.md` | `/nova-leads` | Leads-only shortcut — search, list build | `Bash(npx tsx *)` |
| `.claude/commands/nova-memory.md` | `/nova-memory` | Read/update client memory file | `Bash(cat *), Write` |
| `.claude/commands/nova-research.md` | `/nova-research` | Research agent — website analysis, ICP extraction | `Bash(npx tsx *)` |

The existing `nova.md` covers the orchestrator. The specialist shortcuts save model turns for focused tasks.

---

## Installation

No `npm install` required. All work is file creation:

```bash
# 1. Create memory directory structure
mkdir -p .nova/memory/{rise,lime-recruitment,yoopknows,outsignal,myacq,1210-solutions,blanktag,covenco}

# 2. Create wrapper scripts (new files under scripts/)
# scripts/nova-run.ts
# scripts/nova-writer.ts
# scripts/nova-leads.ts
# scripts/nova-memory.ts

# 3. Create specialist skill files (new .md files)
# .claude/commands/nova-writer.md
# .claude/commands/nova-leads.md
# .claude/commands/nova-memory.md
# .claude/commands/nova-research.md
# (update existing .claude/commands/nova.md to inject memory)

# 4. Populate initial MEMORY.md per workspace from existing DB data
npx tsx scripts/nova-memory.ts --init-all
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `.claude/commands/` for skill files | `.claude/skills/<name>/SKILL.md` (new format) | Use skills format if you want `context: fork` subagent isolation or supporting file directories. Not needed here — inline context is correct for conversational workflows. |
| `.nova/memory/` in repo | `~/.claude/projects/.../memory/` auto memory | Use auto memory for machine-local session notes. Use `.nova/memory/` when memory must be version-controlled, shared across machines, and workspace-namespaced. |
| Single `nova.md` + `$ARGUMENTS[0]` for workspace | One skill file per workspace | One per workspace = 8 nearly identical files. Single parameterised skill is maintainable. |
| `npx tsx` wrapper scripts | Compiled TS binary or Node.js-only scripts | Compiled adds a build step. JS-only loses type safety and path aliases. `npx tsx` is the established pattern with zero new tooling. |
| Shell injection `!` for memory loading | Reading memory inside the orchestrator script | Shell injection happens before Claude's turn — memory is in the initial prompt. Orchestrator-side reading would require a tool call and an extra model turn. |

---

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| `.claude/commands/` skill files | Claude Code current (verified 2026-03-23) | Legacy path explicitly supported alongside new `.claude/skills/` path. No migration required. |
| `allowed-tools: Bash(npx tsx *)` frontmatter | Claude Code current | Glob patterns supported in tool permissions. `Bash(npx tsx *)` covers all `npx tsx` calls. |
| `!` shell injection in skill content | Claude Code current | Runs before prompt is sent to Claude. Shell must be available (it is on macOS/Linux). |
| `$ARGUMENTS` substitution | Claude Code current | Replaced at invocation time. `$ARGUMENTS[0]` for positional access. |
| `npx tsx` with path aliases | Requires `tsconfig.json` `paths` + `tsx` resolving them | Already works in project (confirmed by `scripts/chat.ts` and `nova.md` patterns). |

---

## Sources

- [Claude Code Skills docs](https://code.claude.com/docs/en/slash-commands) — Full skill format, frontmatter reference, `$ARGUMENTS`, shell injection, `allowed-tools`, `context: fork` — HIGH confidence (fetched 2026-03-23)
- [Claude Code Memory docs](https://code.claude.com/docs/en/memory) — CLAUDE.md hierarchy, auto memory storage location, 200-line limit, `.claude/rules/` — HIGH confidence (fetched 2026-03-23)
- `/Users/jjay/programs/outsignal-agents/.claude/commands/nova.md` — Existing working skill: `npx tsx -e` inline execution pattern, workspace list, orchestrator invocation — HIGH confidence (verified against live file)
- `/Users/jjay/programs/outsignal-agents/scripts/chat.ts` — Established wrapper pattern: dotenv loading, chalk formatting, `generateText` loop, workspace picker — HIGH confidence (existing code)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — Agent execution engine: `generateText` + `stepCountIs`, AgentRun DB logging — HIGH confidence (existing code)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/types.ts` — Agent input/output types, Zod schemas — HIGH confidence (existing code)

---
*Stack research for: v7.0 Nova CLI Agent Teams — Claude Code skill conversion + client-specific memory*
*Researched: 2026-03-23*
