# Phase 64: Orchestrator + Dev Generalist - Research

**Researched:** 2026-04-03
**Domain:** Agent framework (AI SDK v6 tools, Monty orchestrator, Dev generalist agent)
**Confidence:** HIGH

## Summary

Phase 64 replaces the 5 stub tools in `src/lib/agents/monty-orchestrator.ts` with real implementations and creates a new `src/lib/agents/monty-dev.ts` Dev Generalist agent. The pattern is well-established: Nova has 7 specialist agents all following the same `AgentConfig` + `runAgent()` + `onComplete` hook architecture. Phase 64 mirrors this pattern exactly for the Monty team, with two key differences: (1) the orchestrator delegates via `runAgent()` instead of the Nova delegation pattern (which uses `run*Agent()` wrappers), and (2) the Dev agent's tools wrap `scripts/dev-cli/*.js` commands via `execSync` rather than database/API operations.

This is the heaviest phase in the milestone (15 requirements: ORCH-01 through ORCH-05, ORCH-07, ORCH-08, DEV-01 through DEV-06, DEV-08, DEV-09) but the architecture is 100% established. No new libraries, no new patterns to invent. The work is: implement the triage/delegation/backlog logic in the orchestrator, build the Dev agent config with tools, and wire up the onComplete hooks for memory writes.

**Primary recommendation:** Split into 3 plans: (1) Orchestrator triage + backlog tools, (2) Dev agent config + tools, (3) Delegation wiring + onComplete hooks. All code lives in `src/lib/agents/monty-orchestrator.ts` and a new `src/lib/agents/monty-dev.ts`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (AI SDK) | v6 | `tool()`, `generateText()`, `stepCountIs()` | Already used by all 8 Nova agents |
| zod | v4 | `inputSchema` for tools, output validation | Already used project-wide |
| @ai-sdk/anthropic | current | Anthropic model provider | Already configured |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fs/promises | node built-in | Read/write `.monty/memory/` files | Backlog CRUD, decisions.md append |
| child_process | node built-in | `execSync` for dev-cli tool wrappers | Dev agent tool execution |

### Alternatives Considered
None. Zero new packages per v9.0 decision.

## Architecture Patterns

### Recommended Project Structure
```
src/lib/agents/
├── monty-orchestrator.ts  # Orchestrator config + triage + delegation + backlog tools (MODIFY)
├── monty-dev.ts           # Dev Generalist agent config + tools + runMontyDevAgent() (CREATE)
├── runner.ts              # Shared agent runner (NO CHANGES)
├── types.ts               # Shared types — add MontyDevInput/Output (MODIFY)
├── memory.ts              # Shared memory — add appendToMontyMemory() (MODIFY)
└── load-rules.ts          # Shared rules loader (NO CHANGES)
```

### Pattern 1: Delegation via runAgent (Nova Pattern)
**What:** Orchestrator tool executes a specialist agent via `runAgent()` and returns a summary to the orchestrator.
**When to use:** Every `delegateToDevAgent` / `delegateToQA` / `delegateToSecurity` tool call.
**Example (from Nova's orchestrator.ts):**
```typescript
const delegateToDevAgent = tool({
  description: "Delegate a platform engineering task to the Dev Agent...",
  inputSchema: z.object({
    task: z.string().describe("What the Dev Agent should do"),
    tier: z.enum(["1", "2", "3"]).describe("Action tier"),
  }),
  execute: async ({ task, tier }) => {
    try {
      const result = await runMontyDevAgent({ task, tier });
      return {
        status: "complete",
        action: result.action,
        summary: result.summary,
        filesChanged: result.filesChanged,
      };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : "Dev Agent failed",
      };
    }
  },
});
```

### Pattern 2: Backlog CRUD via fs/promises
**What:** `readBacklog` and `updateBacklog` tools operate directly on `.monty/memory/backlog.json` using file I/O.
**When to use:** Backlog management (add, update, complete, list items).
**Example:**
```typescript
const readBacklog = tool({
  description: "Read the current Monty backlog",
  inputSchema: z.object({}),
  execute: async () => {
    const content = await readFile(
      join(process.cwd(), ".monty/memory/backlog.json"),
      "utf8"
    );
    return JSON.parse(content);
  },
});
```

### Pattern 3: Dev Agent Tools Wrapping dev-cli Scripts
**What:** Dev agent tools call compiled `dist/dev-cli/*.js` scripts via `execSync` and parse JSON output.
**When to use:** All Dev agent tool implementations.
**Example:**
```typescript
const gitStatus = tool({
  description: "Check git working tree status",
  inputSchema: z.object({}),
  execute: async () => {
    const result = execSync("node dist/dev-cli/git-status.js", {
      cwd: process.env.PROJECT_ROOT ?? process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const envelope = JSON.parse(result);
    return envelope.ok ? envelope.data : { error: envelope.error };
  },
});
```

### Pattern 4: onComplete Memory Hook
**What:** Agent config includes `onComplete` that writes a summary to `.monty/memory/decisions.md`.
**When to use:** Every Monty agent config (orchestrator + dev).
**Example (from Nova's research.ts):**
```typescript
onComplete: async (result, options) => {
  // Dev agent writes to .monty/memory/decisions.md
  await appendToMontyMemory(
    "decisions.md",
    `Dev: ${result.output.action} — ${result.output.summary}`
  );
  // Cross-team notification when platform changes affect Nova
  if (result.output.affectsNova) {
    await appendToGlobalMemory(
      `[Monty Dev] ${result.output.novaNotification}`
    );
  }
},
```

### Pattern 5: Triage Classification in System Prompt
**What:** The orchestrator classifies incoming work as bug/feature/improvement with severity/priority in its system prompt instructions, not in code logic.
**When to use:** ORCH-01 triage. The LLM does the classification, the system prompt defines the taxonomy.
**Key insight:** Nova's orchestrator delegates routing decisions to the LLM via detailed system prompt instructions. Monty should do the same. The LLM reads the task description and decides which specialist to call. No hardcoded routing logic needed.

### Anti-Patterns to Avoid
- **Hardcoded routing logic:** Do NOT build a TypeScript classifier that parses task descriptions. The LLM handles classification via system prompt.
- **In-process code execution:** Dev agent tools MUST use `execSync` to call dev-cli scripts, not import source code directly. This maintains the same isolation pattern as Nova's CLI mode.
- **Direct memory file writes in tool execute:** Memory writes belong in `onComplete` hooks, not in individual tool execute functions. This keeps the audit trail centralized.
- **Tier 3 approval in code:** Tier 3 gating is enforced by the system prompt instructing the orchestrator to state what will happen and wait for human approval. Do NOT build a code-level approval gate — the interactive REPL in `scripts/monty.ts` already provides the human-in-the-loop.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent execution | Custom LLM call logic | `runAgent()` from runner.ts | Handles audit trail, memory loading, step extraction, error handling |
| Tool definition | Raw function objects | `tool()` from AI SDK | Type-safe inputSchema, proper AI SDK integration |
| Memory reads | Custom file reader | `loadMemoryContext()` with `{ memoryRoot: ".monty/memory" }` | 3-layer read system already built |
| Memory writes | Direct `appendFile` | New `appendToMontyMemory()` (mirror `appendToMemory()`) | Line count enforcement, timestamp formatting, validation |
| CLI script execution | `spawn` with pipe management | `execSync` with maxBuffer | dev-cli scripts are fast synchronous operations, not long-running |
| Session audit | Custom logging | `prisma.agentRun.create/update` via `runAgent()` | AgentRun table already handles all agent audit trails |

**Key insight:** Everything needed already exists. The task is assembly, not invention.

## Common Pitfalls

### Pitfall 1: Zod v4 z.record() Signature
**What goes wrong:** Using `z.record(z.unknown())` (Zod v3 syntax) causes TypeScript errors.
**Why it happens:** Project uses Zod v4 which requires two arguments: `z.record(keyType, valueType)`.
**How to avoid:** Always use `z.record(z.string(), z.unknown())` for generic object schemas.
**Warning signs:** `npx tsc --noEmit` fails on tool inputSchema definitions.

### Pitfall 2: Memory Write Path Not Parameterized
**What goes wrong:** `appendToMemory()` hardcodes `.nova/memory` as the write path. Calling it for Monty writes to the wrong namespace.
**Why it happens:** Phase 62 noted "Write path stays Nova-only for now; Phase 67 will parameterize writes."
**How to avoid:** Create a new `appendToMontyMemory(file, entry)` function that targets `.monty/memory/` directly. Do NOT modify `appendToMemory()` yet (that is Phase 67 scope).
**Warning signs:** Monty memory entries appearing in `.nova/memory/` files.

### Pitfall 3: Backlog JSON Corruption
**What goes wrong:** Concurrent reads/writes to `backlog.json` during a multi-step agent run can corrupt the file.
**Why it happens:** Two tool calls in the same agent step both read-modify-write the same file.
**How to avoid:** Use read-then-write atomically in each tool call. The orchestrator runs sequentially (one tool call at a time via `generateText` step loop), so concurrent writes within a single agent run are unlikely but defensive coding is warranted.
**Warning signs:** `JSON.parse` errors when reading backlog.json.

### Pitfall 4: Runner Memory Root Override
**What goes wrong:** `runAgent()` in runner.ts calls `loadMemoryContext(options?.workspaceSlug)` WITHOUT passing `memoryRoot`. Monty agents would load Nova memory instead of Monty memory.
**Why it happens:** The runner was built for Nova agents and defaults to `.nova/memory`.
**How to avoid:** Either (a) add `memoryRoot` to the runner options and pass it through, or (b) have the Monty orchestrator system prompt already include memory context (as `scripts/monty.ts` already does, loading memory before calling `generateText`). Option (b) is simpler and matches the existing pattern in `scripts/monty.ts`. For the Dev agent called via `runAgent()`, the runner needs to be aware of the memory root. Add an optional `memoryRoot` field to `AgentConfig` and pass it in `runAgent()`.
**Warning signs:** Dev agent responses reference Nova workspace data instead of Monty platform context.

### Pitfall 5: AI SDK tool() inputSchema vs parameters
**What goes wrong:** Using `parameters` key instead of `inputSchema` in tool definitions.
**Why it happens:** AI SDK docs may show both; this project uses `inputSchema` throughout.
**How to avoid:** Always use `inputSchema` — grep existing tool definitions to confirm.
**Warning signs:** TypeScript errors or tools not being called by the model.

## Code Examples

### Backlog Item Schema
```typescript
interface BacklogItem {
  id: string;         // "BL-001", auto-incremented
  title: string;
  type: "bug" | "feature" | "improvement";
  severity?: "critical" | "high" | "medium" | "low";
  priority: 1 | 2 | 3 | 4;
  status: "open" | "in_progress" | "done";
  createdAt: string;  // ISO timestamp
  updatedAt: string;  // ISO timestamp
  notes?: string;
}

interface Backlog {
  version: number;
  items: BacklogItem[];
}
```

### Dev Agent Tools (complete list from dev-cli scripts)
```typescript
const devTools = {
  gitStatus:    tool({ /* wraps dist/dev-cli/git-status.js */ }),
  gitDiff:      tool({ /* wraps dist/dev-cli/git-diff.js */ }),
  gitLog:       tool({ /* wraps dist/dev-cli/git-log.js */ }),
  readFile:     tool({ /* wraps dist/dev-cli/read-file.js */ }),
  listFiles:    tool({ /* wraps dist/dev-cli/list-files.js */ }),
  searchCode:   tool({ /* wraps dist/dev-cli/search-code.js */ }),
  runTests:     tool({ /* wraps dist/dev-cli/run-tests.js */ }),
  checkTypes:   tool({ /* wraps dist/dev-cli/check-types.js */ }),
  deployStatus: tool({ /* wraps dist/dev-cli/deploy-status.js */ }),
};
```

### appendToMontyMemory (new function)
```typescript
type MontyMemoryFile = "decisions.md" | "incidents.md" | "architecture.md" | "security.md";

export async function appendToMontyMemory(
  file: MontyMemoryFile,
  entry: string,
): Promise<boolean> {
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
  const filePath = join(projectRoot, ".monty/memory", file);
  // Same logic as appendToMemory: check exists, enforce 200 lines, validate, append with timestamp
}
```

### Runner Memory Root Extension
```typescript
// In types.ts — add optional field
export interface AgentConfig {
  // ... existing fields
  memoryRoot?: string; // defaults to ".nova/memory"
}

// In runner.ts — pass memoryRoot through
memoryContext = await loadMemoryContext(options?.workspaceSlug, {
  memoryRoot: config.memoryRoot,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stub tools returning "not_implemented" | Real tool implementations calling runAgent / fs ops | Phase 64 (now) | Orchestrator becomes functional |
| Nova-only memory writes | Dual namespace (Nova + Monty) with separate write functions | Phase 64 (now) | Platform decisions persist across sessions |

## Open Questions

1. **Runner memoryRoot threading**
   - What we know: `runAgent()` defaults to `.nova/memory`. Monty Dev agent needs `.monty/memory`.
   - What's unclear: Whether to modify runner.ts (adds `memoryRoot` to AgentConfig) or handle it in the REPL entry point only.
   - Recommendation: Add `memoryRoot` to `AgentConfig` and thread it through `runAgent()`. This is a one-line change in runner.ts and keeps the pattern clean for all Monty agents. The orchestrator REPL already loads Monty memory in `scripts/monty.ts`, but the Dev agent spawned by `runAgent()` needs it too.

2. **Dev agent maxSteps**
   - What we know: Nova agents use 8-20 maxSteps. Dev agent does code exploration + changes.
   - What's unclear: How many steps a typical dev task needs.
   - Recommendation: Start with `maxSteps: 15` (same as Nova Leads agent, which also does multi-step work). Can be tuned later.

3. **Tier 2 logging timing**
   - What we know: Rules say "log action to decisions.md BEFORE executing" for Tier 2.
   - What's unclear: Whether the Dev agent should log before each tool call or in a single batch.
   - Recommendation: Let the system prompt instruct the agent to call a `logDecision` tool before executing Tier 2+ operations. This is a behavioral instruction, not a code gate.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ORCH-01 | Triage incoming work as bug/feature/improvement with severity/priority | System prompt taxonomy (Pattern 5). LLM classifies, no code logic. |
| ORCH-02 | Route to correct specialist via delegation tools | Replace stub execute functions with `runMontyDevAgent()` calls (Pattern 1). QA/Security stubs remain until Phases 65-66. |
| ORCH-03 | Maintain backlog in `.monty/memory/backlog.json` | `readBacklog` + `updateBacklog` tools using fs/promises (Pattern 2). BacklogItem schema defined. |
| ORCH-04 | Sequential quality pipeline enforcement | System prompt instruction: "After Dev agent completes, route to QA." QA/Security agents are stubs in Phase 64 — pipeline enforced in prompt, real execution in Phases 65-66. |
| ORCH-05 | Pre-approval gate for Tier 2+ operations | System prompt instruction: "For Tier 3 actions, state what will happen and wait for human approval." REPL provides human-in-the-loop. |
| ORCH-07 | AgentConfig with name, model, systemPrompt, tools, maxSteps, onComplete | Extend existing `montyOrchestratorConfig` with `onComplete` hook (Pattern 4). |
| ORCH-08 | onComplete writes session summary to decisions.md | `appendToMontyMemory("decisions.md", ...)` in onComplete hook. |
| DEV-01 | Backend work (API routes, Prisma, Trigger.dev) | Dev agent system prompt capabilities list + dev-cli tools for code inspection. |
| DEV-02 | Frontend/UI work (React, design system) | Dev agent system prompt + readFile/listFiles/searchCode tools. UI UX Pro Max skill referenced in rules. |
| DEV-03 | Infrastructure work (deploy, Railway, Vercel) | `deployStatus` tool + system prompt instructions. |
| DEV-04 | Action tier model (read-only/reversible/gated) | System prompt from monty-dev-rules.md already defines tiers. Tools are all Tier 1 (read-only). Tier 2+ actions happen via the orchestrator's approval gate. |
| DEV-05 | Memory-informed (reads decisions, incidents, architecture) | `loadMemoryContext()` with `memoryRoot: ".monty/memory"` via runner.ts `AgentConfig.memoryRoot` extension. |
| DEV-06 | Updates Nova rules/tools when platform changes affect agents | System prompt instruction + Dev agent can use readFile/searchCode to check Nova rules. Actual file edits are Tier 2 and logged. |
| DEV-08 | onComplete writes what changed and why to decisions.md | `appendToMontyMemory("decisions.md", ...)` in montyDevConfig.onComplete. |
| DEV-09 | Writes platform change notifications to `.nova/memory/global-insights.md` | `appendToGlobalMemory()` already exists and targets `.nova/memory/global-insights.md`. Call in onComplete when output indicates Nova impact. |
</phase_requirements>

## Sources

### Primary (HIGH confidence)
- `src/lib/agents/orchestrator.ts` — Nova orchestrator pattern (delegation tools, system prompt, tool surface)
- `src/lib/agents/runner.ts` — Agent runner (audit trail, memory loading, onComplete hooks)
- `src/lib/agents/types.ts` — AgentConfig interface, AgentRunResult, type patterns
- `src/lib/agents/research.ts` — Example specialist agent (tools, config, runAgent, onComplete)
- `src/lib/agents/memory.ts` — Memory read/write system (appendToMemory, loadMemoryContext, MemoryOptions)
- `src/lib/agents/monty-orchestrator.ts` — Current stub implementation (5 tools to replace)
- `scripts/monty.ts` — REPL entry point (memory loading, session persistence, multi-turn chat)
- `.claude/rules/monty-orchestrator-rules.md` — Orchestrator behavioral rules
- `.claude/rules/monty-dev-rules.md` — Dev agent behavioral rules
- `.monty/memory/backlog.json` — Current backlog schema (version 1, empty items array)

### Secondary (MEDIUM confidence)
- Phase 62 summaries (62-01, 62-02, 62-03) — Architecture decisions and patterns established
- Phase 63 summaries (63-01, 63-02) — Dev-cli tools and entry point implementation details

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new libraries, all patterns from existing codebase
- Architecture: HIGH — exact mirror of Nova agent pattern with minor namespace differences
- Pitfalls: HIGH — identified from Phase 62 auto-fix history (Zod v4, inputSchema) and code review

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable — internal codebase patterns, no external dependency risk)
