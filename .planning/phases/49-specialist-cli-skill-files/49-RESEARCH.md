# Phase 49: Specialist CLI Skill Files - Research

**Researched:** 2026-03-24
**Domain:** Claude Code skill file authoring, subagent delegation, per-workspace memory injection
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Memory injection pattern**
- All 4 memory files loaded for every agent — profile.md, campaigns.md, feedback.md, learnings.md all injected via `! cat` at skill invocation. Every agent gets full workspace context
- global-insights.md is intelligence-agent-only — only nova-intel loads global-insights.md. Other agents focus on their workspace
- Raw cat injection — `! cat .nova/memory/{slug}/profile.md .nova/memory/{slug}/campaigns.md .nova/memory/{slug}/feedback.md .nova/memory/{slug}/learnings.md` in each skill file. Simple, transparent, no formatting script
- Memory write-back at agent discretion — skill instructions tell agents: "If you learned something new about this client, append it to the relevant memory file before ending." Agent decides what's worth saving. Not every session writes

**Skill file structure & content**
- Skill file = identity + tools + memory — each skill file contains: agent role/purpose, tool call table (script paths + args + descriptions), memory injection (! cat), memory write-back reminder. Within 200-line budget
- Rules file = behavioral rules — all behavioral rules (quality checks, banned phrases, workflows, approval patterns, memory write governance) live in .claude/rules/. Referenced via @-file syntax
- Tool table format — markdown table listing each tool: name, script path, args pattern, brief description. Compact and scannable
- @ file reference for rules — use `@.claude/rules/writer-rules.md` syntax in skill files. Claude Code auto-loads the referenced file into context
- Update existing nova.md — keep nova.md as the orchestrator entry point. Update it to delegate to 7 specialists and inject memory

**Orchestrator delegation model**
- Agent tool subagents — orchestrator uses Claude Code's Agent tool to spawn specialist subagents. Each specialist runs with full context (memory + rules) in its own context window
- Workspace picker when no slug — if no slug provided, list all workspaces with names and slugs for user to pick
- Auto-detect specialist from request — orchestrator infers which specialist to invoke from the user's request. "Write emails" → writer, "Find CTOs" → leads, "Create campaign" → campaign
- Auto-chain multi-step workflows — for pipelines (research → leads → writer → campaign), orchestrator chains specialists automatically without stopping between steps. User sees the final output

**Agent-specific behavior rules**
- Flesh out all 3 new agents now — deliverability, onboarding, and intelligence get comprehensive rules based on existing codebase knowledge. Not stubs
- Review and update all 7 rules files — ensure all rules reference CLI tools (dist/cli/) not API tool functions, and add any missing guidance for the CLI context
- Memory write governance in rules files — each agent's rules file specifies: which memory files it can write to, what constitutes a writeable insight, append format with ISO timestamp
- Deliverability uses CLI wrappers only — calls sender-health.js, domain-health.js, bounce-stats.js, inbox-status.js for data. Can suggest triggering a fresh domain-health scan via Trigger.dev if real-time data needed

### Claude's Discretion
- Exact line count per skill file (within 200-line budget)
- How the orchestrator formats workspace picker output
- Internal structure of each rules file update
- Which memory files each agent is allowed to write to (beyond the general "append to relevant file" instruction)
- How auto-chaining passes context between spawned specialists

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SKL-01 | `nova-writer.md` skill file with writer agent prompt, tool invocation instructions, and memory read/write rules | Tool table derived from writer agent tools; memory files confirmed at `.nova/memory/{slug}/`; rules file already exists at `.claude/rules/writer-rules.md` |
| SKL-02 | `nova-research.md` skill file with research agent prompt and tool invocation instructions | research.ts tools audited; research-rules.md already exists but needs CLI tool references added |
| SKL-03 | `nova-leads.md` skill file with leads agent prompt and tool invocation instructions | leads.ts tools fully audited (23 tools); leads-rules.md already exists with full content |
| SKL-04 | `nova-campaign.md` skill file with campaign agent prompt and tool invocation instructions | campaign.ts tools audited; campaign-rules.md fully populated |
| SKL-05 | `nova-deliverability.md` skill file for inbox health monitoring, domain diagnostics, warmup strategy, and sender rotation | deliverability-rules.md is a stub — needs full behavioral rules added; CLI tools: sender-health.js, domain-health.js, bounce-stats.js, inbox-status.js |
| SKL-06 | `nova-onboarding.md` skill file for new client workspace setup, domain configuration, inbox provisioning, and initial campaign scaffolding | onboarding-rules.md is a stub — needs full behavioral rules; CLI tools: workspace-create flows, member-invite.js |
| SKL-07 | `nova-intelligence.md` skill file for analytics, cross-client benchmarking, performance insights, and campaign analysis | intelligence-rules.md is a stub — needs full rules; CLI tools: cached-metrics.js, insight-list.js, workspace-intelligence.js; also loads global-insights.md |
| SKL-08 | Existing `nova.md` updated with memory injection via `!` syntax and delegation to all 7 specialist skills | nova.md currently runs old API orchestrator via npx tsx; needs full rewrite to use CLI-based delegation + Agent tool pattern |
| SKL-09 | All skill files within 200-line budget with overflow content in `.claude/rules/` reference files | 200-line budget confirmed by official docs; rules overflow mechanism confirmed via @ import syntax |
</phase_requirements>

## Summary

Phase 49 creates the Claude Code skill files that turn the compiled CLI wrappers (Phase 48) and memory files (Phase 47) into a coherent multi-agent system. Each of the 7 specialist agents gets a `.claude/commands/nova-{specialist}.md` file — a lightweight skill that injects workspace context at startup, provides a compact tool reference table for the dist/cli/ scripts, and delegates behavioral rules to the matching `.claude/rules/` file.

The existing `nova.md` command file currently runs the old API orchestrator via `npx tsx`. It needs a full rewrite: instead of spawning an API-based agent, it should use Claude Code's native Agent tool to spawn specialist subagents, with memory files injected up front via `! cat`. The workspace slug flows from `$ARGUMENTS`, with a fallback workspace picker when no slug is supplied.

Three rules files — deliverability, onboarding, intelligence — currently exist only as stubs with a purpose line and a scope block. These need comprehensive behavioral rules authored in this phase. The four existing full rules files (writer, research, leads, campaign) need only a targeted review to ensure they reference `dist/cli/` paths instead of TypeScript AI SDK tool names, and to add the memory write governance block each agent needs.

**Primary recommendation:** Author skill files as identity + tool-table + memory-injection + rules-reference in that order, strict 200-line cap, then flesh out the three stub rules files before reviewing the four existing ones for CLI context accuracy.

## Standard Stack

### Core — This phase is configuration file authoring, not library installation

| Artifact | Format | Purpose | Location |
|----------|--------|---------|----------|
| Skill files | Markdown (.md) with optional YAML frontmatter | Claude Code `/skill-name` commands | `.claude/commands/nova-*.md` |
| Rules files | Plain Markdown | Behavioral rules injected via @ reference | `.claude/rules/*.md` |
| Memory files | Plain Markdown | Per-workspace context injected via `! cat` | `.nova/memory/{slug}/*.md` |
| CLI wrappers | Compiled JS | Tool calls agents make | `dist/cli/*.js` |

No npm packages are installed in this phase — it is entirely authoring of markdown files consumed by Claude Code.

### Compiled CLI Wrappers Available (Phase 48 output, all 55 scripts confirmed compiled)

All scripts in `dist/cli/` are pre-compiled and ready to reference in skill tool tables.

**Writer agent tools:**
| Script | Args | Purpose |
|--------|------|---------|
| workspace-intelligence.js | `--slug <slug>` | ICP, value props, tone guidance, website analysis |
| campaign-performance.js | `--slug <slug>` | Reply rates, bounce rates, engagement data |
| sequence-steps.js | `--campaignId <id>` | Existing sequence steps for a campaign |
| existing-drafts.js | `--slug <slug>` | Prior sequence drafts |
| campaign-context.js | `--campaignId <id>` | Campaign details + linked target list |
| save-sequence.js | `--file <json-path>` | Save sequence to a campaign |
| save-draft.js | `--file <json-path>` | Save standalone draft |
| kb-search.js | `--query <q> [--tags <t>] [--limit <n>]` | Search knowledge base |

**Research agent tools:**
| Script | Args | Purpose |
|--------|------|---------|
| website-crawl.js | `--url <url>` | Crawl website pages |
| url-scrape.js | `--url <url>` | Scrape single URL |
| workspace-get.js | `--slug <slug>` | Workspace info |
| website-analysis-save.js | `--file <json-path>` | Save website analysis |
| workspace-icp-update.js | `--slug <slug> --file <json-path>` | Update ICP fields |

**Leads agent tools:**
| Script | Args | Purpose |
|--------|------|---------|
| people-search.js | `--slug <slug> [filters]` | Search people DB |
| people-query.js | `--file <json-path>` | Advanced people query |
| list-create.js | `--slug <slug> --name <n>` | Create target list |
| list-add-people.js | `--listId <id> --file <json-path>` | Add people to list |
| list-get.js | `--listId <id>` | Get list details |
| list-get-all.js | `--slug <slug>` | All lists for workspace |
| list-score.js | `--listId <id>` | Score list against ICP |
| list-export.js | `--listId <id>` | Export to EmailBison |
| discovery-plan.js | `--file <json-path>` | Build discovery plan |
| discovery-promote.js | `--file <json-path>` | Deduplicate and promote |
| search-apollo.js | `--file <json-path>` | Search Apollo |
| search-prospeo.js | `--file <json-path>` | Search Prospeo |
| search-aiark.js | `--file <json-path>` | Search AI Ark |
| search-leads-finder.js | `--file <json-path>` | Apify Leads Finder |
| search-google.js | `--file <json-path>` | Google/Serper search |
| search-google-maps.js | `--file <json-path>` | Google Maps search |
| search-ecommerce.js | `--file <json-path>` | Ecommerce store search |
| extract-directory.js | `--url <url>` | Extract from directory |
| check-google-ads.js | `--domain <d>` | Google Ads check |
| check-tech-stack.js | `--domain <d>` | Tech stack detection |
| target-list-find.js | `--slug <slug> --name <n>` | Find target list by name |
| kb-search.js | `--query <q> [--tags <t>]` | Search knowledge base |

**Campaign agent tools:**
| Script | Args | Purpose |
|--------|------|---------|
| campaign-create.js | `--file <json-path>` | Create campaign |
| campaign-get.js | `--campaignId <id>` | Get campaign |
| campaign-list.js | `--slug <slug>` | List campaigns |
| target-list-find.js | `--slug <slug> --name <n>` | Find target list |
| campaign-status.js | `--campaignId <id> --status <s>` | Update status |
| campaign-publish.js | `--campaignId <id>` | Publish for review |
| signal-campaign-create.js | `--file <json-path>` | Create signal campaign |
| signal-campaign-activate.js | `--campaignId <id>` | Activate signal campaign |
| signal-campaign-pause.js | `--campaignId <id> --action <pause\|resume>` | Pause/resume signal |

**Orchestrator tools:**
| Script | Args | Purpose |
|--------|------|---------|
| workspace-list.js | (none) | List all workspaces |
| workspace-get.js | `--slug <slug>` | Get workspace details |
| workspace-package-update.js | `--slug <slug> --file <json-path>` | Update package |
| campaigns-get.js | `--slug <slug>` | Get EmailBison campaigns |
| replies-get.js | `--slug <slug>` | Get recent replies |
| notification-health.js | `[--range <24h\|7d\|30d>]` | Notification health |
| proposal-list.js | `--slug <slug>` | List proposals |
| proposal-create.js | `--file <json-path>` | Create proposal |
| people-query.js | `--file <json-path>` | Query people DB |

**Deliverability tools:**
| Script | Args | Purpose |
|--------|------|---------|
| sender-health.js | `--slug <slug>` | Inbox health summary |
| domain-health.js | `--slug <slug>` | Domain DNS/reputation |
| bounce-stats.js | `--slug <slug>` | Bounce rate analysis |
| inbox-status.js | `--slug <slug>` | Inbox connection status |

**Intelligence tools:**
| Script | Args | Purpose |
|--------|------|---------|
| cached-metrics.js | `--slug <slug>` | Cached performance metrics |
| insight-list.js | `--slug <slug>` | Generated insights from DB |
| workspace-intelligence.js | `--slug <slug>` | Full workspace intelligence |
| campaigns-get.js | `--slug <slug>` | Campaign data for analysis |

## Architecture Patterns

### Recommended File Structure for Phase 49

```
.claude/
├── commands/
│   ├── nova.md                    # Orchestrator — UPDATE existing file
│   ├── nova-writer.md             # NEW
│   ├── nova-research.md           # NEW
│   ├── nova-leads.md              # NEW
│   ├── nova-campaign.md           # NEW
│   ├── nova-deliverability.md     # NEW
│   ├── nova-onboarding.md         # NEW
│   └── nova-intelligence.md       # NEW
└── rules/
    ├── writer-rules.md            # Exists — review + add memory governance
    ├── research-rules.md          # Exists — review + add memory governance
    ├── leads-rules.md             # Exists — review + add memory governance
    ├── campaign-rules.md          # Exists — review + add memory governance
    ├── deliverability-rules.md    # Stub — flesh out FULLY
    ├── onboarding-rules.md        # Stub — flesh out FULLY
    └── intelligence-rules.md      # Stub — flesh out FULLY
```

### Pattern 1: Standard Skill File Structure

Every specialist skill file follows this template order:

```markdown
---
name: nova-{specialist}
description: {what this agent does and when to invoke it}
---

# Nova {Specialist} — {subtitle}

## Role
{1-2 sentence identity statement}

## Workspace Context
!`cat .nova/memory/$ARGUMENTS[0]/profile.md .nova/memory/$ARGUMENTS[0]/campaigns.md .nova/memory/$ARGUMENTS[0]/feedback.md .nova/memory/$ARGUMENTS[0]/learnings.md 2>/dev/null || echo "No memory files found for workspace: $ARGUMENTS[0]"`

## Tools
| Tool | Command | Args | Purpose |
|------|---------|------|---------|
| ... | node dist/cli/X.js | --slug {slug} | ... |

## Rules
@.claude/rules/{specialist}-rules.md

## Memory Write-Back
Before ending: if you learned something new about this client, append it to the relevant memory file.
- Profile observations → .nova/memory/{slug}/profile.md (admin-only, do not append)
- Campaign results → .nova/memory/{slug}/campaigns.md
- Client preferences → .nova/memory/{slug}/feedback.md
- ICP/lead/vertical learnings → .nova/memory/{slug}/learnings.md

$ARGUMENTS
```

**Key detail:** The `$ARGUMENTS` variable is the workspace slug. The `! cat` shell injection uses `$ARGUMENTS[0]` (index syntax) or passes the slug as a literal after the user types `/nova-writer rise`. The `2>/dev/null || echo ...` guard prevents errors when memory files are empty or missing.

### Pattern 2: Shell Injection for Memory Loading

The `!` (backtick-wrapped command) syntax in skill files runs before Claude sees any content:

```markdown
## Workspace Context
!`cat .nova/memory/$ARGUMENTS[0]/profile.md .nova/memory/$ARGUMENTS[0]/campaigns.md .nova/memory/$ARGUMENTS[0]/feedback.md .nova/memory/$ARGUMENTS[0]/learnings.md 2>/dev/null`
```

**What actually happens:**
1. User types `/nova-writer rise`
2. `$ARGUMENTS` → `"rise"`, `$ARGUMENTS[0]` → `"rise"`
3. The shell command runs immediately: `cat .nova/memory/rise/profile.md ...`
4. The cat output replaces the `!` placeholder
5. Claude receives the fully-rendered skill content including memory data

**CRITICAL:** Shell injection happens before the skill content is sent to Claude. Claude only sees the final rendered text, not the command itself.

### Pattern 3: @ File Reference for Rules

```markdown
@.claude/rules/writer-rules.md
```

Rules are loaded from disk at invocation time — Claude reads the file and injects it into context. This means rules can be updated without editing every skill file that references them.

### Pattern 4: nova.md Orchestrator Rewrite

The existing `nova.md` uses `npx tsx` to call the API orchestrator. The new pattern:

```markdown
---
name: nova
description: Outsignal campaign orchestrator. Routes requests to specialist agents and chains multi-step workflows.
---

# Nova — Campaign Operations Orchestrator

## Workspace Picker
If no workspace slug is provided in $ARGUMENTS, call:
node dist/cli/workspace-list.js
Then present the list and ask user to pick.

## Memory Context (when slug is known)
!`cat .nova/memory/$ARGUMENTS[0]/profile.md .nova/memory/$ARGUMENTS[0]/campaigns.md 2>/dev/null`

## Delegation
Route to specialists via the Agent tool:
- Writer requests → @"nova-writer (command)"
- Research/website → @"nova-research (command)"
- Lead discovery → @"nova-leads (command)"
- Campaign creation → @"nova-campaign (command)"
- Deliverability → @"nova-deliverability (command)"
- Client onboarding → @"nova-onboarding (command)"
- Analytics/intelligence → @"nova-intelligence (command)"

...
```

**IMPORTANT:** In Claude Code, you invoke a specialist by @-mentioning it (e.g., `@"nova-writer (command)"`). The orchestrator doesn't use the TypeScript Agent tool from AI SDK — it uses Claude Code's native subagent delegation via @-mention or the Agent tool in the UI.

### Pattern 5: Memory Write Governance Block in Rules Files

Each rules file must include a write governance section:

```markdown
## Memory Write Governance

### Files This Agent Can Write To
- `.nova/memory/{slug}/learnings.md` — ICP insights, lead source quality, vertical patterns
- `.nova/memory/{slug}/feedback.md` — client preferences observed, approval/rejection patterns

### Files This Agent Must NOT Write To
- `.nova/memory/{slug}/profile.md` — read-only, regenerated by nova-memory seed
- `.nova/memory/{slug}/campaigns.md` — read-only, populated by seed script

### Write Format
Append ONLY. Never delete existing lines. Use ISO timestamp:
```
[2026-03-24T14:00:00Z] — {your insight here}
```
Max 200 lines per file. If near limit, summarize older entries into one line before appending.
```

### Anti-Patterns to Avoid

- **Using `npx tsx` in skill files:** The new pattern calls `node dist/cli/*.js` directly against compiled output. No cold-start latency from tsx.
- **Putting behavioral rules in skill files:** Behavioral rules belong in `.claude/rules/` only. Skill files reference them via `@` syntax. This keeps skill files within the 200-line budget.
- **Assuming skill files are subagent definitions:** Skill files in `.claude/commands/` are invoked by the user typing `/nova-writer`. They are NOT subagent definitions in `.claude/agents/`. The Agent tool pattern is different.
- **Over-engineering the workspace picker:** A simple `node dist/cli/workspace-list.js` call + asking user to pick is sufficient. No custom picker script needed.
- **Using `$ARGUMENTS` without index for multi-word input:** When the slug could include workspace context, use `$ARGUMENTS[0]` to be explicit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Memory injection | Custom Python/Node formatter | `! cat` shell injection in skill file | Shell injection is Claude Code's native pattern — runs before any LLM call |
| Rules loading | Copy-paste rules into each skill | `@.claude/rules/` import | @ syntax auto-loads file at invocation; updates to rules propagate instantly |
| Subagent delegation | New TypeScript orchestrator code | Claude Code's native Agent tool / @ mention | No infrastructure needed; Claude Code handles the delegation natively |
| Workspace listing | New CLI for picker | `workspace-list.js` (already compiled) | Already built in Phase 48 |
| Rules validation | Runtime rule checker | Governance block in rules file | Agent reads and follows — same pattern as existing writer/leads rules |

## Common Pitfalls

### Pitfall 1: Memory Injection Path Resolution
**What goes wrong:** `! cat .nova/memory/rise/profile.md` fails with "no such file" when running from a different working directory.
**Why it happens:** Claude Code's `!` injection runs relative to the project root (working directory when Claude was started). If started from a different directory, paths fail.
**How to avoid:** Use the absolute path pattern or confirm that Claude Code is always started from `/Users/jjay/programs/outsignal-agents`. For robustness, add `2>/dev/null || echo "Memory not loaded"` to the cat command so the skill still works even if files are missing.
**Warning signs:** Skill returns "No such file or directory" in the injected context block.

### Pitfall 2: $ARGUMENTS Is the Full Argument String
**What goes wrong:** User types `/nova-writer rise detailed analysis` and `$ARGUMENTS[0]` returns `"rise"` but the full `$ARGUMENTS` is `"rise detailed analysis"`.
**Why it happens:** `$ARGUMENTS` is the raw string after the slash command name; `$ARGUMENTS[0]` is the first space-delimited token.
**How to avoid:** Design skills so the workspace slug is always the first argument: `/nova-writer {slug} {optional context}`. Use `$ARGUMENTS[0]` for the slug in shell injection, and `$ARGUMENTS` for the full context passed to the agent.
**Warning signs:** cat command tries to open a path containing spaces.

### Pitfall 3: 200-Line Budget Exceeded
**What goes wrong:** Skill file grows beyond 200 lines because behavioral rules were added inline instead of in rules files.
**Why it happens:** Temptation to inline everything for a "complete" skill file.
**How to avoid:** Any content beyond identity, tool table, memory injection, and rules reference goes in `.claude/rules/`. The `@` reference handles loading. Track line count during authoring.
**Warning signs:** skill file reaches 150+ lines with rules content still to add.

### Pitfall 4: Rules Files Reference TypeScript Tool Names
**What goes wrong:** Existing rules files say "call getWorkspaceIntelligence" instead of "run node dist/cli/workspace-intelligence.js" — agents attempt to call nonexistent JS functions.
**Why it happens:** Rules files were written for the API agent context where tool names are TypeScript function names. CLI agents use subprocess calls instead.
**How to avoid:** Review each rules file for any reference to camelCase tool names (getWorkspaceIntelligence, searchKnowledgeBase, etc.) and replace with the corresponding CLI command pattern.
**Warning signs:** Agent returns "I don't have a tool called getWorkspaceIntelligence."

### Pitfall 5: nova.md Retains Old API Pattern
**What goes wrong:** nova.md still runs `npx tsx -e "import { orchestratorConfig }..."` — this invokes the paid Anthropic API instead of the free Claude Code CLI.
**Why it happens:** The existing nova.md was written for the API orchestrator and wasn't updated.
**How to avoid:** nova.md must be fully rewritten. The old npx tsx block must be removed entirely and replaced with CLI-based delegation logic. No partial updates.
**Warning signs:** Running `/nova` incurs API costs visible on Anthropic dashboard.

### Pitfall 6: Stub Rules Files Left as Stubs
**What goes wrong:** deliverability-rules.md, onboarding-rules.md, intelligence-rules.md only contain scope/purpose comments — the @-referenced file gives agents almost no guidance.
**Why it happens:** These were created in Phase 46 as stubs with "Phase 49 will flesh these out."
**How to avoid:** All three must be fully authored in this phase before the skill files that reference them are considered done.
**Warning signs:** Running `/nova-deliverability rise` and agent responds with a vague or generic answer without domain knowledge.

## Code Examples

### Skill File — Canonical Pattern (Writer Example)

```markdown
---
name: nova-writer
description: Outsignal copywriter. Writes cold email and LinkedIn sequences for client campaigns. Use when generating outreach copy, revising drafts, or suggesting replies.
---

# Nova Writer — Cold Outreach Copywriter

## Role
You are Nova Writer, an expert cold outreach copywriter for Outsignal clients.
You write email and LinkedIn sequences that get replies, following client-specific tone, ICP, and historical feedback.

## Workspace Context
!`cat .nova/memory/$ARGUMENTS[0]/profile.md .nova/memory/$ARGUMENTS[0]/campaigns.md .nova/memory/$ARGUMENTS[0]/feedback.md .nova/memory/$ARGUMENTS[0]/learnings.md 2>/dev/null || echo "(No memory files found — workspace may not be seeded)"`

## Tools
All tools run from /Users/jjay/programs/outsignal-agents.

| Tool | Command | Purpose |
|------|---------|---------|
| Workspace intelligence | `node dist/cli/workspace-intelligence.js --slug {slug}` | ICP, value props, tone, website analysis |
| Campaign performance | `node dist/cli/campaign-performance.js --slug {slug}` | Reply/bounce rates for informed copy |
| Sequence steps | `node dist/cli/sequence-steps.js --campaignId {id}` | Existing steps for a campaign |
| Existing drafts | `node dist/cli/existing-drafts.js --slug {slug}` | Prior draft versions |
| Campaign context | `node dist/cli/campaign-context.js --campaignId {id}` | Campaign + linked target list |
| KB search | `node dist/cli/kb-search.js --query "{q}" --tags "{tags}" --limit {n}` | Knowledge base lookup |
| Save sequence | `node dist/cli/save-sequence.js --file /tmp/{uuid}.json` | Save to campaign |
| Save draft | `node dist/cli/save-draft.js --file /tmp/{uuid}.json` | Save standalone draft |

## Rules
@.claude/rules/writer-rules.md

## Memory Write-Back
After completing copy work: if you observed a new client preference, copy win, or ICP insight, append it to the relevant file with an ISO timestamp.
- New copy win/loss → .nova/memory/{slug}/campaigns.md
- Observed preference → .nova/memory/{slug}/feedback.md
- ICP or targeting insight → .nova/memory/{slug}/learnings.md

$ARGUMENTS
```

### Memory Governance Block (for rules files)

```markdown
## Memory Write Governance

### This Agent May Write To
- `.nova/memory/{slug}/learnings.md` — ICP insights, targeting patterns, what worked
- `.nova/memory/{slug}/feedback.md` — client approval/rejection preferences observed in session

### This Agent Must NOT Write To
- `.nova/memory/{slug}/profile.md` — regenerated by seed, not agent-writable
- `.nova/memory/{slug}/campaigns.md` — writer agent only for copy wins/losses

### Append Format
```
[ISO-DATE] — {concise insight in one line}
```
Example: `[2026-03-24T15:30:00Z] — CTOs in fintech at 50-200 person companies respond well to ROI-framing for Rise`

Only append if the insight is actionable for future sessions. Skip generic observations.
```

### Rules File CLI Reference Pattern (for updating existing rules)

Replace all camelCase tool function references with CLI invocation patterns:

```markdown
## Tools Available

To get workspace context:
```bash
node dist/cli/workspace-intelligence.js --slug {slug}
```

To search the knowledge base:
```bash
node dist/cli/kb-search.js --query "your query here" --tags "tag1,tag2" --limit 8
```

For complex JSON inputs, write to a temp file first:
```bash
# Write to /tmp/{uuid}.json, then:
node dist/cli/save-sequence.js --file /tmp/{uuid}.json
```
```

### Deliverability Rules — Key Sections to Author

The deliverability-rules.md stub needs these sections (based on codebase knowledge):

```markdown
# Deliverability Rules

## Purpose
Monitor inbox health, diagnose domain issues, advise on warmup, recommend sender rotation.

## Tools Available
- `node dist/cli/sender-health.js --slug {slug}` — per-inbox stats: sent, bounced, spam, connected status
- `node dist/cli/domain-health.js --slug {slug}` — domain DNS: SPF, DKIM, DMARC, MX, blacklist, warmup status
- `node dist/cli/bounce-stats.js --slug {slug}` — bounce rate trends (EmailBison stats)
- `node dist/cli/inbox-status.js --slug {slug}` — inbox connection status from EmailBison

## Diagnostic Flow
1. Always start with sender-health.js + domain-health.js for a full picture
2. If bounce rate > 5%: run bounce-stats.js to identify trend
3. If domain flagged as blacklisted: report domain + recommend immediate pause
4. If SPF/DKIM/DMARC misconfigured: provide exact DNS record the client needs to add

## Warmup Strategy Rules
[to be authored based on EmailGuard warmup data patterns]

## Memory Write Governance
This agent may write to: learnings.md (deliverability patterns per workspace)
...
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `npx tsx` API orchestrator (nova.md) | Claude Code skill files + dist/cli/ compiled scripts | Zero Anthropic API cost; Max Plan execution |
| All rules inline in agent TypeScript | Rules in .claude/rules/ files, shared by API + CLI agents | Single source of truth for behavioral rules |
| No persistent per-client memory | .nova/memory/{slug}/*.md files injected at session start | Client-aware from first turn; memory accumulates |
| API agents: camelCase tool function calls | CLI agents: `node dist/cli/*.js --args` subprocess calls | Rules files need updating to reflect this distinction |

**Files that currently exist but need updates vs files that are new:**
- nova.md: EXISTS, needs full rewrite
- nova-writer.md through nova-intelligence.md: DO NOT EXIST, are new files
- writer-rules.md, research-rules.md, leads-rules.md, campaign-rules.md: EXIST with full content
- deliverability-rules.md, onboarding-rules.md, intelligence-rules.md: EXIST as stubs (5-10 lines each)

## Open Questions

1. **How does nova.md pass slug + context to spawned specialist skills?**
   - What we know: Claude Code's Agent tool spawns subagents; @-mention invokes a skill from another skill
   - What's unclear: The exact syntax for one skill to invoke another skill with arguments from the parent context
   - Recommendation: nova.md instructs Claude Code to invoke specialists via @-mention pattern. The orchestrator itself gathers the slug first, then passes it as the argument. Explicit instruction in nova.md: "To invoke writer: use the Agent tool, spawning nova-writer with the slug as argument."

2. **Does the `! cat` injection support `$ARGUMENTS[0]` in .claude/commands/ files?**
   - What we know: Skills in `.claude/skills/` support `$ARGUMENTS[N]` substitution with the indexed syntax. The official docs confirm this for skills.
   - What's unclear: `.claude/commands/` files are "legacy" command files that work the same as skills per official docs. The `$ARGUMENTS[N]` syntax should work, but the docs note commands and skills are merged.
   - Recommendation: Use `$ARGUMENTS[0]` syntax — it's confirmed in official docs for skills and commands are documented as working identically. If it fails, fallback is to use `$ARGUMENTS` and have the shell command parse the first word: `! slug=$(echo "$ARGUMENTS" | awk '{print $1}'); cat .nova/memory/$slug/profile.md`
   - Confidence: MEDIUM — should work per docs, validate in first skill created

3. **Should nova.md be moved from .claude/commands/ to .claude/skills/?**
   - What we know: Official docs say .claude/commands/ and .claude/skills/ work the same way. Skills add optional features. Commands still work.
   - What's unclear: Whether migrating to skills/ format provides meaningful benefit for this phase.
   - Recommendation: Keep in .claude/commands/ — migration adds no functional benefit and would change the invocation path. SKL-08 says "update existing nova.md" not "migrate nova.md."

## Sources

### Primary (HIGH confidence)
- Official Claude Code docs (code.claude.com/docs/en/slash-commands) — skills/commands format, frontmatter fields, `! ` shell injection, `$ARGUMENTS[N]` substitution, `@` file reference syntax confirmed
- Official Claude Code docs (code.claude.com/docs/en/sub-agents) — Agent tool delegation, subagent skills preloading, @-mention invocation pattern confirmed
- Direct file inspection: `.claude/commands/nova.md` — existing orchestrator structure confirmed
- Direct file inspection: `.claude/rules/*.md` — all 7 rules files audited; 4 full, 3 stubs
- Direct file inspection: `dist/cli/*.js` — all 55 compiled scripts confirmed present
- Direct file inspection: `.nova/memory/rise/*.md` — all 4 memory files confirmed with governance headers

### Secondary (MEDIUM confidence)
- Phase 47 STATE.md decisions: memory file governance patterns (profile.md always overwrites, others skip-if-exists)
- Phase 48 STATE.md decisions: tsup compilation, dist/cli/ path patterns, JSON-file input pattern for complex args

### Tertiary (LOW confidence)
- `$ARGUMENTS[0]` in .claude/commands/ files: confirmed for .claude/skills/ by docs; commands documented as equivalent but explicit index syntax not shown in a commands/ example

## Metadata

**Confidence breakdown:**
- Skill file format and syntax: HIGH — verified against official Claude Code docs
- Available CLI tools: HIGH — 55 scripts confirmed compiled in dist/cli/
- Memory file structure: HIGH — files directly inspected
- Existing rules files content: HIGH — all 7 directly read
- $ARGUMENTS[N] in commands/ files: MEDIUM — confirmed for skills/, docs say commands are equivalent
- Delegation mechanism (nova → specialists): MEDIUM — Agent tool pattern confirmed, exact skill-to-skill invocation syntax needs validation in practice

**Research date:** 2026-03-24
**Valid until:** 2026-04-23 (30 days — Claude Code docs are relatively stable)
