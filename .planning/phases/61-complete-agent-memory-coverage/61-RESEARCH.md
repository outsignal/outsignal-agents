# Phase 61: Complete Agent Memory Coverage - Research

**Researched:** 2026-04-01
**Domain:** Agent framework extension (TypeScript, Vercel AI SDK)
**Confidence:** HIGH

## Summary

This phase adds 3 new specialist agents (Deliverability, Intelligence, Onboarding) and fixes orchestrator memory writes. The existing codebase has a clear, well-established pattern across 4 working agents (Writer, Leads, Campaign, Research) that the new agents must replicate exactly. All architectural decisions are locked -- this is pure pattern replication.

The key finding is that existing agents use **direct function/library imports** for their tools (not CLI subprocess wrapping). The CLI scripts in `scripts/cli/` are thin wrappers around the same functions, used for Claude Code MCP tool access. New agent tools must follow the same direct-import pattern.

Two onboarding CLI scripts (`workspace-create.ts`, `member-invite.ts`) do NOT exist yet and must be created as part of this phase. All other CLI scripts for deliverability and intelligence agents already exist.

**Primary recommendation:** Follow the exact agent pattern from writer.ts/leads.ts. Each new agent = ~100-200 lines: imports, tool definitions, system prompt via loadRules(), AgentConfig with onComplete, public runXxxAgent() function, Input/Output types in types.ts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Follow the EXACT same pattern as writer.ts, leads.ts, campaign.ts, research.ts:
  - AgentConfig with name, model, systemPrompt (loaded from rules file via load-rules.ts), tools, maxSteps, onComplete
  - Tools wrapping existing CLI scripts (same as other agents)
  - runXxxAgent() public API function
  - onComplete hook calling appendToMemory() with workspace-specific insights
- Each agent's system prompt is loaded from its rules file via `loadRulesFile()` in load-rules.ts

**Deliverability Agent:**
- Tools: senderHealth, domainHealth, bounceStats, inboxStatus (wrapping existing CLI scripts)
- onComplete writes to: learnings.md
- Orchestrator delegation: add delegateToDeliverability tool
- Model: NOVA_MODEL

**Intelligence Agent:**
- Tools: cachedMetrics, insightList, workspaceIntelligence, campaignsGet, readGlobalInsights
- onComplete writes to: learnings.md (per-workspace) + global-insights.md via appendToGlobalMemory
- Orchestrator delegation: add delegateToIntelligence tool
- Model: NOVA_MODEL

**Onboarding Agent:**
- Tools: workspaceCreate, workspaceGet, workspacePackageUpdate, memberInvite
- onComplete writes to: learnings.md + feedback.md
- Orchestrator delegation: add delegateToOnboarding tool
- Model: NOVA_MODEL

**Orchestrator Memory:**
- Cannot use onComplete (orchestrator bypasses runAgent in chat.ts)
- Add memory write at end of each chat turn in chat.ts
- After each orchestrator response, extract key actions taken and append to learnings.md
- Only write when tool calls were made (skip pure-text responses)

### Claude's Discretion
- Exact tool parameter schemas (follow existing patterns in other agents)
- Whether to use shared-tools.ts for common tool definitions
- How to extract "key actions" from orchestrator responses for memory writes
- Exact fields to extract from each specialist for onComplete entries

### Deferred Ideas (OUT OF SCOPE)
- Validator as standalone agent (runs inline, not needed)
- Memory-to-DB migration (for Vercel/Trigger.dev agents)
- Agent-to-agent delegation (agents calling other agents directly)
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | current | `tool()`, `generateText()`, `stepCountIs()` | Already used by all 4 existing agents |
| zod | v4 | Tool input schemas, output validation | Already used throughout codebase |
| @ai-sdk/anthropic | current | Anthropic model provider | Already configured |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @prisma/client | 6.x | Direct DB queries in tools | Deliverability + Intelligence tools query DB directly |

### No New Dependencies
All 3 new agents use existing libraries only. No new npm installs required.

## Architecture Patterns

### Exact Agent File Structure (from existing agents)

Each agent file follows this structure (~100-250 lines):

```typescript
// 1. Imports
import { tool } from "ai";
import { z } from "zod";
import { runAgent } from "./runner";
import { NOVA_MODEL } from "./types";
import type { AgentConfig, XxxInput, XxxOutput } from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
import { loadRules } from "./load-rules";
import { appendToMemory } from "./memory";

// 2. Tool definitions (object of tool() calls)
const xxxTools = {
  toolName: tool({
    description: "...",
    inputSchema: z.object({ ... }),
    execute: async (params) => { /* direct DB/lib calls */ },
  }),
};

// 3. System prompt (rules file + guard)
const XXX_SYSTEM_PROMPT = `You are the Outsignal Xxx Agent...

${loadRules("xxx-rules.md")}`;

// 4. Agent config
const xxxConfig: AgentConfig = {
  name: "xxx",
  model: NOVA_MODEL,
  systemPrompt: XXX_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: xxxTools,
  maxSteps: 10,
  outputSchema: xxxOutputSchema,  // optional
  onComplete: async (result, options) => {
    const slug = options?.workspaceSlug;
    if (!slug) return;
    const output = result.output as XxxOutput;
    await appendToMemory(slug, "learnings.md", `${output.action}: ${output.summary}`);
  },
};

// 5. Public API
export async function runXxxAgent(input: XxxInput): Promise<XxxOutput> {
  const userMessage = buildXxxMessage(input);
  const result = await runAgent<XxxOutput>(xxxConfig, userMessage, {
    triggeredBy: "orchestrator",
    workspaceSlug: input.workspaceSlug,
  });
  return result.output;
}

// 6. Message builder
function buildXxxMessage(input: XxxInput): string { ... }
```

### Tool Implementation Pattern: Direct Imports, NOT CLI Wrapping

**CRITICAL FINDING:** Despite CONTEXT.md mentioning "wrapping existing CLI scripts," the existing agents use **direct function/library imports** for their tools. The CLI scripts are thin wrappers used for MCP tool access, not the other way around.

Evidence:
- `leads.ts` imports from `@/lib/leads/operations`, `@/lib/discovery/adapters/*`
- `campaign.ts` imports from `@/lib/campaigns/operations`
- `research.ts` imports from `@/lib/firecrawl/client`, `@/lib/db`
- `writer.ts` imports from `@/lib/campaigns/operations`, `@/lib/copy-quality`

The `cliSpawn` mechanism in `orchestrator.ts` is ONLY used when `USE_CLI_AGENTS=true` env var is set (feature flag for CLI mode). Normal execution uses direct imports.

**For new agents:** Tools should use direct Prisma/library imports, following the pattern of `sender-health.ts` CLI script which literally calls `orchestratorTools.getSenderHealth.execute()`.

### Orchestrator Delegation Tool Pattern

Each delegation tool in `orchestrator.ts` follows this exact pattern:

```typescript
const delegateToXxx = tool({
  description: "Delegate a task to the Xxx Agent. Use this when...",
  inputSchema: z.object({
    workspaceSlug: z.string().describe("..."),
    task: z.string().describe("..."),
    // agent-specific optional params
  }),
  execute: async ({ workspaceSlug, task, ...rest }) => {
    if (isCliMode()) {
      // CLI subprocess fallback
      try {
        const tmpFile = `/tmp/${randomUUID()}.json`;
        writeFileSync(tmpFile, JSON.stringify({ workspaceSlug, task, ...rest }));
        const result = await cliSpawn("relevant-script.js", [...]);
        return { status: "complete", ... };
      } catch (error) {
        return { status: "failed", error: ... };
      }
    }
    // Normal path: direct agent call
    try {
      const result = await runXxxAgent({ workspaceSlug, task, ...rest });
      return { status: "complete", ...result };
    } catch (error) {
      return { status: "failed", error: ... };
    }
  },
});
```

### onComplete Hook Patterns (from existing agents)

| Agent | Memory File | What Gets Written | Skip Condition |
|-------|-------------|-------------------|----------------|
| Writer | campaigns.md | `${campaignName}: ${channel} ${strategy} sequence generated. ${kbRefs}` | No slug |
| Leads | learnings.md | `${action}: ${summary}` | No slug, action=unknown |
| Campaign | campaigns.md | `${action}: ${summary}` | No slug, action=unknown/list/get |
| Research | learnings.md | `Website analysis: ICP industries=${x}, ${n} differentiators, ${m} case studies` | No slug |

### Recommended Project Structure (new files)

```
src/lib/agents/
  deliverability.ts    # NEW — ~150 lines
  intelligence.ts      # NEW — ~180 lines  
  onboarding.ts        # NEW — ~200 lines (most tools need building)
  orchestrator.ts      # MODIFIED — add 3 delegation tools + imports
  types.ts             # MODIFIED — add Input/Output types for 3 agents
scripts/
  chat.ts              # MODIFIED — add memory write after tool-using turns
```

### Anti-Patterns to Avoid
- **Do NOT use cliSpawn for tool execute functions.** Existing agents use direct imports. CLI subprocess calls are only the `isCliMode()` fallback in orchestrator delegation tools.
- **Do NOT create new shared tools in shared-tools.ts** unless the tool is genuinely shared across 3+ agents. Each agent owns its tools.
- **Do NOT add outputSchema validation for simple agents.** Only Writer and Research have output schemas because they produce structured data. Deliverability/Intelligence/Onboarding produce freeform text summaries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Memory appending | Custom file writing | `appendToMemory()` / `appendToGlobalMemory()` | Handles validation, 200-line cap, timestamp, best-effort |
| Rules loading | Manual file reading | `loadRules("xxx-rules.md")` | Handles PROJECT_ROOT resolution, fallback |
| Agent execution | Custom generateText loop | `runAgent()` in runner.ts | Audit record, memory injection, output parsing, onComplete hook |
| Input sanitization | Manual escaping | `sanitizePromptInput()` + `USER_INPUT_GUARD` | Injection pattern stripping, XML wrapping |
| Tool definitions | Custom schemas | `tool()` from "ai" + `z.object()` | Type-safe, validated by Vercel AI SDK |

## Common Pitfalls

### Pitfall 1: Missing CLI Scripts for Onboarding
**What goes wrong:** CONTEXT.md lists `workspace-create.js` and `member-invite.js` as tools, but these CLI scripts do NOT exist in `scripts/cli/`.
**Why it happens:** Onboarding was previously a manual process via dashboard UI.
**How to avoid:** For workspace creation and member invites, use direct Prisma/library calls in the tool `execute` functions (same pattern as other agents). Optionally create CLI wrappers later.
**Warning signs:** Import errors for non-existent modules.

### Pitfall 2: Circular Import from Orchestrator Tools
**What goes wrong:** `sender-health.ts` CLI script imports `orchestratorTools.getSenderHealth` from orchestrator.ts. If a new agent tool tries to import from orchestrator tools, it creates circular dependencies.
**Why it happens:** CLI scripts were designed as thin wrappers around orchestrator dashboard tools.
**How to avoid:** For deliverability tools (senderHealth, domainHealth, bounceStats, inboxStatus), extract the underlying logic directly from Prisma/library calls rather than re-importing from orchestrator.

### Pitfall 3: onComplete Hook Never Throwing
**What goes wrong:** If onComplete throws, it's caught by runner.ts but logged as an error.
**Why it happens:** appendToMemory is best-effort but the hook itself could fail on type casting.
**How to avoid:** Follow the established pattern: guard with `if (!slug) return`, cast output safely, use simple string interpolation. runner.ts wraps onComplete in try/catch (line 130-140).

### Pitfall 4: Chat.ts Memory Write on Every Turn
**What goes wrong:** Writing memory on every orchestrator response floods the 200-line memory file with noise.
**Why it happens:** Most orchestrator turns are simple queries (list workspaces, get info).
**How to avoid:** Only write memory when `allToolCalls` from the current turn include delegation tool calls (delegateToResearch, delegateToWriter, etc.) or mutation tools. Skip pure-query turns.

### Pitfall 5: Intelligence Agent Global Memory Format
**What goes wrong:** Using wrong timestamp format for global-insights.md.
**Why it happens:** Per-workspace uses `[timestamp] -- entry` but global uses `[timestamp] entry` (bare, no dash prefix).
**How to avoid:** Use `appendToGlobalMemory()` which formats correctly (line 112 of memory.ts: `[${timestamp}] ${entry}`). Don't call appendToMemory for global writes.

## Code Examples

### Pattern 1: Complete Tool Definition (from campaign.ts)

```typescript
// Source: src/lib/agents/campaign.ts lines 415-434
const campaignConfig: AgentConfig = {
  name: "campaign",
  model: NOVA_MODEL,
  systemPrompt: CAMPAIGN_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: campaignTools,
  maxSteps: 10,
  outputSchema: campaignOutputSchema,
  onComplete: async (result, options) => {
    const slug = options?.workspaceSlug;
    if (!slug) return;
    const output = result.output as CampaignOutput;
    if (output.action === "unknown" || output.action === "list" || output.action === "get") return;
    await appendToMemory(slug, "campaigns.md", `${output.action}: ${output.summary}`);
  },
};
```

### Pattern 2: Delegation Tool in Orchestrator (from orchestrator.ts)

```typescript
// Source: src/lib/agents/orchestrator.ts lines 86-139
const delegateToLeads = tool({
  description: "Delegate a task to the Leads Agent...",
  inputSchema: z.object({
    workspaceSlug: z.string().optional().describe("..."),
    task: z.string().describe("..."),
    conversationContext: z.string().optional().describe("..."),
  }),
  execute: async ({ workspaceSlug, task, conversationContext }) => {
    if (isCliMode()) { /* CLI fallback */ }
    try {
      const result = await runLeadsAgent({ workspaceSlug, task, conversationContext });
      return { status: "complete", action: result.action, summary: result.summary, data: result.data };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "Leads Agent failed" };
    }
  },
});
```

### Pattern 3: Public API Function (from research.ts)

```typescript
// Source: src/lib/agents/research.ts lines 211-230
export async function runResearchAgent(input: ResearchInput): Promise<ResearchOutput> {
  const userMessage = buildResearchMessage(input);
  try {
    const result = await runAgent<ResearchOutput>(researchConfig, userMessage, {
      triggeredBy: "cli",
      workspaceSlug: input.workspaceSlug,
    });
    return result.output;
  } catch (error) {
    // optional: notify on failure
    throw error;
  }
}
```

### Pattern 4: Chat.ts Memory Write (proposed)

```typescript
// After line 115 in scripts/chat.ts, after messages.push({ role: "assistant", ... })
// Extract delegation tool calls from this turn
const delegationCalls = result.steps
  .flatMap(s => s.toolCalls)
  .filter(tc => tc.toolName.startsWith("delegateTo"));

if (delegationCalls.length > 0 && workspaceSlug) {
  const actions = delegationCalls.map(tc => tc.toolName.replace("delegateTo", "")).join(", ");
  try {
    await appendToMemory(workspaceSlug, "learnings.md", `Orchestrator session: delegated to ${actions}`);
  } catch { /* best-effort */ }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CLI-only agent access | Direct import tools + CLI wrappers | Phase 52 (v8.0) | Agents run in-process, CLI scripts are thin wrappers |
| No memory writes | onComplete hooks in runner.ts | Phase 54.1 | Agents persist learnings after runs |
| No memory reads | loadMemoryContext() in runner.ts | Phase 59 | Agents load 3-layer memory context at start |

## Key Implementation Details

### Types to Add (types.ts)

```typescript
// Deliverability
export interface DeliverabilityInput {
  workspaceSlug: string;
  task: string;
}
export interface DeliverabilityOutput {
  action: string;
  summary: string;
  data?: unknown;
}

// Intelligence
export interface IntelligenceInput {
  workspaceSlug: string;
  task: string;
}
export interface IntelligenceOutput {
  action: string;
  summary: string;
  data?: unknown;
}

// Onboarding
export interface OnboardingInput {
  workspaceSlug: string;
  task: string;
}
export interface OnboardingOutput {
  action: string;
  summary: string;
  data?: unknown;
}
```

### Deliverability Tools (direct DB calls)

The 4 tools map to these existing functions:
1. **senderHealth** -- Query `Sender` table with bounce/reply stats (same logic as `orchestratorTools.getSenderHealth`)
2. **domainHealth** -- Call `computeDomainRollup()` from `@/lib/domain-health/snapshots`
3. **bounceStats** -- Query `Sender` + `BounceSnapshot` tables via Prisma
4. **inboxStatus** -- Call `checkAllWorkspaces()` from `@/lib/inbox-health/monitor`

### Intelligence Tools (direct DB calls)

1. **cachedMetrics** -- Query `CachedMetrics` table via Prisma (latest per campaign)
2. **insightList** -- Query `Insight` table via Prisma
3. **workspaceIntelligence** -- Reuse `orchestratorTools.getWorkspaceInfo` logic or import directly
4. **campaignsGet** -- Reuse `orchestratorTools.getCampaigns` logic (EmailBison API)
5. **readGlobalInsights** -- Read `.nova/memory/global-insights.md` file

### Onboarding Tools (need building)

1. **workspaceCreate** -- Direct Prisma `workspace.create()` (NO existing CLI script)
2. **workspaceGet** -- Reuse workspace query logic
3. **workspacePackageUpdate** -- Reuse `orchestratorTools.updateWorkspacePackage` logic
4. **memberInvite** -- Build invite logic (NO existing CLI script -- need to check if there's an invite mechanism in the codebase)

### Missing Onboarding Infrastructure

`workspace-create.js` and `member-invite.js` do NOT exist. The planner must account for:
- `workspaceCreate` tool: straightforward Prisma `workspace.create()` with slug validation
- `memberInvite` tool: may need to check if there's an existing invite/auth mechanism. The `member-invite.js` CLI was referenced in onboarding-rules.md but never built.

### Orchestrator Modifications (orchestrator.ts)

Add to imports:
```typescript
import { runDeliverabilityAgent } from "./deliverability";
import { runIntelligenceAgent } from "./intelligence";
import { runOnboardingAgent } from "./onboarding";
```

Add 3 new delegation tools following the exact pattern of existing 4.

Update `orchestratorTools` object to include all 7 delegation tools.

Update `ORCHESTRATOR_SYSTEM_PROMPT` to document the 3 new delegation targets.

### Chat.ts Memory Write Location

The memory write should go in the `chat()` function (line 80-116) after `messages.push({ role: "assistant", ... })` at line 114. It needs:
1. Access to `result.steps` to check for delegation tool calls
2. Access to `workspaceSlug` (module-level variable)
3. Import `appendToMemory` from memory.ts

## Open Questions

1. **Member Invite Mechanism**
   - What we know: `member-invite.js` CLI is referenced in onboarding-rules.md but does not exist
   - What's unclear: Whether there's an existing invite/auth mechanism in the codebase (email-based invite, portal access token, etc.)
   - Recommendation: Check for existing invite logic in `src/lib/` or `src/app/api/`. If none exists, the onboarding agent's memberInvite tool should be a stub that returns "not yet implemented" rather than blocking the whole phase.

2. **Workspace Creation Fields**
   - What we know: The Prisma schema has a `Workspace` model with required fields
   - What's unclear: Exact required vs optional fields for `workspace.create()`
   - Recommendation: Check `prisma/schema.prisma` for the Workspace model during implementation. At minimum: name, slug, vertical are required.

## Sources

### Primary (HIGH confidence)
- `src/lib/agents/writer.ts` -- Complete agent pattern with onComplete hook
- `src/lib/agents/leads.ts` -- Agent pattern with skip conditions on onComplete
- `src/lib/agents/campaign.ts` -- Agent pattern with action-based skip
- `src/lib/agents/research.ts` -- Agent pattern with structured onComplete
- `src/lib/agents/orchestrator.ts` -- Delegation tool pattern (4 existing)
- `src/lib/agents/runner.ts` -- runAgent() execution engine
- `src/lib/agents/memory.ts` -- appendToMemory() and appendToGlobalMemory()
- `src/lib/agents/types.ts` -- AgentConfig interface and type definitions
- `src/lib/agents/load-rules.ts` -- Rules file loading
- `src/lib/agents/utils.ts` -- sanitizePromptInput, USER_INPUT_GUARD, isCliMode
- `scripts/chat.ts` -- Orchestrator CLI with session persistence
- `.claude/rules/deliverability-rules.md` -- Deliverability agent rules and tool specs
- `.claude/rules/intelligence-rules.md` -- Intelligence agent rules and tool specs
- `.claude/rules/onboarding-rules.md` -- Onboarding agent rules and tool specs

### Verification
- `scripts/cli/` directory listing -- confirmed which CLI scripts exist and which are missing
- CLI script source code -- confirmed they wrap orchestrator tools / direct Prisma calls

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, exact pattern replication
- Architecture: HIGH -- 4 working reference implementations in codebase
- Pitfalls: HIGH -- identified from direct code inspection
- Onboarding tools: MEDIUM -- workspace-create is straightforward but member-invite needs investigation

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable internal codebase patterns)
