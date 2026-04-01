# Phase 59: Agent Memory Read System - Research

**Researched:** 2026-04-01
**Domain:** Agent memory context injection / system prompt construction
**Confidence:** HIGH

## Summary

This phase fixes a clear gap: agents write to `.nova/memory/{slug}/` files but never read them back. The write side (Phase 54.1) is working. The codebase has a clean, consistent pattern across all 5 agents (orchestrator, writer, leads, campaign, research) where system prompts are built statically at module load time using `const X_SYSTEM_PROMPT = ...` + `loadRules()`. The `runAgent()` function in `runner.ts` passes `config.systemPrompt` directly to `generateText()` with no injection point for dynamic context.

The fix is straightforward: add read functions to `memory.ts`, modify `runner.ts` to merge static prompt + dynamic memory before calling `generateText()`, and ensure workspace slug flows through to all agent invocations. The architecture is well-suited to this change because all agents already receive `workspaceSlug` via the `options` parameter in `runAgent()`.

**Primary recommendation:** Add `readMemoryContext()` functions to `memory.ts`, inject memory into the system prompt inside `runner.ts` (not in each agent config), and use XML-style tags to clearly delimit memory sections from rules.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Memory Architecture -- 3 Layers:** Every agent session loads: (1) System-wide MEMORY.md from Claude Code memory, (2) Cross-client `.nova/memory/global-insights.md`, (3) Workspace-specific files (learnings.md, campaigns.md, feedback.md, profile.md). Priority: workspace overrides cross-client overrides system.
- **Dynamic System Prompts:** Must change from static `const X_SYSTEM_PROMPT` to dynamic per-session construction: static rules + injected memory context. `runAgent()` in `runner.ts` handles the merge.
- **Memory Loading Approach:** Memory loaded at agent startup, NOT via tool calls. System-wide + cross-client loaded once when orchestrator starts. Workspace memory loaded when slug is known. Injected into system prompt section.
- **Context Window Protection:** Truncate individual memory files if over 200 lines (configurable). Total memory context should not exceed ~2000 tokens across all 3 layers. Keep most recent entries if truncation needed. Log warning if truncation occurs.
- **Graceful Degradation:** Missing files = empty context (not error). Malformed files = skip + log warning. MEMORY.md not found = proceed without.

### Claude's Discretion
- Exact format of memory injection in system prompt (markdown sections, XML tags, etc.)
- Whether to use a single `loadAllContext()` function or separate functions per layer
- How to handle orchestrator vs specialist agent context loading
- Whether workspace memory is loaded by orchestrator and passed to delegates, or each specialist agent loads its own

### Deferred Ideas (OUT OF SCOPE)
- Memory archiving/rotation when files get too large
- Memory search/retrieval (semantic search over past learnings)
- Inter-agent memory sharing within a session (agent A writes, agent B reads in same session)
- Memory versioning/history
- Admin UI for reviewing/editing agent memory
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEMORY-READ-01 | Load 3-layer memory context (system-wide + cross-client + workspace) into agent system prompts at session start | Architecture patterns section: `loadMemoryContext()` in memory.ts, injection point in runner.ts `runAgent()` |
| MEMORY-READ-02 | Protect context window with truncation (200-line per file, ~2000 token total cap) and graceful degradation (missing/malformed files handled without crashing) | Context window protection section: line-based truncation keeping recent entries, try/catch per file |
| MEMORY-READ-03 | Clean up existing malformed memory entries (1210-solutions "undefined: undefined", global-insights.md nonsensical 310.6% reply rate) and validate `appendToMemory()` prevents future malformed writes | Data cleanup section: specific files identified, entry validation pattern for appendToMemory |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js fs/promises | Built-in | Read memory files from disk | Already used by `memory.ts` for write operations |
| path | Built-in | Resolve memory file paths | Already used by `memory.ts` |
| ai (Vercel AI SDK) | Current | `generateText()` with system prompt | Already the core of `runner.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| N/A | - | - | No new dependencies needed |

**No new packages required.** This phase uses only Node.js built-ins and the existing Vercel AI SDK.

## Architecture Patterns

### Current Architecture (What Exists)

```
src/lib/agents/
  memory.ts          # appendToMemory() only (write-side)
  runner.ts          # runAgent() - passes config.systemPrompt directly to generateText()
  load-rules.ts      # loadRules() - reads .claude/rules/*.md files synchronously
  types.ts           # AgentConfig interface with systemPrompt: string
  orchestrator.ts    # Static ORCHESTRATOR_SYSTEM_PROMPT + loadRules("campaign-rules.md")
  writer.ts          # Static WRITER_SYSTEM_PROMPT + loadRules("writer-rules.md")
  leads.ts           # Static LEADS_SYSTEM_PROMPT + loadRules("leads-rules.md")
  campaign.ts        # Static CAMPAIGN_SYSTEM_PROMPT + loadRules("campaign-rules.md")
  research.ts        # Static RESEARCH_SYSTEM_PROMPT + loadRules("research-rules.md")
```

**Key observation:** All agents follow the exact same pattern:
1. Static system prompt string defined at module load time
2. Rules loaded via `loadRules()` (synchronous, also at module load time)
3. `runAgent()` receives the config object with the static prompt
4. `runAgent()` passes `config.systemPrompt` to `generateText({ system: ... })`

### Target Architecture (What to Build)

```
src/lib/agents/
  memory.ts          # appendToMemory() + loadMemoryContext() + helpers
  runner.ts          # runAgent() - merges config.systemPrompt + memory context
  (all other files unchanged in structure)
```

### Pattern 1: Centralized Memory Injection in runner.ts
**What:** `runAgent()` loads memory context and appends it to `config.systemPrompt` before calling `generateText()`. No changes needed to individual agent config files.
**When to use:** Always -- this is the recommended approach.
**Why:** Single injection point means one place to maintain, one place to truncate, one place to debug. Agent configs remain clean static definitions.

```typescript
// In runner.ts
export async function runAgent<TOutput = unknown>(
  config: AgentConfig,
  userMessage: string,
  options?: {
    triggeredBy?: string;
    workspaceSlug?: string;
  },
): Promise<AgentRunResult<TOutput>> {
  // Load memory context (async, best-effort)
  const memoryContext = await loadMemoryContext(options?.workspaceSlug);
  
  // Merge: static prompt + dynamic memory
  const systemPrompt = memoryContext
    ? `${config.systemPrompt}\n\n${memoryContext}`
    : config.systemPrompt;

  // ... rest of runAgent unchanged, but use systemPrompt instead of config.systemPrompt
  const result = await generateText({
    model: anthropic(config.model),
    system: systemPrompt,  // <-- dynamic now
    // ...
  });
}
```

### Pattern 2: Memory Context Format (XML Tags)
**What:** Use XML-style tags to clearly delimit memory sections so agents can distinguish rules from contextual memory.
**Why:** XML tags are well-understood by Claude models as section delimiters. They create unambiguous boundaries between static rules and dynamic context.

```typescript
function formatMemoryContext(
  systemContext: string | null,
  crossClientContext: string | null,
  workspaceContext: string | null,
): string {
  const sections: string[] = [];
  
  if (systemContext) {
    sections.push(`<system_memory>
## System State & Infrastructure
${systemContext}
</system_memory>`);
  }
  
  if (crossClientContext) {
    sections.push(`<cross_client_memory>
## Cross-Client Patterns
${crossClientContext}
</cross_client_memory>`);
  }
  
  if (workspaceContext) {
    sections.push(`<workspace_memory>
## Workspace History & Learnings
${workspaceContext}
</workspace_memory>`);
  }
  
  if (sections.length === 0) return "";
  
  return `\n\n<agent_memory>
The following is your persistent memory from previous sessions. Use it to inform your decisions but prioritize workspace-specific memory over cross-client patterns, and cross-client patterns over system state.

${sections.join("\n\n")}
</agent_memory>`;
}
```

### Pattern 3: Per-File Reading with Truncation
**What:** Read each memory file independently with line-based truncation, keeping the most recent entries (bottom of file).
**Why:** Memory files are append-only with newest entries at the bottom. Truncating from the top preserves the most relevant recent entries.

```typescript
async function readMemoryFile(
  filePath: string,
  maxLines: number = 200,
): Promise<string | null> {
  try {
    await access(filePath, constants.F_OK);
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n");
    
    if (lines.length > maxLines) {
      console.warn(`[memory] Truncating ${filePath}: ${lines.length} lines -> ${maxLines}`);
      // Keep header (first 3 lines typically contain HTML comments + title)
      // + most recent entries from the bottom
      const header = lines.slice(0, 3);
      const recent = lines.slice(-(maxLines - 3));
      return [...header, "<!-- truncated: older entries removed -->", ...recent].join("\n");
    }
    
    return content.trim() || null;
  } catch {
    // File doesn't exist or can't be read -- graceful degradation
    return null;
  }
}
```

### Pattern 4: Workspace Memory Aggregation
**What:** Combine all 4 workspace memory files (profile.md, learnings.md, campaigns.md, feedback.md) into a single workspace context string.
**Why:** The agent needs all workspace context in one block, and we need to enforce the total token budget across all files.

```typescript
async function loadWorkspaceMemory(slug: string): Promise<string | null> {
  const root = process.env.PROJECT_ROOT ?? process.cwd();
  const dir = join(root, MEMORY_ROOT, slug);
  
  const files = ["profile.md", "learnings.md", "campaigns.md", "feedback.md"];
  const sections: string[] = [];
  
  for (const file of files) {
    const content = await readMemoryFile(join(dir, file));
    if (content) sections.push(content);
  }
  
  return sections.length > 0 ? sections.join("\n\n---\n\n") : null;
}
```

### Anti-Patterns to Avoid
- **Loading memory via tool calls during execution:** Wastes model steps and tokens. Memory should be pre-loaded into the system prompt.
- **Modifying individual agent config files:** Would require changes to 5 files instead of 1 central point in runner.ts.
- **Loading MEMORY.md at module import time:** MEMORY.md is 238 lines and should be loaded per-invocation, not cached at module init (it changes between sessions).
- **Passing memory through the user message:** Memory is context, not user input. It belongs in the system prompt.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File reading | Custom stream reader | `fs/promises.readFile` | Files are small (<200 lines), no streaming needed |
| Token counting | Token counter library | Line-based truncation | Approximate token count from line count is sufficient for ~2000 token budget; 1 line ~ 10-15 tokens |
| Memory caching | In-memory cache | Fresh read per invocation | Memory files change between sessions; caching adds complexity for no benefit |

## Common Pitfalls

### Pitfall 1: MEMORY.md Path Resolution
**What goes wrong:** The MEMORY.md file is at an absolute path (`/Users/jjay/.claude/projects/-Users-jjay-programs/memory/MEMORY.md`) outside the project directory. Using `process.cwd()` or `PROJECT_ROOT` won't find it.
**Why it happens:** MEMORY.md is a Claude Code feature, stored in the user's home directory, not in the project.
**How to avoid:** Use a dedicated config constant or environment variable for the MEMORY.md path. Consider using `~/.claude/projects/-Users-jjay-programs/memory/MEMORY.md` resolved via `os.homedir()`, or make it configurable. IMPORTANT: In production (Vercel), this file won't exist -- graceful degradation is critical.
**Warning signs:** `readFile` throws ENOENT on deployed environments.

### Pitfall 2: Blocking the Event Loop with Sync Reads
**What goes wrong:** Using `readFileSync` for memory loading would block the Node.js event loop during agent startup.
**Why it happens:** The existing `loadRules()` uses `readFileSync` because it runs at module load time. Memory loading runs per-invocation.
**How to avoid:** Use async `readFile` from `fs/promises` (already imported in memory.ts). `runAgent()` is already async.
**Warning signs:** Using `readFileSync` anywhere in the new code.

### Pitfall 3: Token Budget Overflow
**What goes wrong:** System-wide MEMORY.md alone is 238 lines (~2500+ tokens). Loading it in full plus workspace memory would blow the ~2000 token budget.
**Why it happens:** MEMORY.md contains extensive project state -- far more than agents need.
**How to avoid:** For MEMORY.md, extract only the most relevant sections (infrastructure state, client roster, terminology rules, deploy rules). Consider a summarized/condensed version or selecting specific sections. Alternatively, raise the token budget since the locked decision says "Load the ENTIRE file, not condensed" -- in that case, accept the larger context window usage.
**Warning signs:** Total memory context exceeding 4000+ tokens.

### Pitfall 4: Memory Files with Only Seed Templates
**What goes wrong:** Most workspace memory files contain only seed template text (comments + "(No X recorded yet)"). Injecting these adds noise without value.
**Why it happens:** Memory files are seeded with templates but most have no real entries yet.
**How to avoid:** After reading a file, check if it contains only seed content (no timestamped entries). If so, treat as empty/null. Look for the pattern `[20` (ISO date prefix) to detect real entries.
**Warning signs:** Agent context filled with "(No ICP learnings recorded yet)" boilerplate.

### Pitfall 5: Production Environment (Vercel)
**What goes wrong:** `.nova/memory/` files exist in the git repo and deploy to Vercel's read-only filesystem, but MEMORY.md at the Claude Code path does not exist on Vercel.
**Why it happens:** MEMORY.md is a local development artifact. `.nova/memory/` is committed to git.
**How to avoid:** All three layers must use graceful degradation. MEMORY.md will be null in production -- that's fine. `.nova/memory/` files will be present but read-only on Vercel (writes handled separately; this phase is read-only).
**Warning signs:** Crashes on Vercel deployment due to missing MEMORY.md.

### Pitfall 6: Malformed Data in Existing Files
**What goes wrong:** `global-insights.md` contains nonsensical data (310.6% reply rate, 0% open rates). `1210-solutions` reportedly has "undefined: undefined" entries.
**Why it happens:** Validation test data was written during Phase 54.1 development without cleanup.
**How to avoid:** (1) Clean up existing files as part of this phase. (2) Add input validation to `appendToMemory()` to reject entries containing "undefined" or obviously malformed data.
**Warning signs:** Agent making decisions based on 310% reply rates.

## Code Examples

### Example 1: Complete loadMemoryContext Function
```typescript
// Source: Derived from existing memory.ts patterns + CONTEXT.md requirements
import { readFile, access } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { homedir } from "os";

const MEMORY_ROOT = ".nova/memory";
const MAX_LINES_PER_FILE = 200;
const MEMORY_MD_PATH = join(
  homedir(),
  ".claude/projects/-Users-jjay-programs/memory/MEMORY.md"
);

export async function loadMemoryContext(
  workspaceSlug?: string,
): Promise<string | null> {
  const [systemCtx, crossClientCtx, workspaceCtx] = await Promise.all([
    loadSystemContext(),
    loadCrossClientContext(),
    workspaceSlug ? loadWorkspaceContext(workspaceSlug) : Promise.resolve(null),
  ]);
  
  return formatMemoryContext(systemCtx, crossClientCtx, workspaceCtx);
}
```

### Example 2: Seed Content Detection
```typescript
// Detect if a memory file has only seed template content (no real entries)
function hasRealEntries(content: string): boolean {
  // Real entries start with [ISO-DATE] format
  return /\[\d{4}-\d{2}-\d{2}T/.test(content);
}
```

### Example 3: Entry Validation for appendToMemory
```typescript
// Add to existing appendToMemory() to prevent malformed writes
function isValidEntry(entry: string): boolean {
  if (!entry || entry.trim().length === 0) return false;
  if (entry.includes("undefined: undefined")) return false;
  if (entry.includes("undefined —")) return false;
  if (entry.trim() === "undefined") return false;
  return true;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static system prompts | Dynamic prompts with injected context | This phase (59) | Agents learn from past sessions |
| Write-only memory (Phase 54.1) | Read + write memory | This phase (59) | Closes the memory loop |
| No memory validation | Entry validation on write | This phase (59) | Prevents malformed data accumulation |

## Open Questions

1. **MEMORY.md Token Budget vs "Load ENTIRE file" Decision**
   - What we know: MEMORY.md is 238 lines (~2500+ tokens). CONTEXT.md says "Load the ENTIRE file, not condensed." The token budget is ~2000 tokens total across all 3 layers.
   - What's unclear: These two constraints conflict. Either we load the full file (exceeding budget) or we truncate (violating the "entire file" decision).
   - Recommendation: Load the ENTIRE MEMORY.md as decided. Adjust the total token budget upward to ~4000 tokens to accommodate. The system prompt is already large (writer rules alone are ~5000+ tokens), so an additional ~2500 tokens from MEMORY.md is manageable within Claude's 200K context window. The ~2000 token budget in CONTEXT.md was likely an estimate before seeing the actual file size.

2. **Orchestrator Memory Loading Scope**
   - What we know: Orchestrator delegates to specialist agents via tool calls. Specialist agents run as separate `runAgent()` calls.
   - What's unclear: Should the orchestrator load workspace memory? It doesn't know the workspace slug until the user mentions one.
   - Recommendation: Orchestrator loads system-wide + cross-client context only (no workspace). Specialist agents load all 3 layers (they receive `workspaceSlug` via options). This matches the natural information flow -- orchestrator routes, specialists act on workspace-specific context.

## Sources

### Primary (HIGH confidence)
- Direct code analysis of `src/lib/agents/memory.ts`, `runner.ts`, `types.ts`, `load-rules.ts`, `orchestrator.ts`, `writer.ts`, `leads.ts`, `campaign.ts`, `research.ts`
- Direct inspection of `.nova/memory/` directory structure and file contents
- Phase 59 CONTEXT.md -- locked decisions and implementation details

### Secondary (MEDIUM confidence)
- MEMORY.md content and path -- verified by direct file read (238 lines)
- Phase 54.1 decisions from STATE.md -- confirmed write-side architecture

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all built-in Node.js APIs already in use
- Architecture: HIGH -- single injection point in runner.ts, clear pattern from existing code
- Pitfalls: HIGH -- all identified from direct code inspection and file analysis

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable internal architecture, no external dependencies)
