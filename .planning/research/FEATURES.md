# Feature Research

**Domain:** Dev Orchestrator Agent Team — Platform Engineering (v9.0 Monty)
**Researched:** 2026-04-02
**Confidence:** HIGH (existing codebase is the reference; Nova agent team is the direct analogue)

---

## Context: What Already Exists

This is a new agent team being added alongside an existing system. The Nova team (campaign operations) is the direct pattern to follow:

- **Orchestrator pattern** — `src/lib/agents/orchestrator.ts` routes to specialists via `delegateToX` tools
- **Runner pattern** — `runAgent()` in `runner.ts` handles AgentRun audit log, memory injection, onComplete hooks
- **Agent types** — `AgentConfig` with model, systemPrompt, tools, maxSteps, outputSchema, onComplete
- **Memory pattern** — 3-layer reads (MEMORY.md + global-insights.md + workspace files), write-back via onComplete
- **CLI skill pattern** — `.claude/skills/` files for Claude Code CLI invocation (Cmd+J)
- **Rules pattern** — `.claude/rules/` files per specialist, delegation-rules.md governing who does what
- **CLI wrapper scripts** — 55 scripts in `scripts/cli/` exposing DB/API to agents

The Monty team is a **parallel team** with a hard domain boundary: Nova = workspace/campaign work, Monty = codebase/platform work.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the dev orchestrator MUST have to function at all. Without these, it cannot do the job.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Work triage (bug vs feature) | Orchestrator must route correctly before any specialist fires | LOW | PM capability — classify intent, route to the right specialist. Cannot delegate wrong work to wrong agent. |
| Boundary enforcement (Monty vs Nova) | Two-team system breaks without hard boundaries | LOW | "workspace slug" → Nova, "codebase/infra/bug/feature" → Monty. Must be enforced in rules, not trust. |
| Orchestrator skill file (.claude/skills/) | Human can invoke Monty via Cmd+J (same as Nova) | LOW | Maps to `monty-orchestrator.md`. Follows exact Nova skill pattern. |
| Specialist rules files (.claude/rules/) | Each specialist needs its own operating rules | LOW | One file per specialist (backend, frontend, infra, QA, security). Pattern: existing `.claude/rules/` files. |
| AgentRun audit trail | All agent invocations logged with input/output/steps/tokens | LOW | Already built in `runAgent()`. Just need to wire new agents to it. Provides debugging + cost tracking. |
| Memory context injection | Specialists need codebase context across sessions | MEDIUM | Analogous to Nova workspace memory. Pattern: `.monty/memory/` flat files (tech debt log, decisions, known issues). |
| Specialist delegation tools | Orchestrator delegates via typed tools (delegateToBackend, delegateToFrontend, etc.) | MEDIUM | Follow exact delegateToX pattern from orchestrator.ts. One tool per specialist. |
| Pre-approval gate | PM must state what it will do and get approval before acting on paid/destructive operations | LOW | Mirrors delegation-rules.md gate. Prevents rogue deploys and unreviewed code changes. |
| Backlog read access | Orchestrator must be able to read the current backlog/known issues to triage properly | LOW | Read `.planning/` files, MEMORY.md pending work section. No write access needed at orchestrator level. |

### Differentiators (Competitive Advantage Over Ad-Hoc Subagents)

Features that make Monty meaningfully better than just spawning a generic Claude subagent each time.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Persistent tech-debt memory | Monty remembers known issues, past decisions, and architectural patterns across sessions — no re-explaining context each time | MEDIUM | `.monty/memory/` files: `decisions.md`, `tech-debt.md`, `known-issues.md`. Write-back via onComplete hooks, same as Nova memory. |
| Codebase map awareness | Specialists are pre-loaded with `gsd-file-manifest.json` and key file locations so they don't waste steps exploring | MEDIUM | Inject relevant file paths into system prompt. Backend agent knows where API routes live; Frontend agent knows component locations. |
| Sequential quality gates | Work flows: triage → implement → QA review → security check → deploy. Not one-shot. | HIGH | QA agent reviews Backend/Frontend output before marking complete. Security agent flags credential/auth issues. Creates mandatory review loop. |
| PM-mode orchestrator | Monty acts as project manager — asks clarifying questions, breaks work into phases, estimates complexity before delegating | MEDIUM | Orchestrator prompt written as PM, not executor. Outputs a work plan before delegating, not just a raw delegation. |
| Deployment gate | Infrastructure agent owns deploys — specialists cannot trigger deploys directly | MEDIUM | Prevents accidental production pushes. Infra agent does git add → commit → (awaits user approval) → push → deploy. |
| Security agent as review gate | Security agent reviews any PR involving auth, credentials, API routes before deployment is allowed | HIGH | Hard gate on security-sensitive code paths. Runs OWASP-aware checklist. Flags issues back to Backend/Frontend before Infra can deploy. |
| Backlog management | Orchestrator can add items to `.planning/` backlog, update STATUS in MILESTONES.md, track work-in-progress | MEDIUM | Read + write access to planning files. Keeps planning artifacts in sync with what agents actually do. |
| Stack-aware specialists | Each specialist is pre-loaded with the project's exact stack (Next.js 16, Prisma 6, Neon, Vercel, Railway) and established patterns | LOW | Inject stack context into each specialist's system prompt. Prevents agents suggesting incompatible solutions. |
| Cost tracking per agent | Every Monty invocation tracked in AgentRun — model, tokens, duration | LOW | Already built in runner.ts. Just need to instrument Monty agents into it. Surfaces "what does Monty cost per session?" |

### Anti-Features (Deliberately NOT Building)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Replicating GSD functionality | GSD already handles project planning, phase research, roadmap creation, and verifier flows. Monty is for executing work, not planning it. | Monty invokes GSD tools for planning tasks. Boundary: GSD = plan, Monty = execute. |
| Automated test generation at scale | Generating comprehensive test suites from scratch is extremely high complexity and low ROI for this codebase. Test coverage is thin by design. | QA agent focuses on code review and spot-checking critical paths. Test generation is scoped to the specific change being made. |
| CI/CD pipeline integration | No GitHub Actions, no automated PR workflows, no webhook-triggered builds. The deploy flow is manual (explicit user approval before push). | Infra agent runs deploy commands after explicit user approval. Deploy burns Vercel Pro credits — never automatic. |
| Security scanning tools (Snyk, SonarQube) | External tool integrations add maintenance burden. The codebase uses TypeScript which catches many errors statically. | Security agent does prompt-based OWASP-aware review of changed files. Not automated scanning. |
| Code review automation (auto-approve PRs) | No PRs — this is a solo dev project with direct commit to main. Automated PR approval adds complexity with no benefit. | QA agent reviews code before commit, not PRs. |
| Design system enforcement tools (Storybook, Chromatic) | Overkill for this codebase. UI UX Pro Max skill already handles design consistency. | Frontend agent loads UI UX Pro Max skill. Design review is prompt-based, not tooling-based. |
| Incident response automation | This is not a high-availability system with SLA requirements. Monty Radar (scheduled health monitor) already handles alerting. | Monty Radar alerts via ntfy/Slack. Monty agents handle the fix after human triage. |
| Per-line code coverage metrics | Coverage tooling (Istanbul/c8) adds build complexity. Zero return on investment for this team size. | QA agent reviews logical coverage of critical paths by inspection. |
| Infrastructure as Code (Terraform/Pulumi) | Three services (Vercel, Railway, Neon) with simple manual config. IaC overhead exceeds benefit. | Infra agent handles deploy commands and config changes directly via CLI tools (Vercel CLI, Railway CLI). |
| Autonomous bug fixing without human review | Agents should never self-approve and self-deploy fixes. Human must approve at the deploy gate. | Sequential flow: Backend fixes → QA reviews → Security checks if relevant → Human approves → Infra deploys. |

---

## Feature Dependencies

```
[Orchestrator skill file]
    └──requires──> [Specialist rules files]
                       └──requires──> [AgentRun audit trail]

[PM triage capability]
    └──requires──> [Backlog read access]
    └──requires──> [Boundary enforcement rules]

[Sequential quality gates]
    └──requires──> [Specialist delegation tools]
    └──requires──> [QA agent + Security agent exist]

[Deployment gate]
    └──requires──> [Infrastructure agent]
    └──requires──> [Pre-approval gate] (hard dependency — no deploy without human sign-off)

[Security agent review gate]
    └──requires──> [Security agent]
    └──enhances──> [Deployment gate] (security gate runs before infra deploys)

[Persistent tech-debt memory]
    └──requires──> [onComplete hooks wired to Monty agents]
    └──enhances──> [PM triage capability] (triage is smarter with known-issues context)

[Codebase map awareness]
    └──requires──> [gsd-file-manifest.json exists and is current]
    └──enhances──> [All specialists] (faster implementation, fewer explore steps)
```

### Dependency Notes

- **Orchestrator requires specialists**: Cannot ship orchestrator without at least Backend + Frontend + Infra. QA + Security can come in a second wave.
- **Deployment gate requires pre-approval gate**: No path to deploy should exist without explicit human approval. This is enforced at the Infra agent rules level.
- **Memory requires onComplete hooks**: Tech-debt memory only accumulates if agents write back on completion. Must be wired from day one.
- **Boundary enforcement conflicts with ad-hoc spawning**: If ad-hoc generic subagents can still be spawned for codebase work, Monty's boundaries are meaningless. delegation-rules.md must cover both Nova and Monty boundaries.

---

## MVP Definition

### Launch With (v1 — Phase 62-66 target)

Minimum viable Monty. Handles the most common dev work requests end-to-end.

- [ ] Monty Orchestrator (PM mode) — triage, route, PM-style pre-work planning
- [ ] Backend Agent — API routes, Prisma, Trigger.dev tasks, server logic
- [ ] Frontend/UI Agent — React components, pages, design system (loads UI UX Pro Max skill)
- [ ] Infrastructure Agent — Vercel deploy, Railway deploy, Trigger.dev deploy, git operations
- [ ] QA Agent — code review, logic checking, validation of specialist output
- [ ] Persistent memory (`.monty/memory/`) — decisions.md, tech-debt.md, known-issues.md
- [ ] Boundary enforcement in delegation-rules.md — hard rule: codebase work → Monty
- [ ] Orchestrator skill file for Cmd+J invocation

### Add After Validation (v1.x)

Features to add once core Monty is proven useful.

- [ ] Security Agent — OWASP-aware code review, auth/credential checking, security gate before deploy
- [ ] Backlog management write-back — Orchestrator can update `.planning/` artifacts
- [ ] Codebase map injection — file manifest loaded into specialist system prompts
- [ ] Cross-agent handoff protocol — QA agent can send structured feedback back to Backend/Frontend for revision

### Future Consideration (v2+)

- [ ] Monty health endpoint for Monty Radar to monitor agent team health
- [ ] Cost reporting per session (tokens × model pricing, surfaced in dashboard)
- [ ] Automated regression on deploy — QA agent runs smoke tests post-deploy and reports

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Orchestrator skill + PM triage | HIGH | LOW | P1 |
| Backend Agent | HIGH | LOW | P1 |
| Frontend/UI Agent | HIGH | LOW | P1 |
| Infrastructure Agent | HIGH | MEDIUM | P1 |
| QA Agent | HIGH | MEDIUM | P1 |
| Boundary enforcement rules | HIGH | LOW | P1 |
| Persistent tech-debt memory | HIGH | LOW | P1 |
| Security Agent | HIGH | MEDIUM | P2 |
| Backlog management write-back | MEDIUM | LOW | P2 |
| Codebase map awareness | MEDIUM | LOW | P2 |
| Cross-agent handoff protocol | MEDIUM | MEDIUM | P2 |
| Cost reporting per session | LOW | LOW | P3 |
| Automated regression on deploy | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch (v1)
- P2: Should have, add after core is validated
- P3: Nice to have, future consideration

---

## Comparison: Monty vs Nova Architecture

| Dimension | Nova (Campaign Ops) | Monty (Platform Eng) |
|-----------|---------------------|----------------------|
| Orchestrator mode | Task router | PM + task router |
| Memory scope | Per-workspace (10 clients) | Per-project (1 codebase) |
| Memory writes | campaigns, feedback, learnings per slug | decisions, tech-debt, known-issues |
| Specialist count | 7 specialists | 5 specialists (launch) |
| CLI tools | 55 wrapper scripts | Git, Vercel CLI, Railway CLI, prisma db push |
| Quality gates | validateCopy → validateSequence | QA review → Security check → deploy gate |
| Approval model | Client portal approval | Human pre-approval before deploy |
| Invocation | Cmd+J (CLI skill) | Cmd+J (CLI skill) |
| Audit trail | AgentRun table | AgentRun table (same) |
| Rules files | 8 rules files | 5+ rules files (new) |

The architecture is deliberately parallel — same runner, same types, same AgentRun table. Monty is Nova's sibling, not a redesign.

---

## Sources

- Existing codebase: `src/lib/agents/orchestrator.ts`, `runner.ts`, `types.ts` — HIGH confidence (direct inspection)
- Existing rules files: `.claude/rules/` — HIGH confidence (direct inspection)
- PROJECT.md v9.0 milestone section — HIGH confidence (authoritative spec)
- Nova memory pattern: `.nova/memory/` — HIGH confidence (working production system)
- delegation-rules.md — HIGH confidence (current enforcement rules)

---

*Feature research for: Dev Orchestrator Agent Team (v9.0 Monty)*
*Researched: 2026-04-02*
