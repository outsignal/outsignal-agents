# Architecture Research

**Domain:** Dev Orchestrator (Monty) — integration with existing Nova agent framework
**Researched:** 2026-04-02
**Confidence:** HIGH — based on direct inspection of all existing agent framework files

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Entry Points (CLI)                               │
│                                                                          │
│   scripts/chat.ts (Nova)          scripts/monty.ts (Monty — new)        │
│   npm run chat                    npm run monty                          │
└─────────────────────┬──────────────────────────────────────┬────────────┘
                      │                                      │
┌─────────────────────▼──────────────┐  ┌───────────────────▼────────────┐
│       Nova Orchestrator             │  │      Monty Orchestrator         │
│   src/lib/agents/orchestrator.ts   │  │  src/lib/agents/dev/           │
│                                    │  │  dev-orchestrator.ts            │
│  DOMAIN: workspace slug present    │  │  DOMAIN: codebase changes       │
│  TOOLS: workspace-scoped only      │  │  TOOLS: dev-scoped only         │
│  MODEL: claude-opus-4-6            │  │  MODEL: claude-opus-4-6         │
└─────────────────────┬──────────────┘  └───────────────────┬────────────┘
                      │                                      │
┌─────────────────────▼──────────────────────────────────────▼────────────┐
│                      SHARED INFRASTRUCTURE (minimal changes)              │
│                                                                           │
│   src/lib/agents/runner.ts     — runAgent(), AgentRun audit, onComplete  │
│   src/lib/agents/memory.ts     — loadMemoryContext(), appendToMemory()   │
│   src/lib/agents/types.ts      — AgentConfig, AgentRunResult interfaces  │
│   src/lib/agents/load-rules.ts — loadRules() from .claude/rules/         │
└──────────────────────────────────────────────────────────────────────────┘
                      │                                      │
┌─────────────────────▼──────────────┐  ┌───────────────────▼────────────┐
│       Nova Specialists (unchanged)  │  │      Monty Specialists (new)    │
│   src/lib/agents/{specialist}.ts   │  │  src/lib/agents/dev/           │
│                                    │  │  {specialist}.ts               │
│  research.ts   writer.ts           │  │  backend.ts  frontend.ts       │
│  leads.ts      campaign.ts         │  │  infra.ts    qa.ts             │
│  deliverability.ts  intelligence.ts│  │  security.ts                   │
│  onboarding.ts                     │  │                                 │
└─────────────────────┬──────────────┘  └───────────────────┬────────────┘
                      │                                      │
┌─────────────────────▼──────────────────────────────────────▼────────────┐
│                           Tool Namespaces (separated)                     │
│                                                                           │
│   Nova Tools (scripts/cli/*.ts)        Dev Tools (scripts/dev-cli/*.ts)  │
│   — DB CRUD for campaign entities      — Git operations                  │
│   — EmailBison API calls               — File read/write                 │
│   — Discovery API adapters             — npm/build/test runners          │
│   — Lead scoring, enrichment           — Vercel/Railway/Trigger.dev CLI  │
│   — Workspace memory read/write        — Prisma schema introspection     │
└──────────────────────────────────────────────────────────────────────────┘
                      │                                      │
┌─────────────────────▼──────────────────────────────────────▼────────────┐
│                           Memory Namespaces (separated)                   │
│                                                                           │
│   .nova/memory/{slug}/           .monty/memory/                          │
│     profile.md                     backlog.md                            │
│     campaigns.md                   architecture.md                       │
│     learnings.md                   decisions.md                          │
│     feedback.md                    incidents.md                          │
│   .nova/memory/global-insights.md  .monty/memory/global-insights.md     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Shared or New |
|-----------|----------------|---------------|
| `runner.ts` | Core execution engine — AgentRun audit, generateText, onComplete hooks | **Shared unchanged.** Both Nova and Monty call `runAgent()` from this file. |
| `memory.ts` | 3-layer context reads, appendToMemory, appendToGlobalMemory | **Shared with one change.** Gains optional `memoryRoot` param (default `.nova/memory`). Monty passes `.monty/memory`. |
| `types.ts` | AgentConfig, AgentRunResult, specialist Input/Output interfaces | **Shared.** Monty-specific I/O types added as new exports in this file or in `dev/dev-types.ts`. |
| `load-rules.ts` | Reads `.claude/rules/*.md` into system prompts | **Shared unchanged.** Monty adds its own `.claude/rules/dev-*.md` files read via the same function. |
| `orchestrator.ts` (Nova) | Routes workspace work to 7 specialists, holds dashboard tools | **Unchanged.** No dev tools added here. |
| `dev/dev-orchestrator.ts` | Triages bugs vs features, routes codebase work to 5 dev specialists, manages backlog | **New.** Mirrors structure of `orchestrator.ts` but dev-scoped. |
| `dev/{specialist}.ts` | 5 dev specialists — each has config, tools, onComplete, `runXxxAgent()` export | **New.** Same file pattern as Nova specialists. |
| `scripts/monty.ts` | Interactive CLI REPL for Monty — parallel to `scripts/chat.ts` | **New.** No workspace picker (dev work is project-wide, not workspace-scoped). |
| `scripts/dev-cli/*.ts` | Dev tools invoked by Monty specialists (git, file ops, build, deploy) | **New.** Separate namespace from `scripts/cli/*.ts`. |

---

## Recommended Project Structure

```
src/lib/agents/
├── runner.ts               SHARED — one-line change (memoryRoot param)
├── memory.ts               SHARED — minor extension (memoryRoot param)
├── types.ts                SHARED — new DevXxxInput/Output types appended
├── load-rules.ts           SHARED — unchanged
├── orchestrator.ts         Nova orchestrator — unchanged
├── {nova-specialists}.ts   Nova specialists — unchanged
└── dev/
    ├── dev-orchestrator.ts # Monty orchestrator config + delegateToXxx tools
    ├── dev-types.ts        # Monty-specific I/O types (DevTaskInput, BugReport, etc.)
    ├── backend.ts          # Backend specialist (API routes, Prisma, Trigger.dev)
    ├── frontend.ts         # Frontend/UI specialist (components, pages, design system)
    ├── infra.ts            # Infrastructure specialist (deploys, Railway, DNS)
    ├── qa.ts               # QA specialist (testing, code review, validation)
    └── security.ts         # Security specialist (auth, OWASP, credential handling)

scripts/
├── chat.ts                 Nova CLI entry point — unchanged
├── monty.ts                Monty CLI entry point — new (no workspace picker)
├── cli/                    Nova CLI tools — unchanged (55 scripts)
│   └── *.ts
└── dev-cli/                Monty CLI tools — new namespace
    ├── git-status.ts       git status + diff summary
    ├── git-log.ts          recent commits with context
    ├── run-tests.ts        npx tsx test runner wrapper
    ├── build-check.ts      TypeScript compile check
    ├── backlog-get.ts      read .monty/memory/backlog.md
    ├── backlog-add.ts      append to backlog
    ├── file-read.ts        safe file read (respects .claudeignore)
    ├── file-write.ts       writes code changes via temp file pattern
    └── deploy-status.ts    Vercel/Trigger.dev/Railway deployment status

.claude/rules/
├── {existing nova rules}          unchanged (12 files)
├── dev-orchestrator-rules.md      Monty PM behaviour: triage, routing, boundary enforcement
├── dev-backend-rules.md           Backend agent: Prisma patterns, Next.js API conventions
├── dev-frontend-rules.md          Frontend agent: design system, component patterns
├── dev-infra-rules.md             Infra agent: deploy commands, Railway/Vercel/Trigger.dev
├── dev-qa-rules.md                QA agent: test patterns, review checklists
└── dev-security-rules.md          Security agent: OWASP, secret handling, auth patterns

.monty/memory/
├── backlog.md              Bug/feature backlog (Monty writes here after triage)
├── architecture.md         Key architecture decisions Monty has made/enforced
├── decisions.md            ADRs and rationale from dev sessions
├── incidents.md            Incident log (bugs found, root cause, fix applied)
└── global-insights.md      Cross-session platform engineering patterns
```

### Structure Rationale

- **`src/lib/agents/dev/` subdirectory:** Keeps Monty agents namespaced away from Nova while sharing the same parent directory. Same import depth, no circular dependencies.
- **`scripts/dev-cli/` namespace:** Monty's tools touch different surfaces than Nova's. Separate directory prevents tool pollution — Monty's toolset cannot accidentally include Nova's EmailBison tools and vice versa.
- **`.monty/memory/` root:** Parallel to `.nova/memory/` but project-scoped rather than workspace-scoped. No `{slug}/` subdirectories needed — dev work is codebase-wide. Topic-based files (backlog, decisions, incidents) capture what matters without per-specialist siloing.
- **`.claude/rules/dev-*.md` naming:** Consistent with the `loadRules()` pattern. `dev-` prefix prevents naming collision with Nova rules files.
- **`scripts/monty.ts` separate entry point:** No workspace picker needed. Monty works on the project, not on a specific client. This also makes the two CLIs clearly different products for different audiences.

---

## Architectural Patterns

### Pattern 1: Same Runner, Different Memory Root

**What:** Both Nova and Monty call `runAgent()` from `runner.ts` unchanged. The only infrastructure change is adding an optional `memoryRoot` parameter to `loadMemoryContext()` in `memory.ts`. Monty agents pass `".monty/memory"`. Nova agents continue to pass nothing (default is `".nova/memory"`).

**When to use:** Always — this is the core integration approach. It preserves the single execution path and audit trail while giving Monty its own persistent context.

**Trade-offs:** One small change to shared infrastructure (`memory.ts`). Backwards-compatible — all existing Nova calls continue working with no code changes.

**Implementation:**
```typescript
// memory.ts — extend signature, keep default
export async function loadMemoryContext(
  workspaceSlug?: string,
  memoryRoot: string = ".nova/memory",
): Promise<string> { ... }

// runner.ts — thread the new option through
const memoryContext = await loadMemoryContext(
  options?.workspaceSlug,
  options?.memoryRoot,     // new option key, undefined = Nova default
);

// Monty specialist config
const backendConfig: AgentConfig = {
  name: "dev-backend",
  model: NOVA_MODEL,
  systemPrompt: ...,
  tools: backendTools,
};

// Monty call site (dev-orchestrator.ts)
await runAgent(backendConfig, task, {
  memoryRoot: ".monty/memory",
  triggeredBy: "monty-cli",
});
```

### Pattern 2: Boundary Enforcement via Tool Namespace Separation

**What:** Nova's orchestrator only has workspace-scoped tools (`delegateToResearch`, `delegateToLeads`, etc., plus dashboard tools querying workspace data). Monty's orchestrator only has dev-scoped tools (`delegateToBackend`, `delegateToFrontend`, etc., plus dev dashboard tools for git/build state). Neither orchestrator can call the other's tools — this is enforced at the TypeScript type level.

**When to use:** Always — this makes the Nova/Monty boundary structural rather than instructional. A prompt can be overridden. A missing function cannot.

**Implementation:**
```typescript
// dev-orchestrator.ts — Monty toolset has zero overlap with Nova
export const montyTools = {
  delegateToBackend,
  delegateToFrontend,
  delegateToInfra,
  delegateToQA,
  delegateToSecurity,
  // Dev-specific dashboard tools only:
  getGitStatus,
  getBacklog,
  getDeployStatus,
  // NOT present: clientSweep, delegateToLeads, getCampaigns, etc.
};
```

### Pattern 3: PM Triage via System Prompt (Monty Orchestrator as PM)

**What:** Monty's orchestrator system prompt gives it PM-level triage logic: classify incoming requests as Bug (regression, broken feature, error), Feature (new capability), Debt (cleanup, refactor), or Security (auth, credential handling). Route accordingly to the right specialist(s). Bugs go to QA first (reproduce), then Backend or Frontend (fix). Features route directly to the responsible specialist.

**When to use:** Always — the orchestrator IS the PM for dev work. This is consistent with how Nova's `campaign-rules.md` defines orchestrator routing behaviour for campaign work.

**Rules file excerpt for dev-orchestrator-rules.md:**
```markdown
## Triage Decision Tree

STEP 1: Classify the request:
- "broken", "error", "not working", "fails", "422", "500", "regression" → Bug
- New page, new endpoint, new feature, "add", "build", "create" → Feature
- "slow", "refactor", "cleanup", "tech debt", "unused" → Debt
- "auth", "credential", "secret", "OWASP", "vulnerability", "exposure" → Security

STEP 2: Route:
- Bug → delegateToQA (reproduce + confirm) → then delegateToBackend or delegateToFrontend (fix)
- Feature → delegateToFrontend (UI work) or delegateToBackend (API work) or both sequentially
- Infrastructure ("deploy", "Railway", "Vercel", "Trigger.dev", "DNS") → delegateToInfra
- Debt → delegateToBackend or delegateToFrontend depending on location
- Security → delegateToSecurity always, regardless of other routing
- After any fix: delegateToQA to validate

STEP 3: Update backlog:
- Write completed work to .monty/memory/incidents.md (bugs) or decisions.md (features/design)
```

### Pattern 4: Dev CLI Tools as Thin Shell Wrappers

**What:** Monty's `scripts/dev-cli/*.ts` tools are thin TypeScript wrappers around shell commands (`git`, `npx tsx`, `tsc`, `vercel`, `railway`) — the same pattern as Nova's `scripts/cli/*.ts` wrapping `node dist/cli/...` invocations. The specialists call these via a dev equivalent of `cliSpawn`.

**When to use:** Any time Monty needs to read codebase state (git log, file read, build check) or trigger operations (run tests, check deploy status).

**Trade-offs:** Agents remain isolated from direct Node.js API calls. All operations are named and observable in the AgentRun audit trail. Safety: dev-cli tools are read-heavy by default; write operations (file edits, deploys) are explicit tools that specialists must call consciously.

---

## Data Flow

### Bug Fix Request Flow

```
User: "The EmailBison webhook is returning 422"
    ↓
scripts/monty.ts (Monty CLI REPL)
    ↓
dev-orchestrator.ts
  classifies: Bug (422 error)
  routes: QA first
    ↓
delegateToQA
  reads route handler file, identifies validation mismatch
  returns: reproduction steps + root cause hypothesis
    ↓
delegateToBackend
  reads route handler, proposes fix with updated TypeScript
  writes fix summary to .monty/memory/incidents.md
    ↓
delegateToQA
  validates: does fix handle the edge case? any test coverage gaps?
    ↓
Monty CLI: "Here's the fix. Review and commit when ready."
User commits independently.
```

### Feature Request Flow

```
User: "Add a Monty radar health dashboard page"
    ↓
scripts/monty.ts
    ↓
dev-orchestrator.ts
  classifies: Feature (new page)
  routes: Frontend + Backend sequentially
    ↓
delegateToFrontend
  reads design system conventions, existing page patterns
  proposes TSX component + page structure
    ↓
delegateToBackend
  proposes API route + Prisma query for radar health data
    ↓
delegateToQA
  reviews both: are the types consistent? Any missing error states?
    ↓
Monty writes to .monty/memory/decisions.md: "Radar health page pattern used"
User reviews output, commits.
```

### Nova/Monty Handoff at Domain Boundary

```
User in Nova chat: "Fix the webhook bug AND push the 1210 campaign"
    ↓
Nova Orchestrator:
  Detects "fix the webhook bug" = codebase change request
  Nova responds: "Codebase changes belong to Monty (npm run monty).
  I'll handle the 1210 campaign push now."
    ↓ (campaign work proceeds through Nova specialists as normal)
User switches to Monty CLI for the bug fix.
```

**Enforcement:** Nova's rules file includes: "If the user asks to edit code, fix a bug, or modify any file in the codebase, respond: 'Codebase work belongs to Monty — run npm run monty.' Do not attempt code changes." Monty's rules file includes: "If the user asks about a workspace slug, client campaign, or live client data, respond: 'Campaign work belongs to Nova — run npm run chat.' Do not query workspace data."

---

## Component Boundaries: Shared vs Separate

### Shared Infrastructure (zero or minimal changes)

| Component | Change Required | Why |
|-----------|----------------|-----|
| `runner.ts` — `runAgent()` | No code change | Monty calls same function with new option key |
| `memory.ts` — `loadMemoryContext()` | Add `memoryRoot` optional param (default `.nova/memory`) | One line change, fully backwards-compatible |
| `memory.ts` — `appendToMemory()` | Add `memoryRoot` optional param | Same change, same approach |
| `types.ts` — `AgentConfig` interface | No change | Monty specialist configs implement the same interface |
| `types.ts` — `AgentRunResult` | No change | Same audit trail type — all Monty runs appear in `AgentRun` DB table |
| `load-rules.ts` — `loadRules()` | No change | Loads `dev-*.md` files using the same resolver |
| `prisma.agentRun` table | No schema change | `agent` field distinguishes Monty runs (`"dev-backend"`, `"dev-qa"`, etc.) |

### Separate Additions (new, no impact on Nova)

| Component | Why Separate |
|-----------|-------------|
| `dev/dev-orchestrator.ts` | Different tool namespace — dev tools only, zero workspace tools |
| `dev/{backend,frontend,infra,qa,security}.ts` | Different specialisations, no functional overlap with Nova specialists |
| `scripts/monty.ts` | No workspace picker — Monty is project-scoped |
| `scripts/dev-cli/*.ts` | Different surfaces — git/build/filesystem vs EmailBison/discovery APIs |
| `.monty/memory/` | Different namespace — project-scoped, topic-based (not workspace-slug-based) |
| `.claude/rules/dev-*.md` | Dev-specific behaviour rules, separate from Nova campaign rules |

---

## Build Order (Dependency-Aware)

Each phase is unblocked by the previous. Phases within a tier can be built in parallel.

| Phase | Tier | Components | Dependencies |
|-------|------|------------|-------------|
| 1 | Foundation | `memory.ts` extension — add `memoryRoot` param (one change, backwards-compatible) | None |
| 2 | Foundation | `.monty/memory/` directory + seed files (backlog.md, architecture.md, decisions.md, incidents.md, global-insights.md) | None |
| 3 | Foundation | `.claude/rules/dev-*.md` — 6 rules files (orchestrator, backend, frontend, infra, qa, security) | None |
| 4 | Foundation | `scripts/dev-cli/*.ts` — 9 thin tool wrappers | Phases 2+3 (tools reference memory files and follow rules conventions) |
| 5 | Specialists | `dev/dev-types.ts` — DevTaskInput, BugReport, FeatureRequest, DevOutput types | Phase 1 |
| 6 | Specialists | `dev/backend.ts` specialist config + tools + onComplete | Phases 1+3+4+5 |
| 7 | Specialists | `dev/frontend.ts` specialist | Phases 1+3+4+5 |
| 8 | Specialists | `dev/infra.ts` specialist | Phases 1+3+4+5 |
| 9 | Specialists | `dev/security.ts` specialist | Phases 1+3+4+5 |
| 10 | Specialists | `dev/qa.ts` specialist — reviews output of 6+7+8+9 | Phases 6+7+8+9 (QA validates their work) |
| 11 | Orchestrator | `dev/dev-orchestrator.ts` — imports all specialist `runXxxAgent()` exports | Phases 6-10 |
| 12 | Entry Point | `scripts/monty.ts` CLI REPL | Phase 11 |

**Why this order:** Rules files and memory structure are pure content — no code dependencies, build immediately. CLI tools are standalone scripts the specialists invoke — build before specialists. Specialists come before the orchestrator because the orchestrator imports them directly (same pattern as `orchestrator.ts` importing `runLeadsAgent`, `runWriterAgent`, etc.). QA comes after the other specialists because it reviews their output. The CLI entry point is last because it wraps the orchestrator.

---

## Integration Points with Existing Framework

### What the Existing `orchestrator.ts` Reveals About the Pattern

Reading `orchestrator.ts` directly shows the exact pattern Monty must follow:

1. Each `delegateToXxx` tool creates a typed input, calls `runXxxAgent()`, returns a typed summary
2. The orchestrator has both delegation tools AND direct dashboard tools for simple queries
3. CLI mode (`isCliMode()`) vs API mode routing is handled inside each delegation tool
4. `orchestratorTools` is the combined export consumed by both `scripts/chat.ts` and the dashboard chat route

Monty follows this same pattern: `montyTools` exported from `dev/dev-orchestrator.ts`, consumed by `scripts/monty.ts`.

### What `runner.ts` Reveals

`runner.ts` does five things: create AgentRun record, load memory context, call `generateText`, extract tool steps, fire `onComplete`. Monty reuses all five. The only change is that `loadMemoryContext(options?.workspaceSlug, options?.memoryRoot)` is called with the Monty memory root.

### What `scripts/chat.ts` Reveals About the CLI Pattern

`scripts/chat.ts` shows exactly what `scripts/monty.ts` needs:
- Load `.env` files
- Import orchestrator config and tools
- REPL loop with readline
- Session persistence to `AgentRun` on exit
- Memory context injection into system prompt per turn

The key difference for `monty.ts`: no workspace picker. Monty receives `--workspace` as an optional flag if context is needed, but defaults to project-wide scope.

### How AgentRun Audit Trail Works for Monty

All Monty runs appear in the same `AgentRun` Prisma table. They are distinguishable by:
- `agent` field: `"dev-backend"`, `"dev-frontend"`, `"dev-qa"`, etc.
- `workspaceSlug` field: `null` for most Monty runs (project-scoped), or a slug if debugging a workspace-specific bug
- `triggeredBy` field: `"monty-cli"`

This means Monty runs appear in the existing admin dashboard's agent monitoring UI without any schema changes.

---

## Anti-Patterns

### Anti-Pattern 1: Adding Dev Tools to Nova's Orchestrator

**What people do:** Add `git status` or file-edit tools to `orchestratorTools` in `orchestrator.ts` so Nova can "also fix bugs while doing campaign work."

**Why it's wrong:** Destroys the boundary. Nova receives a dev request, attempts a file edit, and corrupts workspace work. The AgentRun audit trail mixes campaign and dev work, making monitoring useless. More critically: Nova's memory context is workspace-scoped, so a dev task would write to the wrong memory namespace.

**Do this instead:** Two separate CLIs, two separate orchestrators, two separate tool namespaces. If the user wants both, they use both CLIs sequentially. The boundary is a feature, not a limitation.

### Anti-Pattern 2: Copying `runner.ts` into `dev/dev-runner.ts`

**What people do:** Fork `runner.ts` into `dev/dev-runner.ts` to avoid touching existing code, producing two maintenance surfaces.

**Why it's wrong:** The runner is pure infrastructure — it contains no Nova-specific logic. Memory loading, audit trail, onComplete hooks — all of these should be consistent across Nova and Monty. Drift between two runners causes silent bugs (e.g., Monty runs not appearing in the admin dashboard's AgentRun view).

**Do this instead:** Parameterise the single `runner.ts`. One code path for all agents. The `memoryRoot` option is the only Monty-specific addition.

### Anti-Pattern 3: Per-Specialist Memory Files Instead of Project-Scoped Files

**What people do:** Create `.monty/memory/backend/`, `.monty/memory/frontend/`, etc., mirroring Nova's per-workspace structure.

**Why it's wrong:** Dev agents do not have different persistent contexts per specialist. A backend agent's decision about API design is relevant context for the QA agent reviewing that API. Siloing by specialist creates artificial barriers to shared context.

**Do this instead:** Flat `.monty/memory/` files by topic (backlog, decisions, incidents, architecture). All dev agents read and write to the same namespace — they coordinate through shared context, just like how Nova agents for different tasks all read the same `.nova/memory/{slug}/` files.

### Anti-Pattern 4: Monty Reading Live Workspace Data

**What people do:** Add a Prisma query tool to Monty's orchestrator so it can look up client workspace data when fixing workspace-related bugs (e.g., "fix the Rise webhook" — Monty queries the Rise workspace to understand the bug).

**Why it's wrong:** Couples dev and campaign concerns. Monty should fix the code path, not the client data state. A Monty bug that corrupts a DB query could silently damage client data.

**Do this instead:** Monty reads the codebase (schema files, route handlers, test fixtures) to understand the data model. If live data is needed for debugging, the PM (user) fetches it from Nova and pastes it into the Monty conversation as context.

### Anti-Pattern 5: Monty Committing Code Without User Review

**What people do:** Give Monty a `git commit` tool so it can automatically commit its fixes.

**Why it's wrong:** Code changes need human review. Monty proposes the fix; the user decides whether to commit it. Automating commits removes the review gate that catches hallucinations or incorrect fixes.

**Do this instead:** Monty writes file changes to temp locations or proposes diffs. User reviews and uses standard `git add + git commit` workflow. Monty can have a `git-status.ts` and `git-diff.ts` tool to read current state but no write tools for git history.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (1 engineer, 10 clients) | Single Monty CLI, project-scoped memory. No scaling concerns. |
| 2-3 engineers | Same Monty CLI. `.monty/memory/` files become shared context between engineers' sessions. |
| Team growth (5+ engineers) | `.monty/memory/` files may need migration to a DB-backed store to handle concurrent writes. Backlog specifically should move to a structured format. |

---

## Sources

- Direct inspection: `src/lib/agents/runner.ts` — shared execution engine
- Direct inspection: `src/lib/agents/orchestrator.ts` — Nova orchestrator pattern (delegation tools, dashboard tools, combined export)
- Direct inspection: `src/lib/agents/memory.ts` — 3-layer memory system, namespace conventions
- Direct inspection: `src/lib/agents/types.ts` — AgentConfig interface
- Direct inspection: `src/lib/agents/load-rules.ts` — rules file resolver
- Direct inspection: `scripts/chat.ts` — established CLI REPL pattern
- Direct inspection: `scripts/cli/` — 55 Nova CLI tools, namespace established
- Direct inspection: `.claude/rules/` — 12 existing rules files, naming conventions
- Direct inspection: `.nova/memory/` — workspace-scoped memory structure
- Project context: `.planning/PROJECT.md` — v9.0 milestone requirements (Monty)

---
*Architecture research for: v9.0 Monty Dev Orchestrator — integration with Nova agent framework*
*Researched: 2026-04-02*
