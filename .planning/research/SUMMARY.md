# Project Research Summary

**Project:** Outsignal Dev Orchestrator — Monty (v9.0 Platform Engineering Agent Team)
**Domain:** Autonomous coding agent team alongside an existing campaign agent team (Nova)
**Researched:** 2026-04-02
**Confidence:** HIGH — based on direct codebase inspection and first-party production evidence

## Executive Summary

Monty is a second AI agent team built to handle platform engineering work (bugs, features, deploys, security) using the same agent framework that powers Nova (campaign operations). The architectural approach is deliberately parallel: same runner, same types, same audit trail, separate tool namespaces, separate memory namespaces, separate CLI entry points. The core insight from research is that the boundary between Nova and Monty must be structural (enforced by which tools each team has) not instructional (enforced by rules files) — because rules files are prompts, and prompts are probabilistic. The 2026-04-02 Nova delegation bypass, where the PM spawned generic subagents to run CLI scripts directly and burned API credits, is the primary evidence that soft rules alone fail under task pressure.

The recommended approach is to build Monty lean: 4 agents (Orchestrator/PM, Dev generalist, QA adversarial reviewer, Security on-call) rather than 5+ specialists. Research and the existing codebase pattern both show that Frontend/Infrastructure specializations can be roles within a generalist agent's prompting rather than separate agents — adding specialists only when a distinct non-overlapping workload justifies the orchestration overhead. Zero new npm packages are required beyond `eslint-plugin-security` (one dev dependency), as all existing AI SDK, type, build, and test infrastructure carries forward unchanged.

The key risks are not technical — the stack is well-understood and validated in production. The risks are behavioral: agents crossing the Nova/Monty boundary under ambiguous tasks, dev agents producing destructive code that passes unit tests but misses race conditions, the PM bypassing Monty for "small" changes (the same pattern that burned Nova credits), and QA becoming a rubber stamp rather than adversarial review. All 10 identified pitfalls trace back to Phase 1 architecture decisions: tool surface definition, action tier model (read-only / reversible / gated), memory governance with size limits, and an explicit PM action scope. Getting Phase 1 right prevents every downstream pitfall.

## Key Findings

### Recommended Stack

Monty requires zero new infrastructure. The existing `runAgent()` in `runner.ts`, `loadMemoryContext()` in `memory.ts`, `AgentConfig` types, `AgentRun` audit table, and `tsup` CLI build pipeline all carry forward unchanged or with one-line additions. The only code change to shared infrastructure is adding an optional `memoryRoot` parameter to `loadMemoryContext()` (default `.nova/memory`, Monty passes `.monty/memory`).

**Core technologies:**
- `ai@6.0.97` + `@ai-sdk/anthropic@3.0.46`: Agent execution — already used for all 7 Nova agents, `runAgent()` is agent-agnostic
- `zod@4.3.6`: Output schema validation — Monty agent outputs follow same `AgentConfig` + output schema pattern as Nova
- `tsup@8.5.1` + `tsx@4.21.0`: CLI build pipeline — 9-15 new `scripts/dev-cli/*.ts` tool wrappers follow identical pattern to Nova's 55 scripts
- `vitest@4.0.18`: Test execution — QA Agent invokes `npx vitest run --reporter=json` and parses output
- `eslint-plugin-security` (new, dev only): Static security rules fed to Security Agent — only new npm package; ESLint v9 compatibility needs verification before depending on it

Model assignments: Sonnet for Orchestrator/Frontend/Infrastructure (fast routing, well-defined patterns); Opus 4.6 for Backend/QA/Security (deep reasoning, adversarial review, OWASP analysis).

### Expected Features

**Must have (table stakes):**
- Work triage (bug vs feature vs debt vs security) — orchestrator cannot route without classification
- Boundary enforcement (Monty vs Nova) — enforced by tool surface, not just rules files
- Persistent tech-debt memory (`.monty/memory/`) — decisions, incidents, backlog, architecture notes
- AgentRun audit trail — all Monty runs appear in existing `AgentRun` table with `agent` and `triggeredBy` fields
- Pre-approval gate — PM states exactly what will happen before any Tier 2+ operation executes
- Specialist delegation tools — `delegateToBackend`, `delegateToFrontend`, `delegateToInfra`, `delegateToQA`, `delegateToSecurity`

**Should have (differentiators):**
- Adversarial QA review (minimum 3 findings required per review, mandatory fail-finding framing)
- Action tier model (Tier 1: read-only autonomous; Tier 2: reversible supervised; Tier 3: gated by PM approval)
- Security Agent as deploy gate for auth/credential-touching changes
- Backlog management write-back to `.monty/memory/backlog.md`
- Codebase map awareness (file manifest injected into specialist system prompts)

**Defer (v2+):**
- Monty health endpoint for Monty Radar monitoring
- Cost reporting per session (tokens x model pricing surfaced in dashboard)
- Automated regression smoke tests post-deploy
- Cross-agent structured handoff protocol (structured feedback from QA back to Backend/Frontend for revision)

### Architecture Approach

Monty lives in `src/lib/agents/dev/` (parallel to existing Nova specialist files), with its own CLI entry point at `scripts/monty.ts` (no workspace picker — dev work is project-scoped), and a separate tool namespace at `scripts/dev-cli/` (git, file, test, deploy tools — zero overlap with Nova's `scripts/cli/` EmailBison/discovery tools). The `.monty/memory/` flat-file store mirrors `.nova/memory/` but is topic-based (backlog, decisions, incidents, architecture) rather than workspace-slug-based.

**Major components:**
1. `dev/dev-orchestrator.ts` — PM triage (PLATFORM/DATA/AMBIGUOUS classification), routing, backlog management; imports all specialist `runXxxAgent()` exports
2. `dev/{backend,frontend,infra,qa,security}.ts` — 4-5 specialist agents with distinct tool sets and memory write scopes
3. `scripts/dev-cli/*.ts` — 9-15 thin shell wrappers (git-status, git-diff, run-tests, check-types, npm-audit, deploy-status, etc.) — read-heavy by default, no git write tools
4. `.claude/rules/dev-*.md` — 6 rules files (orchestrator, backend, frontend, infra, QA, security) encoding triage logic, action tier model, and boundary definitions
5. `.monty/memory/` — 5 flat files with 2,000-token hard size limit per file, audit cadence at each phase boundary

### Critical Pitfalls

1. **Soft instructions don't enforce the boundary** — Rules files are prompts, prompts are probabilistic. The Nova bypass on 2026-04-02 proves this. Prevention: Monty agents have no campaign/discovery tools. Nova agents have no git/source-write tools. The boundary is defined by tool surface.

2. **Dev agents produce destructive code that passes tests** — Race conditions, null-guard removals, and cascade deletes often pass unit tests but corrupt production data. Prevention: Tier 3 action model (schema push, deploys, deletions) requires PM diff review before execution. QA Agent reviews all Backend output adversarially before any change lands.

3. **Boundary collapses on ambiguous tasks** — "Fix the bug where campaign creation fails" could be a code bug (Monty) or a workspace config issue (Nova). Prevention: Triage classification (PLATFORM/DATA/AMBIGUOUS) is an explicit orchestrator step before delegation. Ambiguous tasks get read-only investigation from both sides before any writing begins.

4. **Over-engineering with 5 specialists from day one** — Frontend+Backend tasks routinely require sequential multi-agent coordination, doubling wall time. Infrastructure and Security sit idle 90% of sessions. Prevention: Start with 4 agents. Specialize only when a distinct non-overlapping workload justifies the orchestration overhead.

5. **Credentials propagate through dev agent context** — Debugging env var issues naturally leads agents to read `.env`, outputting credentials into session logs and memory files. Prevention: `.claudeignore` blocks `.env.*`. `sanitize-output.ts` covers dev agent outputs. Agents check env var presence via grep count, never read or output values.

6. **PM bypasses Monty for "small" changes** — Identical violation pattern to the 2026-04-02 Nova bypass. Prevention: Explicit PM action scope written into delegation rules. PM can do read-only ops directly; all writes to `src/`, schema changes, `prisma db push`, and deploys must go through Monty.

7. **QA becomes a rubber stamp** — Without adversarial framing, QA defaults to agreeable summary of what Backend already claimed. Prevention: QA Agent system prompt explicitly frames the task as finding problems. Minimum 3 findings per review; explicit justification required if fewer.

## Implications for Roadmap

Based on combined research, every pitfall maps to Phase 1. The architecture decisions made in Phase 1 prevent all 10 documented pitfalls. The specialist agents are the easy part — they follow a well-validated pattern from Nova. Phase 1 is where the project can fail if rushed.

### Phase 1: Architecture Foundation
**Rationale:** All 10 pitfalls from PITFALLS.md trace back to Phase 1 decisions. Tool surface definition, action tier model, memory governance, PM scope, and triage classification must be established before any specialist agent is built. Building specialists first and adding guardrails later is the documented failure pattern for multi-agent systems.
**Delivers:** `.monty/memory/` directory with seed files; `.claude/rules/dev-*.md` (6 rules files including triage logic and tier model); extended `delegation-rules.md` with explicit PM action scope; `memory.ts` `memoryRoot` parameter (one-line change, backwards-compatible); tool inventory lists for each team with verified zero overlap; `.claudeignore` extended for dev agent sessions; `sanitize-output.ts` coverage extended to dev agent outputs
**Addresses:** Boundary enforcement, action tier model, memory governance, PM scope, credential protection, triage classification
**Avoids:** All 10 pitfalls (every pitfall-to-phase mapping in PITFALLS.md points to Phase 1)

### Phase 2: Dev CLI Tools
**Rationale:** Specialist agents cannot be built until their tool surface exists. CLI tools must come before specialists — same dependency order as Nova's 55 scripts before Nova specialists. This phase builds read-heavy tools only; deploy execution tools come in Phase 5 (Infrastructure).
**Delivers:** `scripts/dev-cli/*.ts` — git-status, git-diff, git-log, run-tests, check-types, run-lint, npm-audit, read-file, list-files, search-code, deploy-status, trigger-tasks, backlog CRUD (9-15 scripts compiled via tsup)
**Uses:** `tsup@8.5.1`, existing CLI build pattern — no new patterns to introduce
**Avoids:** Tool proliferation pitfall — tool budget of max 15 per specialist defined before tools are built; audit before each phase ships

### Phase 3: Monty Orchestrator + Dev Generalist Agent
**Rationale:** These two are the core of the system. The orchestrator handles triage and routing; the Dev Agent handles approximately 90% of implementation tasks. Both must exist before QA can review Dev output. The orchestrator is built before specialists because it defines the delegation interface the specialists plug into.
**Delivers:** `dev/dev-orchestrator.ts` with triage classification (PLATFORM/DATA/AMBIGUOUS) and delegation tools; `dev/backend.ts` as the primary generalist agent (Frontend scope folded in for v1 to avoid multi-agent coordination overhead); `scripts/monty.ts` CLI REPL entry point; backlog read/write tools wired
**Implements:** PM triage workflow, pre-approval gate, boundary enforcement, AgentRun audit trail (via shared `runner.ts`), memory context injection (via `memoryRoot: ".monty/memory"`)
**Avoids:** Over-engineering pitfall (generalist Dev Agent for v1, specialize only when workload justifies it)

### Phase 4: QA Agent (Adversarial)
**Rationale:** QA reviews Dev Agent output before any change is approved. Must come after the Dev Agent (nothing to review otherwise) but before Infrastructure/Security (QA gates their work too). The adversarial framing and mandatory-findings requirement must be designed into Phase 4 from the start, not retrofitted after a rubber-stamp failure is observed.
**Delivers:** `dev/qa.ts` with adversarial system prompt (find problems, not summarize correctness), mandatory 3+ findings per review, per-change-type checklists (schema change, new API route, function modification, deletion)
**Avoids:** QA rubber stamp pitfall — framing defined at design time, before the first review runs

### Phase 5: Infrastructure Agent
**Rationale:** Infrastructure work (Vercel env vars, Railway config, Trigger.dev deploys) is lower frequency than Backend/Frontend/QA but higher risk — irreversible production changes, no git rollback path for env var deletions. The Tier 3 infra operation protocol is designed in Phase 1 and implemented here.
**Delivers:** `dev/infra.ts` with Tier 3 infra operation protocol, inventory-before-delete enforcement, state snapshot mechanism (timestamped file before any deletion), deploy-status read tool, Trigger.dev task list read tool
**Avoids:** Infrastructure irreversible changes pitfall — Tier 3 gate fires before any deletion; state snapshot is the rollback reference

### Phase 6: Security Agent
**Rationale:** Security is on-call (approximately 10% of tasks) — a review gate, not a primary workhorse. Comes after Backend (Phase 3) and QA (Phase 4) because it reviews their output before infrastructure deploys. `eslint-plugin-security` ESLint v9 compatibility is the one LOW-confidence dependency; verify in Phase 2 before Phase 6 builds on it.
**Delivers:** `dev/security.ts` with OWASP Top 10:2025 + ASVS 5.0 system prompt, npm-audit and run-lint (security plugin) as input tools, findings written to `.monty/memory/security.md`; invoked by orchestrator on any task touching auth routes, credentials, user data, or API key management
**Avoids:** Security bypass pitfall — Security Agent is a structured gate, not an optional consultation

### Phase Ordering Rationale

- All 10 pitfalls map to Phase 1 — architecture must come before implementation
- CLI tools (Phase 2) must precede specialist agents (Phase 3+) — tools are the agent's capability surface
- Dev generalist (Phase 3) before QA (Phase 4) — QA reviews Dev output; Dev must produce output first
- QA (Phase 4) before Infrastructure (Phase 5) — QA gates changes before they reach the deploy stage
- Infrastructure (Phase 5) before Security (Phase 6) — Security reviews before deploy; Infrastructure is the deploy gate; Security needs a deploy pipeline to gate
- Start with 4 agents total — Orchestrator, Dev generalist, QA, Security; Infrastructure promoted from Dev scope to standalone agent in Phase 5 because deploy operations warrant a dedicated Tier 3-aware agent

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Dev Generalist):** The decision to merge Frontend+Backend into one generalist agent needs validation against real task patterns from the first 2-3 tasks. If multi-specialist coordination is consistently needed, split early.
- **Phase 6 (Security Agent):** `eslint-plugin-security` + ESLint v9 flat config compatibility is MEDIUM confidence — verify in Phase 2 tooling before Phase 6 depends on it. LLM-as-judge security false-negative rate is unmeasured for this codebase.

Phases with standard patterns (skip research-phase):
- **Phase 2 (CLI Tools):** Identical pattern to Nova's 55 existing scripts. Well-validated in production. No research needed — execute directly.
- **Phase 4 (QA Agent):** Nova's `validateSequence` adversarial validator (shipped Phase 59-61) established the adversarial review pattern. Apply directly to QA Agent design.
- **Phase 5 (Infrastructure Agent):** The Tier 3 infra protocol is fully specified in PITFALLS.md. Phase 5 is execution of a defined design, not new research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against `package.json` and live source files. One new dev dependency (`eslint-plugin-security`) has MEDIUM confidence on ESLint v9 flat config compatibility — verify before Phase 6 |
| Features | HIGH | Nova team is the direct analogue; existing codebase is the reference; feature list cross-checked against PROJECT.md v9.0 spec |
| Architecture | HIGH | Based on direct inspection of `runner.ts`, `orchestrator.ts`, `memory.ts`, `types.ts`, `load-rules.ts`, `scripts/chat.ts` — all patterns are verified working in production with Nova |
| Pitfalls | HIGH | Cross-referenced against first-party evidence (2026-04-02 Nova bypass incident), Stack Overflow AI PRs research (2026), Knostic Claude Code security findings, and observed production Nova agent behavior |

**Overall confidence:** HIGH

### Gaps to Address

- **ESLint v9 + `eslint-plugin-security` compatibility:** The plugin claims ESLint v9 support but flat config (`eslint.config.mjs`) compatibility needs hands-on verification. Handle in Phase 2 — build the lint tool, confirm it works, before Phase 6 builds the Security Agent on top of it.
- **Dev generalist vs. specialist split decision point:** Research recommends starting with a generalist Dev Agent, but the precise trigger for splitting into Backend+Frontend specialists is not defined. Track orchestration overhead in Phase 3; split if multi-specialist coordination consistently consumes more time than it saves.
- **Integration test isolation for QA Agent:** The transaction-rollback pattern for integration tests against real Postgres (vs. mocked Prisma) is MEDIUM confidence — needs verification in Phase 4 before QA Agent test strategy depends on it.
- **Memory size limit enforcement mechanism:** The 2,000-token hard cap on `.monty/memory/` files needs an implementation — post-write check in `appendToMemory()` or pre-write size estimate. Design in Phase 1, implement and test before Phase 3 memory writes begin accumulating.

## Sources

### Primary (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — `runAgent()` confirmed agent-agnostic, reusable for Monty unchanged
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/memory.ts` — `loadMemoryContext()` path-configurable, `appendToMemory()` pattern reusable
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/types.ts` — `AgentConfig` interface and model constants verified
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/orchestrator.ts` — delegation tool pattern (`delegateToXxx`) confirmed working in production
- `/Users/jjay/programs/outsignal-agents/package.json` — all dependency versions verified against live codebase
- `/Users/jjay/programs/outsignal-agents/.planning/PROJECT.md` — v9.0 milestone goals (authoritative spec)
- First-party incident: 2026-04-02 Nova delegation bypass — proves soft rules fail under task pressure; primary evidence for structural boundary enforcement

### Secondary (MEDIUM confidence)
- [Next.js Testing Guide (Vitest)](https://nextjs.org/docs/app/guides/testing/vitest) — Official vitest setup for Next.js App Router
- [eslint-plugin-security on npm](https://www.npmjs.com/package/eslint-plugin-security) — Plugin capabilities, ESLint v9 compatibility needs hands-on verification
- [agamm/claude-code-owasp](https://github.com/agamm/claude-code-owasp) — LLM-as-judge OWASP security review approach, OWASP Top 10:2025 + ASVS 5.0 coverage
- [Multi-agent orchestration for Claude Code 2026](https://shipyard.build/blog/claude-code-multi-agent/) — Two-team boundary pattern, PM-only orchestrator role
- [Claude Code Sub-agents docs](https://code.claude.com/docs/en/sub-agents) — Sub-agent memory architecture, persistent directory pattern

### Tertiary (MEDIUM confidence — survey/research data)
- [Stack Overflow Blog — AI coding agents (2026)](https://stackoverflow.blog/2026/01/28/are-bugs-and-incidents-inevitable-with-ai-coding-agents/) — AI PRs have 75% more logic/config errors; agents create 1.7x more bugs than humans; validates adversarial QA requirement
- [Knostic Claude Code security findings (2026)](https://knostic.ai/) — Claude Code loads `.env` secrets without user consent; subagents inherit all exported env vars; validates `.claudeignore` + `sanitize-output.ts` requirements

---
*Research completed: 2026-04-02*
*Ready for roadmap: yes*
