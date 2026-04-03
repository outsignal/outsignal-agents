# Phase 62: Architecture Foundation - Research

**Researched:** 2026-04-03
**Domain:** Agent architecture, memory namespacing, boundary enforcement, rules/tool scoping
**Confidence:** HIGH

## Summary

Phase 62 establishes the structural foundation for Monty (platform engineering agent team) as a parallel system to Nova (campaign operations agent team). The work is entirely within the existing codebase patterns -- no new libraries, no new architectural paradigms. Every component to be built has a direct analogue in the Nova system that can be used as a template.

The core challenge is not technical complexity but structural discipline: ensuring Monty's memory, rules, and tools are completely isolated from Nova's, while sharing the same underlying infrastructure (`runAgent()`, `loadMemoryContext()`, `loadRules()`). The existing `memory.ts` needs a single parameter addition (`memoryRoot`) to support Monty's `.monty/memory/` namespace. Rules files are plain markdown loaded by `loadRules()` which already supports any filename. Tool isolation is enforced by defining separate tool objects for each orchestrator -- TypeScript's type system makes accidental cross-references a compile-time error.

**Primary recommendation:** Follow the existing Nova patterns exactly. Every file created for Monty should mirror its Nova counterpart in structure, naming convention, and governance rules. The only new code is the `memoryRoot` parameter on `loadMemoryContext()` and the Monty memory seed script.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | `.monty/memory/` namespace with 5 seed files (backlog.json, decisions.md, incidents.md, architecture.md, security.md) | Mirror Nova's `.nova/memory/` pattern. Seed files use same governance headers. backlog.json is the only non-markdown file (structured JSON for machine parsing). |
| FOUND-02 | Memory seed script (`scripts/monty-memory.ts`) creates initial memory structure idempotently | Clone `scripts/nova-memory.ts` structure. Simpler: no DB queries needed (topic-based, not workspace-based). Idempotency via `fileExists()` check before write. |
| FOUND-03 | `loadMemoryContext()` accepts optional `memoryRoot` parameter (defaults to `.nova/memory`) | Single parameter addition to existing function signature. Default preserves backward compatibility. Monty passes `{ memoryRoot: ".monty/memory" }`. |
| FOUND-04 | `scripts/dev-cli/*.ts` tool wrapper directory exists with shared harness | Clone `scripts/cli/_cli-harness.ts` pattern. Dev CLI tools are read-heavy wrappers (git status, file read, search, type check, test run). |
| FOUND-05 | Rules files for all 4 Monty agents (orchestrator, dev, qa, security) | Create 4 files in `.claude/rules/`. Encode action tier model (T1 read-only, T2 reversible+logged, T3 gated+approval) and triage classification (bug/feature/improvement). |
| FOUND-06 | Boundary enforcement via tool scoping -- zero cross-contamination | Define `montyOrchestratorTools` in a new `src/lib/agents/monty-orchestrator.ts` that contains NONE of Nova's delegation tools. Nova's `orchestratorTools` already defined in `orchestrator.ts` -- verify it contains none of Monty's. |
| FOUND-07 | Both orchestrator system prompts reject misrouted tasks | Add boundary check section to both system prompts. Nova prompt rejects platform engineering tasks with "Route to Monty". Monty prompt rejects campaign/client tasks with "Route to Nova". |
| FOUND-08 | Boundary rejections written to memory | Rejected tasks logged to `.monty/memory/decisions.md` or `.nova/memory/global-insights.md` with rejection reason and routing suggestion. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | Existing | Agent execution via `generateText()` | Already used by all Nova agents via `runner.ts` |
| @ai-sdk/anthropic | Existing | Claude model provider | Already configured |
| zod | v4 (existing) | Input/output schema validation | Already used across all agent types |
| fs/promises | Node built-in | Memory file read/write | Already used by `memory.ts` and `nova-memory.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chalk | Existing | CLI output formatting | Seed script output, same as `nova-memory.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate memory module | Parameterize existing `memory.ts` | Parameterizing is better -- avoids code duplication, single source of truth for memory read/write logic |
| YAML for rules | Markdown (current) | Markdown is already the established pattern, loaded by `loadRules()` |
| JSON for all memory files | Mix of JSON + MD | backlog.json uses JSON for machine parsing (status tracking, priority sorting); everything else is markdown for human readability |

**Installation:**
No new packages required. Zero npm installs.

## Architecture Patterns

### Recommended Project Structure
```
.monty/
  memory/
    backlog.json          # Structured task backlog (JSON for machine parsing)
    decisions.md          # Session decisions log (append-only, ISO timestamps)
    incidents.md          # QA/security findings log (append-only)
    architecture.md       # Architecture patterns and conventions
    security.md           # Security findings and policies

.claude/rules/
    monty-orchestrator-rules.md  # PM orchestrator: triage, routing, approval gates
    monty-dev-rules.md           # Dev generalist: action tiers, memory reads
    monty-qa-rules.md            # QA: adversarial review, min findings
    monty-security-rules.md      # Security: OWASP, credential scanning

scripts/
    monty-memory.ts              # Seed script (mirrors nova-memory.ts)
    dev-cli/
        _cli-harness.ts          # Shared harness (mirrors scripts/cli/_cli-harness.ts)

src/lib/agents/
    monty-orchestrator.ts        # Monty orchestrator config + tools (parallel to orchestrator.ts)
    memory.ts                    # MODIFIED: add memoryRoot parameter
```

### Pattern 1: Memory Namespace Isolation
**What:** Both agent teams share the same `loadMemoryContext()` function but read from different root directories.
**When to use:** Always -- this is the core isolation mechanism.
**Example:**
```typescript
// Current signature (Nova default):
export async function loadMemoryContext(workspaceSlug?: string): Promise<string>

// New signature (backward compatible):
export async function loadMemoryContext(
  workspaceSlug?: string,
  options?: { memoryRoot?: string }
): Promise<string>

// Nova usage (unchanged):
const ctx = await loadMemoryContext("rise");

// Monty usage:
const ctx = await loadMemoryContext(undefined, { memoryRoot: ".monty/memory" });
```

The internal functions `loadCrossClientContext()` and `loadWorkspaceMemory()` need to accept `memoryRoot` and pass it through. Monty has no workspace-specific memory (topic-based instead), so `loadWorkspaceMemory` is skipped when no slug is provided.

### Pattern 2: Tool Surface Isolation
**What:** Each orchestrator has its own `*Tools` object with zero overlap in delegation tools.
**When to use:** Defining orchestrator configs.
**Example:**
```typescript
// orchestrator.ts (Nova) — existing, no changes needed
export const orchestratorTools = {
  delegateToResearch,
  delegateToLeads,
  delegateToWriter,
  delegateToCampaign,
  delegateToDeliverability,
  delegateToIntelligence,
  delegateToOnboarding,
  clientSweep,
  searchKnowledgeBase,
  ...dashboardTools,
};

// monty-orchestrator.ts (Monty) — NEW, completely separate
export const montyOrchestratorTools = {
  delegateToDevAgent,      // Monty-specific
  delegateToQA,            // Monty-specific
  delegateToSecurity,      // Monty-specific
  readBacklog,             // Monty-specific
  updateBacklog,           // Monty-specific
  // NO Nova delegation tools — hard boundary
};
```

### Pattern 3: Boundary Rejection with Memory Write
**What:** When an orchestrator receives a misrouted task, it rejects with explanation and logs the rejection.
**When to use:** In both orchestrator system prompts.
**Example:**
```typescript
// In Monty orchestrator system prompt:
`## Boundary Rules
You handle PLATFORM ENGINEERING work only: code, bugs, deploys, infrastructure, tests, security.
You do NOT handle: campaign operations, lead sourcing, copy writing, client onboarding, deliverability.

If a user asks you to do campaign/client work:
1. Reject the task with explanation
2. Suggest routing to Nova orchestrator
3. Log the rejection to .monty/memory/decisions.md

Example rejection: "This is campaign operations work (copy writing for Rise). Route to Nova orchestrator via scripts/chat.ts."
`
```

### Pattern 4: Action Tier Model in Rules Files
**What:** Three-tier permission model encoded in each Monty agent's rules file.
**When to use:** All Monty agent rules files.
**Example:**
```markdown
## Action Tiers

### Tier 1 — Read-Only (Autonomous)
- Read files, check types, run tests, git status/log/diff
- No approval needed, no logging required

### Tier 2 — Reversible (Logged)
- Edit files, create branches, install dev dependencies
- Log action to .monty/memory/decisions.md BEFORE executing
- Must be reversible (git revert, npm uninstall)

### Tier 3 — Gated (Explicit Approval)
- Database migrations, deploy to production, delete files/branches
- MUST state what will happen and wait for human "approve" before executing
- Log approval and outcome to .monty/memory/decisions.md
```

### Pattern 5: backlog.json Structure
**What:** Machine-parseable task backlog for cross-session state.
**When to use:** Monty orchestrator backlog management (ORCH-03, future phase).
**Example:**
```json
{
  "version": 1,
  "items": [
    {
      "id": "BL-001",
      "title": "Fix EmailBison pagination bug",
      "type": "bug",
      "severity": "high",
      "priority": 1,
      "status": "open",
      "createdAt": "2026-04-03T10:00:00Z",
      "updatedAt": "2026-04-03T10:00:00Z",
      "notes": "Reported during lead sync — page 2+ returns duplicates"
    }
  ]
}
```

### Anti-Patterns to Avoid
- **Shared tool objects:** NEVER import tools from `orchestrator.ts` into `monty-orchestrator.ts` or vice versa. Each file defines its own complete tool set.
- **Memory root hardcoding:** NEVER hardcode `.nova/memory` or `.monty/memory` in functions that should be parameterized. Use the `memoryRoot` parameter.
- **Soft boundary enforcement:** NEVER rely on "please don't do this" in system prompts alone. The tool surface is the hard boundary -- if a tool isn't in the tool list, the agent literally cannot call it.
- **Modifying Nova's orchestrator.ts:** Phase 62 should NOT change Nova's existing tool definitions or agent configs. The only change to Nova-adjacent code is adding the boundary rejection text to Nova's system prompt.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent execution | Custom LLM call wrapper | `runAgent()` from `runner.ts` | Handles audit trail, memory injection, schema validation, onComplete hooks |
| Memory read/write | Direct fs calls scattered across agents | `loadMemoryContext()` / `appendToMemory()` from `memory.ts` | Enforces line limits, ISO timestamps, validation, best-effort failure |
| Rules loading | Inline system prompt strings | `loadRules()` from `load-rules.ts` | Consistent path resolution, graceful fallback |
| File existence checks | try/catch on readFile | `fileExists()` helper (already in `nova-memory.ts`) | Clean pattern, copy to `monty-memory.ts` |

**Key insight:** Every infrastructure piece needed for Monty already exists in the Nova codebase. This phase is about parameterizing and extending, not building from scratch.

## Common Pitfalls

### Pitfall 1: Breaking Nova's loadMemoryContext Default Behavior
**What goes wrong:** Adding `memoryRoot` parameter changes the function signature in a way that breaks existing callers.
**Why it happens:** TypeScript optional parameters are safe at the type level but callers might depend on positional arguments.
**How to avoid:** Use an options object as the second parameter (not a positional string). `loadMemoryContext(slug)` continues to work unchanged. `loadMemoryContext(slug, { memoryRoot: ".monty/memory" })` adds Monty support.
**Warning signs:** Any Nova agent test or call site that passes more than one argument to `loadMemoryContext`.

### Pitfall 2: Seed Script Not Being Idempotent
**What goes wrong:** Running the seed script twice overwrites append-only files (decisions.md, incidents.md) and loses accumulated data.
**Why it happens:** Using `writeFile` without checking if the file already exists.
**How to avoid:** Follow Nova's pattern: `if (await fileExists(filePath)) return { created: false }`. Only `backlog.json` should be created fresh if missing; all `.md` files are append-only after creation.
**Warning signs:** Seed script creating files that already exist.

### Pitfall 3: Monty Orchestrator Stub Tools Blocking Future Phases
**What goes wrong:** Phase 62 defines delegation tool stubs (delegateToDevAgent, etc.) that don't actually work yet (Phase 63-64 implement them).
**Why it happens:** Over-engineering Phase 62 by trying to wire up full delegation before agents exist.
**How to avoid:** Phase 62 should define the `montyOrchestratorTools` object with STUB delegation tools that return `{ status: "not_implemented", message: "Dev Agent not yet built (Phase 64)" }`. This verifies the tool surface isolation (Success Criterion 4) without requiring working agents. Alternatively, Phase 62 can define only the non-delegation tools (readBacklog, updateBacklog) and add delegation tools in Phase 64.
**Warning signs:** Phase 62 plan includes "implement dev agent" tasks.

### Pitfall 4: Rules Files That Are Too Abstract
**What goes wrong:** Rules files contain vague guidance like "be careful with destructive operations" instead of concrete tier classifications.
**Why it happens:** Writing rules without specific examples and tool-level mappings.
**How to avoid:** Every rules file should list specific actions by tier. E.g., "Tier 1: git status, git log, git diff, cat, ls, npx tsc --noEmit, npx vitest run". Concrete, not abstract.
**Warning signs:** Rules file that doesn't mention specific CLI commands or tool names.

### Pitfall 5: Forgetting to Add Boundary Text to Nova's Prompt
**What goes wrong:** Nova orchestrator happily accepts platform engineering tasks because nobody told it about Monty.
**Why it happens:** Focus on building Monty without updating Nova.
**How to avoid:** Phase 62 must add a boundary section to Nova's `ORCHESTRATOR_SYSTEM_PROMPT` in `orchestrator.ts`. This is a small string append, not a structural change.
**Warning signs:** Success Criterion 5 failing -- Nova doesn't reject misrouted tasks.

## Code Examples

### loadMemoryContext Modification
```typescript
// src/lib/agents/memory.ts — MODIFIED signature

// New options type
interface MemoryOptions {
  memoryRoot?: string; // defaults to ".nova/memory"
}

// Updated internal constants
const DEFAULT_MEMORY_ROOT = ".nova/memory";

// Updated function — fully backward compatible
export async function loadMemoryContext(
  workspaceSlug?: string,
  options?: MemoryOptions,
): Promise<string> {
  const memoryRoot = options?.memoryRoot ?? DEFAULT_MEMORY_ROOT;
  try {
    const [systemCtx, crossClientCtx, workspaceCtx] = await Promise.all([
      loadSystemContext(),
      loadCrossClientContext(memoryRoot),      // pass memoryRoot
      workspaceSlug
        ? loadWorkspaceMemory(workspaceSlug, memoryRoot)  // pass memoryRoot
        : Promise.resolve(null),
    ]);
    return formatMemoryContext(systemCtx, crossClientCtx, workspaceCtx);
  } catch (error) {
    console.warn("[memory] Failed to load memory context:", error);
    return "";
  }
}
```

### Monty Memory Seed Script (Core Structure)
```typescript
// scripts/monty-memory.ts

const MEMORY_ROOT = ".monty/memory";

const SEED_FILES = {
  "backlog.json": JSON.stringify({ version: 1, items: [] }, null, 2),
  "decisions.md": `<!-- decisions.md | monty | seeded: ${isoDate()} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty — Decisions Log

(No decisions recorded yet)
`,
  "incidents.md": `<!-- incidents.md | monty | seeded: ${isoDate()} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty — Incidents & QA Findings

(No incidents recorded yet)
`,
  "architecture.md": `<!-- architecture.md | monty | seeded: ${isoDate()} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty — Architecture Patterns

(No patterns recorded yet)
`,
  "security.md": `<!-- security.md | monty | seeded: ${isoDate()} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty — Security Findings

(No security findings recorded yet)
`,
};

async function seed(): Promise<void> {
  await mkdir(MEMORY_ROOT, { recursive: true });
  for (const [filename, content] of Object.entries(SEED_FILES)) {
    const filePath = join(MEMORY_ROOT, filename);
    if (await fileExists(filePath)) {
      console.log(`  ${filename} (skipped — already exists)`);
      continue;
    }
    await writeFile(filePath, content, "utf8");
    console.log(`  ${filename} (created)`);
  }
}
```

### Boundary Rejection Text (Nova Side)
```typescript
// Append to ORCHESTRATOR_SYSTEM_PROMPT in orchestrator.ts

const BOUNDARY_CHECK = `
## Team Boundary

You are the NOVA orchestrator — you handle CAMPAIGN OPERATIONS only:
client management, lead sourcing, copy writing, campaigns, deliverability, intelligence, onboarding.

You do NOT handle: code changes, bug fixes, deployments, infrastructure, test writing, security audits.
These are PLATFORM ENGINEERING tasks handled by the Monty orchestrator.

If a user asks you to do platform engineering work:
1. Explain that this is platform engineering work
2. Suggest routing to Monty via: npx tsx scripts/monty.ts
3. Do NOT attempt the task yourself
`;
```

### Dev CLI Harness Pattern
```typescript
// scripts/dev-cli/_cli-harness.ts — mirrors scripts/cli/_cli-harness.ts

interface CliResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export function cliResult(data: unknown): never {
  const result: CliResult = { ok: true, data };
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

export function cliError(message: string): never {
  const result: CliResult = { ok: false, error: message };
  process.stdout.write(JSON.stringify(result));
  process.exit(1);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single agent team (Nova) | Dual agent teams (Nova + Monty) | v9.0 (this milestone) | Prevents PM bypass (2026-04-02 incident), enforces structural boundaries |
| Hardcoded `.nova/memory` root | Parameterized `memoryRoot` | Phase 62 | Enables multiple agent teams sharing same memory infrastructure |
| Soft rules for boundary enforcement | Tool surface isolation (hard) + prompt rejection (soft) + memory logging | Phase 62 | Two-layer enforcement: agents literally cannot call tools they don't have |

**Deprecated/outdated:**
- None. This is net-new architecture building on stable patterns.

## Open Questions

1. **Monty memory write functions**
   - What we know: Nova has `appendToMemory(slug, file, entry)` and `appendToGlobalMemory(entry)` — both hardcode `.nova/memory`
   - What's unclear: Should Monty use separate write functions (`appendToMontyMemory`) or should the existing functions be parameterized?
   - Recommendation: Parameterize the existing functions with an optional `memoryRoot` parameter, matching the read-side change. Avoids code duplication. `appendToMemory` is workspace-scoped (Monty doesn't use workspaces), so Monty would use `appendToMontyFile(file, entry)` -- a thin wrapper around a parameterized base function.

2. **Monty orchestrator tools in Phase 62 vs Phase 64**
   - What we know: Success Criterion 4 requires Monty's tool list to exist and contain zero Nova tools
   - What's unclear: Should Phase 62 define stub delegation tools (delegateToDevAgent, etc.) or just the backlog tools?
   - Recommendation: Define stub tools that return "not implemented" messages. This satisfies the inspection criterion and establishes the tool surface boundary. Phase 64 replaces stubs with real implementations.

3. **Cross-team memory write paths (FOUND-09/FOUND-10)**
   - What we know: These are assigned to Phase 67, not Phase 62
   - What's unclear: Should Phase 62 memory functions already support cross-team writes?
   - Recommendation: No. Phase 62 sets up the namespace. Phase 67 adds cross-team notification writes. Keep scope tight.

## Sources

### Primary (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/memory.ts` — Current memory implementation, line-by-line analysis
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/orchestrator.ts` — Nova orchestrator tools and config, verified tool list
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — Agent execution engine, `loadMemoryContext` call site
- `/Users/jjay/programs/outsignal-agents/scripts/nova-memory.ts` — Seed script pattern, idempotency implementation
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/load-rules.ts` — Rules loading mechanism
- `/Users/jjay/programs/outsignal-agents/scripts/chat.ts` — CLI entry point pattern for interactive sessions

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — Requirement definitions for FOUND-01 through FOUND-08
- `.planning/STATE.md` — Pre-milestone decisions (4 agents, tool-surface boundary, action tiers, topic-based memory)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries, everything already exists in codebase
- Architecture: HIGH - Direct mirror of Nova patterns, thoroughly inspected
- Pitfalls: HIGH - Based on actual codebase analysis (function signatures, file patterns, governance rules)

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable patterns, no external dependencies)
