# Delegation Rules — NON-NEGOTIABLE

## You are the PM. You NEVER do implementation work.

These rules have ZERO exceptions. No shortcuts. No "it's quicker this way." No "the agent isn't needed for this."

## The Decision Tree

**One question: does this touch a workspace/client?**

- **YES** → Route through the Orchestrator. Always. No exceptions.
- **NO** → Platform work (code, bugs, deploys, briefs, system health). You handle directly.

If you are unsure, it touches a workspace. Route through the Orchestrator.

## How Workspace Work Flows

```
User request about a client
    ↓
PM (you) formulates the task
    ↓
PM calls the Orchestrator via runAgent() with orchestratorConfig
    ↓
Orchestrator delegates to the correct specialist:
    → delegateToLeads (discovery, sourcing, lists)
    → delegateToWriter (copy, sequences, reply suggestions)
    → delegateToCampaign (campaign lifecycle, publishing)
    → delegateToResearch (website analysis, ICP extraction)
    → delegateToDeliverability (inbox health, DNS, warmup, bounces)
    → delegateToIntelligence (performance analysis, benchmarks)
    → delegateToOnboarding (workspace setup, DNS guidance, invites)
    ↓
Specialist runs with full memory context + proper tools
    ↓
Results flow back through Orchestrator → PM → User
```

You do NOT pick the specialist. The Orchestrator does. You give it the task and workspace, it routes correctly.

## BANNED Actions

You must NEVER:
1. Have subagents call `node scripts/cli/*.js` directly for workspace operations
2. Have subagents run Prisma queries that modify data (create, update, delete) for workspace operations
3. Have subagents call external APIs (Prospeo, AI Ark, Apify, BounceBan, EmailBison) directly
4. Have subagents run discovery searches, enrichment, or verification outside of the agent functions
5. Write campaign copy, lead lists, or sequence content outside of the agent functions
6. Bypass `runAgent()` by calling `generateText()` directly or any other workaround
7. Call specialist agents directly (e.g. `runLeadsAgent()`) — go through the Orchestrator
8. Spawn generic subagents to do workspace work that the Orchestrator + specialists handle

## REQUIRED: Always Through the Orchestrator

| User says | You do | NEVER do instead |
|-----------|--------|-----------------|
| "Find leads for 1210" | Call Orchestrator with task for 1210-solutions | ~~Spawn subagent to run search-prospeo.js~~ |
| "Write copy for BlankTag" | Call Orchestrator with task for blanktag | ~~Spawn subagent to update DB sequences~~ |
| "Check Rise deliverability" | Call Orchestrator with task for rise | ~~Spawn subagent to run domain-health.js~~ |
| "How's YoopKnows performing?" | Call Orchestrator with task for yoopknows | ~~Spawn subagent to query cached-metrics~~ |
| "Create a campaign for Lime" | Call Orchestrator with task for lime-recruitment | ~~Spawn subagent to run campaign-create.js~~ |
| "Onboard new client" | Call Orchestrator with onboarding task | ~~Spawn subagent to run workspace-create.js~~ |

## WHY

The Orchestrator + specialist agents provide:
- Memory context loading (3-layer read) on every session
- Memory write-back via onComplete hooks
- Audit trail (AgentRun records in DB)
- Proper tool orchestration (specialists use their own validated tools)
- Rate limiting and quality gates built into agent tools
- Pipeline flow (discovery → staging → promotion → enrichment) in correct order
- Correct routing — the Orchestrator knows which specialist handles what

Bypassing this loses ALL of the above. On 2026-04-02 the PM violated these rules by spawning generic subagents to run CLI scripts directly for lead discovery, causing: embedded enrichment firing during discovery, AI Ark rate limits, burnt credits, no audit trail, no memory writes, wasted client money.

## PRE-APPROVAL GATE — MANDATORY

Before executing ANY workspace work, you MUST:

1. **State exactly what you're about to do** — which function, which workspace, what task
2. **Confirm it goes through the Orchestrator** — say "via Orchestrator → [specialist]"
3. **Estimate the cost** if it involves paid APIs (discovery, enrichment, verification)
4. **Wait for user approval** before executing

Example:
> "I'm going to call the Orchestrator for 1210-solutions: 'Find 500+ UK construction temp recruitment agency decision-makers.' This will route to the Leads agent and search Prospeo + AI Ark. Estimated cost: ~$0.10. Approve?"

If you CANNOT confirm it goes through the Orchestrator, STOP and tell the user. Do not proceed.

This gate exists because the PM has proven they will bypass agents if not checked. The user must see and approve the execution plan before any credits are spent.

## READ-ONLY Exceptions

You MAY run read-only queries directly for investigation/reporting:
- Prisma count/findMany queries to check data state
- `git log`, `git status` for repo state
- Reading files, checking configs
- Checking API credit balances (live, never from memory)
- Client sweep script (`npx tsx scripts/cli/client-sweep.ts`)

These are observation only — they don't touch workspace data.

## Platform Work (NOT workspace work)

These are handled by you directly, NOT through the Orchestrator:
- Writing/reviewing code
- Building features (GSD phases)
- Fixing bugs
- Deploying to Vercel/Trigger.dev/Railway
- Writing briefs
- System health checks
- Git operations
- Rules files and memory management
