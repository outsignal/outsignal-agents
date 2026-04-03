# Stack Research

**Domain:** Dev Orchestrator ("Monty") — platform engineering agent team with 5 specialist agents
**Researched:** 2026-04-02
**Confidence:** HIGH for existing framework reuse (verified against live codebase); MEDIUM for agent boundary design (community patterns + official docs); LOW for items flagged below

---

## Context: v9.0 Milestone Scope

This STACK.md answers only what changes/adds for the Dev Orchestrator (Monty) milestone. The base stack is unchanged and does not need re-researching:

**Existing stack that carries forward unchanged:**
- Next.js 16.1.6, Prisma 6.19.2, PostgreSQL (Neon), Vercel, Railway
- AI SDK: `ai@6.0.97`, `@ai-sdk/anthropic@3.0.46`
- Agent framework: `runAgent()` in `src/lib/agents/runner.ts`, `AgentConfig` types, `loadMemoryContext()`, `onComplete` hooks, `AgentRun` DB audit trail
- tsup build pipeline for CLI wrapper scripts (`scripts/cli/`)
- Claude Code skill files (`.claude/skills/`), rules files (`.claude/rules/`)
- Nova memory namespace: `.nova/memory/{slug}/`
- Vitest for unit tests (already installed as dev dependency)

**What v9.0 adds:**
- A second agent team (Monty) alongside Nova, with a strict domain boundary
- Dev-focused tools (static analysis, security scanning, git operations, deploy management)
- A codebase-scoped memory namespace (`.monty/memory/`) separate from Nova's workspace-scoped namespace
- Bug vs. feature triage workflow built into the orchestrator
- Specialist agents with different tool profiles from Nova specialists

---

## Recommended Stack

### Core Technologies (No New npm Packages Required)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `ai` (Vercel AI SDK) | 6.0.97 | Agent execution via `generateText` | Already used for all 7 Nova agents. `runAgent()` in runner.ts already handles audit, memory injection, onComplete hooks — reuse verbatim for Monty agents |
| `@ai-sdk/anthropic` | 3.0.46 | Claude model access | Same model provider. Monty orchestrator uses Sonnet 4.5 (fast routing); Backend/Security specialists use Opus 4.6 for deep analysis |
| `zod` | 4.3.6 | Input/output schema validation | Already used for all agent output schemas. Monty agent outputs follow same pattern (`MontyOutput`, `BackendAgentOutput`, etc.) |
| `tsup` | 8.5.1 | CLI wrapper build pipeline | Already used. Dev agent tools (git wrappers, static analysis runners) built as tsup-compiled CLI scripts in `scripts/cli/` |
| `tsx` | 4.21.0 | Run TypeScript CLI scripts directly | Already used for all 55 existing scripts |
| `vitest` | 4.0.18 | QA agent test execution and reporting | Already installed. QA agent calls `npx vitest run --reporter=json` and parses output |

**Confidence: HIGH** — verified against `package.json` in live codebase. Zero new npm packages are required.

### Agent Models by Specialist

| Agent | Model | Rationale |
|-------|-------|-----------|
| Monty Orchestrator (PM) | `claude-sonnet-4-20250514` | Routes tasks, triages bugs vs features, manages backlog — needs fast responses, not deep reasoning |
| Backend Agent | `claude-opus-4-6` | Complex Prisma schema changes, API design, Trigger.dev task architecture — needs full reasoning depth |
| Frontend/UI Agent | `claude-sonnet-4-20250514` | Component work + UI UX Pro Max skill is prescriptive — Sonnet sufficient |
| Infrastructure Agent | `claude-sonnet-4-20250514` | Deploys and config changes — procedural, well-defined steps |
| QA Agent | `claude-opus-4-6` | Interpreting test failures, recommending test strategy, spotting edge cases — needs reasoning |
| Security Agent | `claude-opus-4-6` | OWASP analysis, auth flow review, vulnerability assessment — needs reasoning depth |

**Confidence: HIGH** — model naming verified against live `types.ts` NOVA_MODEL constant and Anthropic API docs.

### Dev Agent Tools (New CLI Scripts to Build)

These are new `scripts/cli/` wrapper scripts that Monty's specialist agents invoke. They follow the identical pattern as the existing 55 Nova CLI scripts: TypeScript file, compiled by tsup, callable via `node dist/cli/[name].js`.

| CLI Script | Purpose | Agent |
|------------|---------|-------|
| `git-status.ts` | Run `git status --porcelain`, return structured diff summary | Backend, QA |
| `git-diff.ts` | Run `git diff [--staged]`, return patch for agent review | Backend, QA, Security |
| `git-log.ts` | Recent commit log with author, message, date | All |
| `run-tests.ts` | Execute `npx vitest run --reporter=json`, parse result, return pass/fail counts + failing test names | QA |
| `run-lint.ts` | Execute `npx eslint src/ --format json`, parse violations, return structured list | QA, Security |
| `npm-audit.ts` | Execute `npm audit --json`, parse CVE report, return severity buckets | Security |
| `check-types.ts` | Execute `npx tsc --noEmit --pretty false`, parse errors, return structured list | Backend, QA |
| `read-file.ts` | Read file at given path, return content (respects `.claudeignore`) | All |
| `list-files.ts` | List files in directory with metadata (size, modified date) | All |
| `search-code.ts` | Run ripgrep search across codebase, return matches with context lines | All |
| `deploy-status.ts` | Call Vercel API for latest deployment status | Infrastructure |
| `trigger-tasks.ts` | List active Trigger.dev tasks and their last run status | Infrastructure |
| `backlog-create.ts` | Create a new backlog item (stored in `.monty/backlog.json`) | Orchestrator |
| `backlog-list.ts` | List open backlog items with priority and routing | Orchestrator |
| `backlog-update.ts` | Update backlog item status (open/in-progress/done) | Orchestrator |

**Confidence: HIGH for approach** (identical pattern to Nova's 55 scripts). **MEDIUM for specific list** (will need refinement during implementation phases).

### Security Scanning Approach

The Security Agent is an LLM judge, not an automated scanner. It reads code, applies OWASP Top 10 reasoning, and flags issues with specific line references. Supporting tools provide raw data:

| Tool | How Used | Notes |
|------|---------|-------|
| `npm audit` | `npm-audit.ts` CLI script feeds structured CVE data to Security Agent | Already in Node.js — no install needed |
| ESLint `eslint-plugin-security` | Added to ESLint config; `run-lint.ts` outputs security rule violations | Install as dev dep — lightweight |
| TypeScript strict mode | Already enabled; `check-types.ts` catches type-unsafe patterns | No new tooling |
| `CLAUDE.md`-style OWASP skill | Security agent `.claude/rules/security-rules.md` encodes OWASP Top 10:2025 + ASVS 5.0 checks for this codebase | No tooling — prompt engineering |

**What NOT to use:** Semgrep, Snyk, SonarQube, or other standalone SAST tools. These require separate processes, accounts, or pipelines. The Security Agent LLM-as-judge approach with npm audit + ESLint security rules is sufficient for this codebase size (146k LOC). Semgrep could be added if false-negative rate from LLM review proves too high — flag for phase-specific research.

**Confidence: MEDIUM** — LLM-as-judge for security review is an emerging pattern. The OWASP Claude Code skill (agamm/claude-code-owasp, 17k+ char skill) confirms this is the community-recommended approach as of Q1 2026. ESLint security plugin effectiveness for injection/OWASP patterns is MEDIUM (ESLint alone is not a security tool per 2026 community consensus, but combined with LLM review it covers the gap).

### Memory Architecture for Monty

Nova uses workspace-scoped memory (`.nova/memory/{slug}/`). Monty uses codebase-scoped memory with no workspace dimension.

```
.monty/
  memory/
    codebase.md       — Architecture decisions, known debt, module boundaries
    incidents.md      — Bug history, root causes, patterns
    decisions.md      — Tech decisions made (what and why), with dates
    security.md       — Past security findings, resolved vulns, ongoing concerns
    backlog.json      — Structured bug/feature backlog (JSON for programmatic access)
```

The same `loadMemoryContext()` function in `memory.ts` is reusable — just point it at `.monty/memory/` instead of `.nova/memory/{slug}/`. No code changes needed beyond a config flag or a new exported function `loadMontyMemoryContext()`.

**Governance:** Same 200-line cap per file. Same `appendToMemory()` pattern for writes from `onComplete` hooks.

**Confidence: HIGH** — directly mirrors existing Nova memory implementation in `src/lib/agents/memory.ts`.

### Bug vs Feature Triage Workflow

The Monty Orchestrator PM role handles triage. This is implemented as a decision tree in `monty-orchestrator-rules.md` (the equivalent of `campaign-rules.md` for Nova), not as new code.

**Triage logic (encoded in rules, not code):**

```
Input: user reports something to Monty

IF "it was working before" OR "broken" OR "error" OR "500" OR "crash" → classify as BUG
  → Severity: critical (production down) / high (feature broken) / low (cosmetic)
  → Route: Backend Agent (API/DB), Frontend Agent (UI), Infrastructure (deploy/env), QA (test coverage gap)
  → Add to backlog as BUG type

IF "new feature" OR "add" OR "build" OR "create" → classify as FEATURE REQUEST
  → Assess: does it touch DB schema? (Backend), UI? (Frontend), external service? (Infrastructure)
  → Route to correct specialist or split across multiple
  → Add to backlog as FEATURE type

IF "security" OR "vulnerability" OR "auth" OR "credential" → classify as SECURITY REVIEW
  → Always route to Security Agent first
  → Security Agent may then spawn Backend Agent for fixes

IF "test" OR "coverage" OR "review" → classify as QA TASK
  → Route to QA Agent
```

The backlog is stored in `.monty/memory/backlog.json` and managed via `backlog-create.ts` / `backlog-list.ts` / `backlog-update.ts` CLI scripts.

**Confidence: HIGH for approach** — matches delegation-rules.md pattern from Nova. The routing logic is rule-encoded in a markdown rules file, same as Nova's 7 specialist rule files.

### How Monty Differs from Nova Agents

Nova agents operate on **workspace/client data** (leads, campaigns, copy, deliverability). Monty agents operate on **the codebase itself**. Key architectural differences:

| Dimension | Nova Agents | Monty Agents |
|-----------|-------------|--------------|
| Memory scope | Per-workspace slug (`.nova/memory/{slug}/`) | Per-codebase (`.monty/memory/`) |
| Tool type | DB queries, external API calls | File reads, git commands, test runners, linters |
| Output format | Structured campaign/lead data | Diffs, test reports, security findings, deploy status |
| Invocation | Via chat interface (Cmd+J) or Trigger.dev | Via Claude Code CLI (Cmd+K / `/monty:*` commands) |
| State | `workspaceSlug` passed in options | No slug — codebase is the implicit scope |
| Memory writes | Per-client learnings, feedback, campaigns | Codebase decisions, incidents, security findings |
| Primary model | Opus 4.6 for writers/leads, Haiku for cheap tasks | Sonnet for orchestrator/frontend/infra, Opus for backend/QA/security |

**Boundary enforcement (non-negotiable rule in both orchestrators):**

- User says "workspace slug" or "campaign" → Nova Orchestrator
- User says "code", "bug", "deploy", "test", "security" → Monty Orchestrator
- The two orchestrators NEVER cross-delegate. Monty cannot call Nova tools. Nova cannot call git/test tools.

This is enforced in `delegation-rules.md` (the PM-level rules file) which governs which orchestrator handles which input.

### Claude Code Skill Files for Monty

Same structure as Nova's `.claude/skills/` files. These are markdown files that activate as Claude Code skills via Cmd+K:

| Skill File | Activates When |
|------------|---------------|
| `.claude/skills/monty.md` | `/monty` — orchestrator, triage, backlog management |
| `.claude/skills/monty-backend.md` | `/monty:backend` — API routes, Prisma, Trigger.dev |
| `.claude/skills/monty-frontend.md` | `/monty:frontend` — components, pages, design system |
| `.claude/skills/monty-infra.md` | `/monty:infra` — Vercel, Railway, Trigger.dev deploys, DNS |
| `.claude/skills/monty-qa.md` | `/monty:qa` — tests, code review, coverage |
| `.claude/skills/monty-security.md` | `/monty:security` — auth flows, credentials, OWASP, vulns |

### Rules Files for Monty

One rules file per specialist, following the exact structure of Nova's 7 rules files:

| Rules File | Governs |
|------------|---------|
| `.claude/rules/monty-orchestrator-rules.md` | Triage logic, routing decision tree, backlog management, boundary enforcement |
| `.claude/rules/backend-rules.md` | Prisma schema change protocol (db push vs migrate), API route conventions, Trigger.dev task patterns, error handling standards |
| `.claude/rules/frontend-rules.md` | Component conventions, UI UX Pro Max integration, shadcn/radix usage, Tailwind v4 patterns, Next.js 16 App Router conventions |
| `.claude/rules/infra-rules.md` | Vercel deploy process, Railway CLI ops, Trigger.dev deploy command, env var management (printf not echo), DNS registrar reference |
| `.claude/rules/qa-rules.md` | Vitest patterns, what to test (service layer not Server Actions directly), transaction-based test isolation, coverage thresholds |
| `.claude/rules/security-rules.md` | OWASP Top 10:2025, ASVS 5.0, Next.js-specific security (dangerouslySetInnerHTML, CSP, auth patterns), credential handling, timing-safe comparison |

### ESLint Security Plugin (Only New npm Dependency)

```bash
npm install -D eslint-plugin-security
```

Add to `eslint.config.mjs`:
```js
import security from 'eslint-plugin-security'
// Add to plugins and rules
```

This is the one recommended new dev dependency. It adds ~15 security rules (no eval, no unsafe regex, detect object injection, etc.) that the Security Agent can reference via `run-lint.ts` output.

**Confidence: MEDIUM** — `eslint-plugin-security` is widely used (2M+ weekly downloads, active maintenance). However, per 2026 community consensus, ESLint security rules alone do not constitute a security review — they surface obvious issues for the LLM Security Agent to investigate further.

---

## Installation

```bash
# Only new dependency (dev)
npm install -D eslint-plugin-security
```

No other new packages. All Monty infrastructure reuses existing dependencies.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| LLM-as-judge Security Agent + ESLint security + npm audit | Semgrep, Snyk, SonarQube | Requires separate accounts, CI pipeline integration, or paid plans. Adds operational overhead. LLM review is already in the project (all 7 Nova agents use Claude Opus). ESLint + npm audit cover the mechanical checks; LLM handles reasoning. |
| `.monty/memory/` flat-file memory (same as Nova) | SQLite persistent memory (Claude Flow approach) | Nova's flat-file memory already works and is validated in production (Rise workspace, agent memory system Phase 59-61). SQLite adds a dependency and migration concern. Flat files are simpler, human-readable, and sufficient for one codebase. |
| `runAgent()` reuse (same runner for Monty) | Separate runner implementation | `runner.ts` is agent-agnostic — takes AgentConfig, not Nova-specific config. Monty agents just pass different config objects. No duplication needed. |
| Claude Code skill files (`.claude/skills/`) | API-based agent invocation | Project already uses Claude Code Max Plan to avoid Anthropic API costs. Skill files are the correct deployment for Claude Code CLI usage. Consistent with Nova's 8 skill files. |
| Monty as PM-only orchestrator (no direct tool calls) | Monty as a working agent (also writes code) | Nova's orchestrator delegates to specialists — it never writes copy itself. Same boundary for Monty: PM role means triage + route, not implement. Specialists own their domains. Prevents context bleed between PM oversight and specialist depth. |
| Backlog as `.monty/memory/backlog.json` | Prisma-based BacklogItem model | JSON file is human-readable, instantly editable, no DB migration needed. Backlog is lightweight (10-50 items max). If it grows complex, migrate to Prisma later. |
| Two-team boundary (Monty vs Nova) with no cross-delegation | Single orchestrator routing to 12 total specialists | Two orchestrators preserve cognitive clarity — Nova's PM already knows all 10 workspaces and 7 specialists. Adding 5 dev specialists makes the PM too broad. Separate PM role for platform engineering is cleaner and matches real org structure. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Semgrep / Snyk / SonarQube for security scanning | External tools require separate auth, paid plans, or pipeline setup. Over-engineered for a team running one codebase with LLM-based review already in place | LLM Security Agent (Opus 4.6) + `eslint-plugin-security` + `npm audit` |
| `git commit` or `git push` from agent tools | Agents should NEVER commit or push autonomously — this is a trust boundary and a safety rule. Monty reads git state, recommends changes, writes files — human commits | Read-only git tools only: `git-status.ts`, `git-diff.ts`, `git-log.ts` |
| Separate memory store (SQLite, Redis, vector DB) for Monty | Adds ops complexity, another dependency. The project already uses Neon PostgreSQL — if vector search is needed, pgvector is the right add, not a separate store | Flat-file `.monty/memory/*.md` (same pattern as Nova) |
| Haiku model for Backend/QA/Security agents | Too weak for codebase analysis. Haiku is used in Nova for cheap classification tasks (reply intent, body elements). Security review and Prisma schema analysis require full reasoning | Opus 4.6 for Backend, QA, Security agents |
| Separate `AgentRun` table for Monty | Would fragment the audit trail. The existing `AgentRun` table already has `agent` and `workspaceSlug` columns. Monty agents write `workspaceSlug: null` and a distinct `agent` name | Reuse existing `AgentRun` table, distinguish by `agent` field value |
| Testing Server Actions directly in Vitest | Community-established anti-pattern (2026 Next.js testing guidance): Server Actions are thin glue. Test the underlying service function instead | Service layer pattern: test pure TypeScript functions that the Server Actions call |
| `prismaMock` in-memory mocking for integration tests | Fine for unit tests, but Monty QA Agent should validate against real behavior. prismaMock doesn't catch constraint violations, cascade issues, or migration problems | `vitest-environment-prisma-postgres` pattern with transaction rollback for integration tests (MEDIUM confidence — verify before implementing) |

---

## Stack Patterns by Agent Role

**Backend Agent (API routes, Prisma, Trigger.dev):**
- Reads code via `read-file.ts`, `search-code.ts`
- Checks types via `check-types.ts` (tsc --noEmit)
- Uses `git-diff.ts` to understand what changed
- Proposes DB schema changes using existing `db push` protocol (NOT `migrate dev` — established in Key Decisions)
- Writes to `.monty/memory/decisions.md` via `appendToMontyMemory()` when architecture decisions are made

**Frontend/UI Agent:**
- Uses UI UX Pro Max skill (`.claude/skills/ui-ux-pro-max/`) — already installed
- Reads component files via `read-file.ts`
- References existing Tailwind v4, shadcn/radix patterns
- Writes directly to source files (no CLI abstraction needed — this is Claude Code native)
- Does NOT need `check-types.ts` unless prop types are in scope

**Infrastructure Agent:**
- Reads deploy state via `deploy-status.ts` (Vercel API) and `trigger-tasks.ts`
- Uses `list-files.ts` to audit env var references vs what's set
- Knows the full deploy command: `npx trigger.dev@latest deploy` (clean `.trigger/tmp/` first)
- Knows env var rule: `printf` not `echo` for Vercel env vars
- References `memory/infrastructure.md` as source of truth for all API/service config

**QA Agent:**
- Primary tool: `run-tests.ts` (vitest run --reporter=json)
- Secondary: `run-lint.ts` (eslint --format json), `check-types.ts`
- Reads existing test files via `read-file.ts`, `search-code.ts`
- Transaction-based isolation for any new integration tests (prevents test pollution)
- Writes findings to `.monty/memory/incidents.md` for bug history

**Security Agent:**
- Reads code via `read-file.ts`, `search-code.ts`
- Gets CVE data via `npm-audit.ts`
- Gets static issues via `run-lint.ts` (with security plugin active)
- Gets git context via `git-diff.ts` to review changes about to be deployed
- System prompt (security-rules.md) encodes OWASP Top 10:2025 + Next.js-specific patterns
- Writes findings to `.monty/memory/security.md`
- NEVER approves its own findings — surfaces them to the user for decision

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `ai@6.0.97` | `@ai-sdk/anthropic@3.0.46` | Currently in use, validated |
| `vitest@4.0.18` | `@testing-library/react@16.3.2` | Already in use |
| `eslint-plugin-security` | `eslint@9` | Confirm compatibility — eslint v9 uses flat config; plugin must support it. Check before installing. |
| `tsup@8.5.1` | `typescript@5` | Already in use for 55 CLI scripts |

**Confidence: HIGH for existing packages. LOW for eslint-plugin-security + ESLint v9 compatibility** — verify this in Phase 1 before building on it.

---

## Sources

- `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — Confirmed `runAgent()` is agent-agnostic, takes `AgentConfig`, reusable for Monty (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/memory.ts` — Confirmed `loadMemoryContext()` is path-configurable, `appendToMemory()` pattern reusable (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/types.ts` — Confirmed model names, `AgentConfig` interface (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/package.json` — Confirmed all existing dependencies and versions (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/.planning/PROJECT.md` — Confirmed v9.0 milestone goals, existing validated capabilities, Key Decisions (HIGH confidence)
- [Next.js Testing Guide (Vitest)](https://nextjs.org/docs/app/guides/testing/vitest) — Official vitest setup for Next.js (HIGH confidence)
- [Unit Testing Prisma with pgLite and Vitest](https://makerkit.dev/blog/tutorials/unit-testing-prisma-vitest) — Service layer pattern, transaction isolation (MEDIUM confidence)
- [eslint-plugin-security on npm](https://www.npmjs.com/package/eslint-plugin-security) — Plugin capabilities, ESLint v9 compatibility needs verification (MEDIUM confidence)
- [agamm/claude-code-owasp](https://github.com/agamm/claude-code-owasp) — LLM-as-judge OWASP security review approach, OWASP Top 10:2025 + ASVS 5.0 coverage (MEDIUM confidence)
- [Semgrep vs ESLint security 2026](https://dev.to/rahulxsingh/semgrep-vs-eslint-security-focused-sast-vs-javascript-linter-2026-hef) — ESLint alone is insufficient; LLM + ESLint recommended (MEDIUM confidence)
- [Claude Code Sub-agents docs](https://code.claude.com/docs/en/sub-agents) — Sub-agent memory architecture, persistent directory pattern (MEDIUM confidence)
- [Multi-agent orchestration for Claude Code 2026](https://shipyard.build/blog/claude-code-multi-agent/) — Two-team boundary pattern, PM-only orchestrator role (MEDIUM confidence)

---

*Stack research for: Outsignal Dev Orchestrator (Monty) — v9.0 Platform Engineering Agent Team*
*Researched: 2026-04-02*
