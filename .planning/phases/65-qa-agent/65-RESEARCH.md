# Phase 65: QA Agent - Research

**Researched:** 2026-04-03
**Domain:** Agent architecture (AI SDK + dev-cli tooling for adversarial code review)
**Confidence:** HIGH

## Summary

The QA agent is the third Monty team member. It follows the exact same architecture as the Dev agent (monty-dev.ts): an AgentConfig with tools wrapping dev-cli scripts via `runDevCli()`, a typed output schema, an `onComplete` hook for memory write-back, and a `runMontyQAAgent()` export that the orchestrator calls.

The orchestrator already has a `delegateToQA` stub (monty-orchestrator.ts lines 44-58) that accepts `{ task, changedFiles }` and returns `{ status: "not_implemented" }`. Phase 65 replaces this stub with a real delegation to the QA agent, identical to how `delegateToDevAgent` wraps `runMontyDevAgent`.

The QA agent's tools are a subset of the existing dev-cli scripts (git-diff, search-code, check-types, run-tests, read-file, list-files) plus no new scripts are needed. Dead code detection (QA-05) is achievable by combining `search-code` (grep for exports) with `search-code` (grep for imports of those exports) — no new tooling required.

**Primary recommendation:** Create `src/lib/agents/monty-qa.ts` following the monty-dev.ts pattern exactly. Define `MontyQAInput`, `MontyQAOutput`, `montyQAOutputSchema` in types.ts. Replace the delegateToQA stub in monty-orchestrator.ts. Wire onComplete to write incidents to `.monty/memory/incidents.md` and cross-team findings to `.nova/memory/global-insights.md`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QA-01 | Code review: TypeScript compilation check, pattern consistency, banned pattern detection | Existing `check-types` dev-cli tool runs `tsc --noEmit`. Pattern consistency + banned patterns handled via `search-code` tool + system prompt instructions. All Tier 1 read-only. |
| QA-02 | Adversarial review: minimum 3 findings per review, actively looks for problems | Enforced in system prompt (same as monty-qa-rules.md). Output schema requires `findings` array. System prompt instructs: if < 3 genuine findings, provide explicit justification. |
| QA-03 | Test validation: run vitest, verify changes don't break existing functionality | Existing `run-tests` dev-cli tool runs `npx vitest run`. QA agent calls it with the changed file paths from the orchestrator's `changedFiles` parameter. |
| QA-04 | Review API integrations for pagination, error handling, rate limit compliance | System prompt instruction in the QA agent. Uses `read-file` + `search-code` to inspect API client code. No new tooling needed — this is an LLM review capability. |
| QA-05 | Detect dead code paths: endpoints with no callers, functions with no imports | Combination of `search-code` calls: (1) find all `export` declarations, (2) search for imports of each export. Agent logic identifies exports with zero importers. System prompt provides the methodology. |
| QA-06 | AgentConfig with review tools | Create `montyQAConfig: AgentConfig` in `monty-qa.ts` with selected dev-cli tools. Same pattern as `montyDevConfig`. |
| QA-07 | onComplete writes review findings to `.monty/memory/incidents.md` if issues found | `appendToMontyMemory("incidents.md", ...)` already exists in memory.ts. onComplete hook filters for findings with severity critical/high and writes them. |
| QA-08 | Writes to `.nova/memory/global-insights.md` when QA findings affect Nova agent behaviour | `appendToGlobalMemory(...)` already exists in memory.ts. onComplete hook checks `affectsNova` field in output and writes cross-team notification. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (AI SDK) | v6 | `tool()`, `generateText()`, agent execution | Already used by all agents in the project |
| zod | v4 | Input/output schema validation | Already used project-wide, `z.record(z.string(), z.unknown())` for AI SDK v6 compat |
| child_process | Node built-in | `execSync` for dev-cli script wrappers | Same pattern as monty-dev.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fs/promises | Node built-in | Memory file operations | Used by memory.ts utilities already |

### Alternatives Considered
None — zero new packages required. This phase uses exclusively existing infrastructure.

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/lib/agents/
├── monty-qa.ts          # NEW: QA agent config, tools, run wrapper
├── monty-dev.ts         # EXISTING: Pattern to follow
├── monty-orchestrator.ts # MODIFIED: Replace delegateToQA stub
├── types.ts             # MODIFIED: Add MontyQAInput, MontyQAOutput, montyQAOutputSchema
├── memory.ts            # EXISTING: appendToMontyMemory, appendToGlobalMemory
├── runner.ts            # EXISTING: runAgent<TOutput>
└── load-rules.ts        # EXISTING: loadRules("monty-qa-rules.md")
```

### Pattern 1: Agent Config (from monty-dev.ts)
**What:** Every Monty agent follows the same structure: tools object, system prompt with loadRules(), AgentConfig export, runWrapper export.
**When to use:** Always — this is the established pattern.
**Example:**
```typescript
// Pattern from monty-dev.ts (verified in codebase)
export const montyQAConfig: AgentConfig = {
  name: "monty-qa",
  model: NOVA_MODEL,
  systemPrompt: MONTY_QA_SYSTEM_PROMPT,
  tools: montyQATools,
  maxSteps: 15,
  memoryRoot: ".monty/memory",
  outputSchema: montyQAOutputSchema,
  onComplete: async (result, _options) => { /* ... */ },
};
```

### Pattern 2: Delegation Wrapper (from monty-orchestrator.ts)
**What:** Orchestrator delegation tools wrap `runMontyXAgent()` with try/catch returning `{ status: "complete"|"failed", ... }`.
**When to use:** When the orchestrator calls a specialist agent.
**Example:**
```typescript
// Pattern from delegateToDevAgent (verified in codebase lines 14-40)
const delegateToQA = tool({
  description: "...",
  inputSchema: z.object({
    task: z.string(),
    changedFiles: z.array(z.string()).optional(),
  }),
  execute: async ({ task, changedFiles }) => {
    try {
      const result = await runMontyQAAgent({ task, changedFiles });
      return { status: "complete", ...result };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "QA Agent failed" };
    }
  },
});
```

### Pattern 3: Output Schema (from types.ts)
**What:** Every agent has a Zod output schema for runtime validation. Runner.ts uses `safeParse` with graceful degradation.
**When to use:** Always define one for structured agent output.
**Example:**
```typescript
// QA-specific output schema
export const montyQAOutputSchema = z.object({
  reviewSummary: z.string(),
  findings: z.array(z.object({
    file: z.string(),
    line: z.number().optional(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    category: z.enum(["type-error", "test-failure", "dead-code", "pattern-inconsistency", "missing-test", "performance", "api-integration"]),
    description: z.string(),
    suggestion: z.string(),
  })),
  testsRun: z.boolean(),
  testsPassed: z.boolean().optional(),
  testDetails: z.string().optional(),
  affectsNova: z.boolean(),
  novaNotification: z.string().optional(),
});
```

### Anti-Patterns to Avoid
- **Adding new dev-cli scripts for QA**: The existing 9 scripts cover all QA needs. Do not create `dead-code-detect.js` or `pattern-check.js` — the LLM handles this reasoning using search-code + read-file.
- **Making QA a Tier 2+ agent**: QA is strictly read-only (Tier 1). It should never modify files. All QA actions are observation/reporting.
- **Sharing tools between Dev and QA**: Export the tools object from each agent module separately, even if they wrap the same dev-cli scripts. This maintains clean tool surfaces per agent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript type checking | Custom AST parser | `check-types.js` (wraps `tsc --noEmit`) | tsc is authoritative |
| Test execution | Custom test runner | `run-tests.js` (wraps `vitest run`) | vitest handles all edge cases |
| Dead code detection | Export/import graph builder | `search-code.js` with grep patterns | LLM can reason about grep results; building a proper import graph is overkill |
| Memory writes | Direct fs operations | `appendToMontyMemory()` / `appendToGlobalMemory()` | Handles validation, line limits, timestamps |

**Key insight:** The QA agent is an LLM reviewing code through read-only tools. The "intelligence" is in the system prompt and model reasoning, not in custom tooling. All infrastructure already exists.

## Common Pitfalls

### Pitfall 1: Rubber-Stamping
**What goes wrong:** QA agent returns "LGTM, no issues found" on most reviews, providing no value.
**Why it happens:** Default LLM behaviour is to be agreeable. Without explicit adversarial instructions, the model confirms rather than challenges.
**How to avoid:** System prompt enforces minimum 3 findings per review. Output schema requires the `findings` array. If fewer than 3, require a `justification` string explaining what was checked.
**Warning signs:** Reviews consistently returning exactly 0-1 findings.

### Pitfall 2: False Positives Flooding
**What goes wrong:** QA agent flags stylistic nitpicks and theoretical issues to hit the 3-finding minimum, creating noise.
**Why it happens:** Minimum finding requirement creates pressure to invent issues.
**How to avoid:** System prompt categorises finding severity. The orchestrator filters: only critical/high findings block progress. Medium/low/info are logged but don't require action. The 3-finding minimum can include info-level observations.
**Warning signs:** Most findings are "info" severity with vague descriptions.

### Pitfall 3: Test Execution Timeout
**What goes wrong:** `vitest run` hangs or takes > 60 seconds, exhausting agent steps.
**Why it happens:** Running the full test suite when only specific files changed.
**How to avoid:** Pass specific test file paths to `run-tests.js --path`. The orchestrator provides `changedFiles` — the QA agent should identify affected test files and run only those.
**Warning signs:** Agent using maxSteps on a single test execution step.

### Pitfall 4: Dead Code False Positives
**What goes wrong:** QA flags exports that ARE used (via dynamic imports, re-exports, or external consumers) as dead code.
**Why it happens:** Simple grep for import statements misses dynamic `import()`, barrel file re-exports, and runtime references.
**How to avoid:** System prompt instructs: only flag exports as dead code if (a) not imported anywhere in `src/`, `scripts/`, `trigger/` AND (b) not exported from a barrel/index file. When uncertain, use "info" severity.
**Warning signs:** QA flagging API route handlers or CLI scripts as "dead code".

### Pitfall 5: Memory Write Boundary Violation
**What goes wrong:** QA agent writes to `.monty/memory/decisions.md` or other files outside its governance scope.
**Why it happens:** The model sees the appendToMontyMemory function and tries to be helpful.
**How to avoid:** QA agent's onComplete hook ONLY writes to `incidents.md` and `global-insights.md`. The system prompt explicitly lists which files are writable (from monty-qa-rules.md). Tool surface does NOT include a generic memory write tool.
**Warning signs:** Entries in decisions.md or architecture.md attributed to QA.

## Code Examples

### QA Agent Input/Output Types
```typescript
// Source: Pattern from types.ts MontyDevInput/MontyDevOutput
export interface MontyQAInput {
  task: string;
  changedFiles?: string[]; // File paths from orchestrator
}

export interface MontyQAFinding {
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "type-error" | "test-failure" | "dead-code" | "pattern-inconsistency" | "missing-test" | "performance" | "api-integration";
  description: string;
  suggestion: string;
}

export interface MontyQAOutput {
  reviewSummary: string;
  findings: MontyQAFinding[];
  testsRun: boolean;
  testsPassed?: boolean;
  testDetails?: string;
  affectsNova: boolean;
  novaNotification?: string;
}
```

### onComplete Hook Pattern
```typescript
// Source: Pattern from monty-dev.ts onComplete (lines 259-277)
onComplete: async (result, _options) => {
  const output = result.output as MontyQAOutput;

  // Write critical/high findings to incidents.md (QA-07)
  const significantFindings = output?.findings?.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  if (significantFindings?.length) {
    const summary = significantFindings
      .map((f) => `[${f.severity}] ${f.file}: ${f.description}`)
      .join("; ");
    await appendToMontyMemory("incidents.md", `QA Review: ${summary}`);
  }

  // Cross-team notification (QA-08)
  if (output?.affectsNova && output?.novaNotification) {
    await appendToGlobalMemory(`[Monty QA] ${output.novaNotification}`);
  }
},
```

### Orchestrator Delegation Replacement
```typescript
// Replace the stub at monty-orchestrator.ts lines 44-58
// Source: delegateToDevAgent pattern (lines 14-40)
const delegateToQA = tool({
  description: "Delegate a code review or quality check to the QA Agent.",
  inputSchema: z.object({
    task: z.string().describe("What the QA Agent should review"),
    changedFiles: z.array(z.string()).optional().describe("File paths that changed"),
  }),
  execute: async ({ task, changedFiles }) => {
    try {
      const result = await runMontyQAAgent({ task, changedFiles });
      return {
        status: "complete" as const,
        reviewSummary: result.reviewSummary,
        findings: result.findings,
        testsRun: result.testsRun,
        testsPassed: result.testsPassed,
        affectsNova: result.affectsNova,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        error: error instanceof Error ? error.message : "QA Agent failed",
      };
    }
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| QA stub returns "not_implemented" | Real delegation to QA agent | Phase 65 (this phase) | Orchestrator quality pipeline becomes functional |
| Quality Pipeline logs intent to backlog | Quality Pipeline actually routes Dev -> QA | Phase 65 | Automated code review on every dev task |

**Deprecated/outdated:**
- The `delegateToQA` stub in monty-orchestrator.ts (lines 44-58) is replaced by this phase.
- The orchestrator system prompt note "QA and Security agents are not yet built" (line 239) should be updated to reflect QA is now built.

## Open Questions

1. **maxSteps for QA agent**
   - What we know: Dev agent uses 15 steps. QA needs: check-types (1 step), run-tests (1 step), read changed files (N steps), search for dead code (N steps). Typical review of 3-5 files needs ~10-12 steps.
   - What's unclear: Whether 15 is sufficient for large changesets.
   - Recommendation: Use 15 (same as Dev). If reviews hit step limit, increase in a follow-up.

2. **Orchestrator system prompt update**
   - What we know: Lines 237-239 say "QA and Security agents are not yet built (Phases 65-66). Log the pipeline intent to the backlog."
   - What's unclear: Whether to update this to "QA Agent is operational. Security Agent not yet built (Phase 66)." in this phase or Phase 66.
   - Recommendation: Update in this phase — remove the caveat about QA since it's now real. Keep the Security note.

## Sources

### Primary (HIGH confidence)
- `src/lib/agents/monty-dev.ts` — Full agent implementation pattern (tools, config, onComplete, run wrapper)
- `src/lib/agents/monty-orchestrator.ts` — delegateToQA stub (lines 44-58), delegateToDevAgent pattern (lines 14-40)
- `src/lib/agents/types.ts` — AgentConfig interface, MontyDevInput/Output pattern, montyDevOutputSchema pattern
- `src/lib/agents/runner.ts` — runAgent execution engine, output schema validation, audit logging
- `src/lib/agents/memory.ts` — appendToMontyMemory, appendToGlobalMemory, MontyMemoryFile type
- `.claude/rules/monty-qa-rules.md` — QA rules (finding format, minimum findings rule, action tiers, memory governance)
- `scripts/dev-cli/` — 9 existing CLI tools (all Tier 1 read-only)

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — QA-01 through QA-08 requirement definitions
- `.planning/phases/64-orchestrator-dev-generalist/64-02-SUMMARY.md` — Dev agent implementation summary
- `.planning/phases/64-orchestrator-dev-generalist/64-03-SUMMARY.md` — Orchestrator implementation summary

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages, all existing infrastructure
- Architecture: HIGH — exact pattern established by monty-dev.ts, verified in codebase
- Pitfalls: HIGH — adversarial review is a known LLM challenge with established mitigations

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable — no external dependencies)
