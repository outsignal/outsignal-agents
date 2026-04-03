# Phase 63: Dev CLI Tools + Entry Point - Research

**Researched:** 2026-04-03
**Domain:** CLI tool wrappers (git, code inspection, test execution, deploy status) + interactive chat entry point
**Confidence:** HIGH

## Summary

Phase 63 builds on Phase 62's foundation (dev-cli harness, Monty orchestrator stub, rules files) to create the actual tool surface that Monty dev agents will use for codebase observation, plus the interactive chat entry point (`scripts/monty.ts`).

The work is straightforward because every pattern is already established in the codebase. Nova's CLI tools in `scripts/cli/` demonstrate the exact wrapper pattern (dotenv, import harness, parse argv, call runWithHarness). The dev-cli harness at `scripts/dev-cli/_cli-harness.ts` is byte-for-byte identical in logic to Nova's. The chat entry point at `scripts/chat.ts` provides the full REPL template -- monty.ts will be a simplified version (no workspace picker, uses montyOrchestratorConfig instead of orchestratorConfig).

**Primary recommendation:** Create 10 dev-cli wrapper scripts using shell commands (git, find, cat, grep, tsc, vitest, vercel) wrapped in the existing harness, plus monty.ts following the chat.ts pattern minus the workspace picker.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEV-07 | AgentConfig with tools wrapping `scripts/dev-cli/*.ts` commands | All 10 dev-cli scripts produce JSON output via the harness; Phase 64 will wrap them as agent tools calling `node dist/dev-cli/*.js` |
| ORCH-06 | `scripts/monty.ts` CLI entry point (interactive chat, matching `scripts/chat.ts` pattern) | chat.ts is 287 lines with workspace picker, REPL loop, session persistence, memory loading; monty.ts follows same structure minus workspace picker |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsup | ^8.5.1 | Bundle dev-cli scripts to dist/dev-cli/ | Already used for scripts/cli/ bundling via tsup.cli.config.ts |
| tsx | ^4.21.0 | Run monty.ts directly (npm run monty) | Already used for `npm run chat` |
| chalk | (installed) | Terminal colors for monty.ts REPL | Already used in chat.ts |
| readline/promises | Node built-in | Interactive input for monty.ts | Already used in chat.ts |
| child_process | Node built-in | Execute git, tsc, vitest commands in dev-cli wrappers | Standard Node API for shell commands |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @ai-sdk/anthropic | ^3.0.46 | Model provider for monty.ts | Already installed, used in chat.ts |
| ai (AI SDK v6) | (installed) | generateText + stepCountIs for monty.ts | Already installed, used in chat.ts |
| @prisma/client | ^6.19.2 | Session persistence in monty.ts (AgentRun table) | Already installed, used in chat.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| child_process.execSync for git | simple-git npm package | Adds dependency for no benefit; git CLI is universal and these are read-only wrappers |
| Vercel CLI for deploy status | Vercel REST API | CLI is already installed (v50.23.2); REST API would need VERCEL_TOKEN env var. CLI approach matches the "shell wrapper" pattern of other tools |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure
```
scripts/
  dev-cli/
    _cli-harness.ts          # EXISTS (Phase 62)
    git-status.ts             # NEW
    git-diff.ts               # NEW
    git-log.ts                # NEW
    read-file.ts              # NEW
    list-files.ts             # NEW
    search-code.ts            # NEW
    run-tests.ts              # NEW
    check-types.ts            # NEW
    deploy-status.ts          # NEW
  monty.ts                    # NEW (entry point)
dist/
  dev-cli/                    # Compiled output (tsup)
```

### Pattern 1: Dev-CLI Wrapper Script
**What:** Each dev-cli script is a thin wrapper: load env, parse argv, execute a shell command, return structured JSON via the harness.
**When to use:** Every dev-cli tool follows this exact pattern.
**Example:**
```typescript
// scripts/dev-cli/git-status.ts
import { config } from "dotenv";
config({ path: ".env" });

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

runWithHarness("git-status", async () => {
  const raw = execSync("git status --porcelain", { encoding: "utf-8" });
  const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim();
  const lines = raw.trim().split("\n").filter(Boolean);
  return {
    branch,
    clean: lines.length === 0,
    files: lines.map(line => ({
      status: line.substring(0, 2).trim(),
      path: line.substring(3),
    })),
  };
});
```

### Pattern 2: Monty Chat Entry Point (no workspace picker)
**What:** Interactive REPL that sends user input to the Monty orchestrator. No workspace picker because dev work is project-scoped. Still saves AgentRun for audit trail.
**When to use:** `scripts/monty.ts` -- the single entry point for Monty.
**Key differences from chat.ts:**
1. No workspace picker (no `pickWorkspace` function)
2. Uses `montyOrchestratorConfig` and `montyOrchestratorTools` from `monty-orchestrator.ts`
3. Uses `loadMemoryContext` with `{ memoryRoot: ".monty/memory" }` option
4. No `/workspace` command (project-scoped)
5. No delegation memory writes (appendToMemory for workspace learnings)
6. Agent name in session record: `"monty-orchestrator"` not `"orchestrator"`
7. Brand color: `#635BFF` (purple) not `#F0FF7A` (retired yellow used in current chat.ts)

### Pattern 3: tsup Configuration for dev-cli
**What:** Extend or create a second tsup config to bundle dev-cli scripts.
**When to use:** Build step for dev-cli tools.
**Approach:** Create `tsup.dev-cli.config.ts` mirroring `tsup.cli.config.ts` but targeting `scripts/dev-cli/*.ts` -> `dist/dev-cli/`. Add `"build:dev-cli"` npm script.

### Anti-Patterns to Avoid
- **Don't import agent tool functions directly:** Dev-cli tools should NOT import from `@/lib/agents/*` like Nova CLI tools do (e.g. `orchestratorTools.listWorkspaces.execute({})`). Dev-cli tools wrap shell commands, not agent tool functions. The agent tools will wrap the dev-cli scripts (in Phase 64), not the other way around.
- **Don't use `--porcelain` without structure:** Always parse git porcelain output into structured JSON fields, never return raw text.
- **Don't require dotenv for git/code tools:** Git and code inspection tools don't need database access. Only include dotenv loading if the tool actually needs env vars (e.g., deploy-status may need Vercel token).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON output formatting | Custom envelope format | `runWithHarness` from `_cli-harness.ts` | Already handles ok/error envelope, sanitization, exit codes |
| Secret scrubbing | Custom regex | `sanitizeOutput` from `@/lib/sanitize-output` | Already imported by the harness, covers all known secret patterns |
| Git output parsing | Raw string manipulation | `git --porcelain` / `git --format` flags | Git has structured output modes that are machine-parseable |
| Interactive REPL | Custom readline loop | Copy chat.ts REPL pattern | Already handles SIGINT, EOF, clear, help, session save |

**Key insight:** Every component of Phase 63 is a composition of existing patterns. Zero new abstractions needed.

## Common Pitfalls

### Pitfall 1: execSync Buffer Overflow on Large Diffs
**What goes wrong:** `execSync` default maxBuffer is 1MB. A large git diff can exceed this and throw.
**Why it happens:** Repos with large generated files or binary changes produce huge diffs.
**How to avoid:** Set `maxBuffer: 10 * 1024 * 1024` (10MB) on execSync options. For git-diff specifically, add `--stat` as default output (summary only) with an optional `--full` flag for the complete diff.
**Warning signs:** "stdout maxBuffer length exceeded" error in JSON envelope.

### Pitfall 2: Missing cwd in execSync
**What goes wrong:** If the compiled script runs from `dist/dev-cli/`, the git commands execute in the wrong directory.
**Why it happens:** tsup bundles to `dist/dev-cli/`; `execSync` defaults to `process.cwd()` which should be project root when run via `node dist/dev-cli/git-status.js`, but could be wrong if invoked differently.
**How to avoid:** Always pass `{ cwd: process.env.PROJECT_ROOT || process.cwd() }` to execSync. The harness already sets `PROJECT_ROOT` if missing.
**Warning signs:** "fatal: not a git repository" in error output.

### Pitfall 3: Monty Memory Load with Wrong memoryRoot
**What goes wrong:** monty.ts calls `loadMemoryContext(slug)` without `{ memoryRoot: ".monty/memory" }` and gets Nova's memory instead.
**Why it happens:** `loadMemoryContext` defaults to Nova's `.nova/memory/` root.
**How to avoid:** Always pass `{ memoryRoot: ".monty/memory" }` when calling from Monty context. Phase 62-01 parameterized this function for exactly this reason.
**Warning signs:** Memory context mentions campaign operations, workspaces, client names.

### Pitfall 4: tsup Config Not Building dev-cli
**What goes wrong:** Running `npm run build:cli` only builds Nova's scripts/cli/, not scripts/dev-cli/.
**Why it happens:** Existing tsup.cli.config.ts only targets `scripts/cli/*.ts`.
**How to avoid:** Create a separate `tsup.dev-cli.config.ts` and a separate npm script `build:dev-cli`. Do NOT modify the existing config.

### Pitfall 5: search-code Output Too Large
**What goes wrong:** `grep -r` on a large codebase returns megabytes of output, blowing up the JSON envelope and consuming agent context.
**Why it happens:** No result limit on grep.
**How to avoid:** Default to `--max-count=5` (5 matches per file) and limit total output to 50 matches. Accept `--limit` arg to override. Always exclude `node_modules/`, `dist/`, `.next/`, `.git/`.

### Pitfall 6: Monty Session Using Wrong Agent Name
**What goes wrong:** AgentRun record saved with agent: "orchestrator" instead of "monty-orchestrator", making it indistinguishable from Nova sessions.
**Why it happens:** Copy-paste from chat.ts without updating the agent name.
**How to avoid:** Use `"monty-orchestrator"` as the agent field in prisma.agentRun.create.

## Code Examples

### Dev-CLI Tool: git-diff
```typescript
import { config } from "dotenv";
config({ path: ".env" });

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const [, , target] = process.argv;

runWithHarness("git-diff [target]", async () => {
  const cwd = process.env.PROJECT_ROOT || process.cwd();
  const opts = { encoding: "utf-8" as const, cwd, maxBuffer: 10 * 1024 * 1024 };
  
  // Default: staged + unstaged summary
  const diffTarget = target || "HEAD";
  const stat = execSync(`git diff ${diffTarget} --stat`, opts);
  const numstat = execSync(`git diff ${diffTarget} --numstat`, opts);
  
  const files = numstat.trim().split("\n").filter(Boolean).map(line => {
    const [added, removed, file] = line.split("\t");
    return { file, added: parseInt(added) || 0, removed: parseInt(removed) || 0 };
  });
  
  return {
    target: diffTarget,
    summary: stat.trim(),
    files,
    totalAdded: files.reduce((s, f) => s + f.added, 0),
    totalRemoved: files.reduce((s, f) => s + f.removed, 0),
  };
});
```

### Dev-CLI Tool: check-types
```typescript
import { config } from "dotenv";
config({ path: ".env" });

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

runWithHarness("check-types", async () => {
  const cwd = process.env.PROJECT_ROOT || process.cwd();
  try {
    execSync("npx tsc --noEmit", { encoding: "utf-8", cwd, maxBuffer: 10 * 1024 * 1024 });
    return { passed: true, errors: [] };
  } catch (err) {
    const output = (err as { stdout?: string }).stdout || String(err);
    const errors = output.trim().split("\n").filter(Boolean).map(line => {
      const match = line.match(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
      if (match) return { file: match[1], line: parseInt(match[2]), col: parseInt(match[3]), code: match[4], message: match[5] };
      return { raw: line };
    });
    return { passed: false, errorCount: errors.length, errors: errors.slice(0, 50) };
  }
});
```

### Dev-CLI Tool: deploy-status
```typescript
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

runWithHarness("deploy-status", async () => {
  const cwd = process.env.PROJECT_ROOT || process.cwd();
  const opts = { encoding: "utf-8" as const, cwd, maxBuffer: 5 * 1024 * 1024 };
  
  try {
    const raw = execSync("vercel inspect --json 2>/dev/null || vercel ls --json 2>/dev/null | head -1", opts);
    return JSON.parse(raw);
  } catch {
    // Fallback: just check if vercel CLI is available
    try {
      const version = execSync("vercel --version", opts).trim();
      return { available: true, version, message: "Vercel CLI available but no project linked or not authenticated" };
    } catch {
      return { available: false, message: "Vercel CLI not installed" };
    }
  }
});
```

### Monty Entry Point: Key Differences from chat.ts
```typescript
// Key structural differences from scripts/chat.ts:

// 1. Import Monty orchestrator, not Nova
import { montyOrchestratorConfig, montyOrchestratorTools } from "../src/lib/agents/monty-orchestrator";

// 2. No workspace state — project-scoped
// (no workspaceSlug variable, no pickWorkspace function)

// 3. Memory loading uses Monty namespace
const memoryContext = await loadMemoryContext("", { memoryRoot: ".monty/memory" });

// 4. System prompt augmentation — no workspace context
const systemWithMemory = memoryContext
  ? `${montyOrchestratorConfig.systemPrompt}\n\n${memoryContext}\nInterface: CLI chat (no browser available)`
  : `${montyOrchestratorConfig.systemPrompt}\nInterface: CLI chat (no browser available)`;

// 5. Session record uses monty-orchestrator agent name
await prisma.agentRun.create({
  data: {
    agent: "monty-orchestrator",
    workspaceSlug: null, // project-scoped, no workspace
    // ... rest same pattern
  },
});

// 6. No /workspace command, no delegation memory writes
// 7. REPL prompt: "[monty] >" not "[slug] >"
```

## Tool Inventory (10 scripts)

| Script | Category | Shell Command | Key Output Fields |
|--------|----------|---------------|-------------------|
| `git-status.ts` | Git | `git status --porcelain`, `git branch --show-current` | branch, clean, files[{status, path}] |
| `git-diff.ts` | Git | `git diff [target] --stat --numstat` | target, summary, files[{file, added, removed}], totalAdded, totalRemoved |
| `git-log.ts` | Git | `git log --oneline --format=... -n N` | commits[{hash, author, date, message}], count |
| `read-file.ts` | Code | `fs.readFileSync` (not shell) | path, content, lineCount, sizeBytes |
| `list-files.ts` | Code | `find . -type f` with exclusions | pattern, files[], count |
| `search-code.ts` | Code | `grep -rn --include=...` with limits | pattern, matches[{file, line, content}], matchCount, truncated |
| `run-tests.ts` | Test | `npx vitest run [path]` | passed, failed, total, duration, failures[{test, error}] |
| `check-types.ts` | Test | `npx tsc --noEmit` | passed, errorCount, errors[{file, line, code, message}] |
| `deploy-status.ts` | Deploy | `vercel ls --json` or `vercel inspect` | status, url, createdAt, state, error (if any) |

Note: `read-file.ts` uses Node's `fs.readFileSync` rather than a shell command, but still wraps in the harness for consistent JSON envelope output. It should accept `--path <filepath>` and optionally `--start-line` / `--end-line` for partial reads.

## Build Configuration

### tsup.dev-cli.config.ts
```typescript
import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["scripts/dev-cli/*.ts", "!scripts/dev-cli/_*.ts"],
  outDir: "dist/dev-cli",
  format: ["cjs"],
  bundle: true,
  splitting: false,
  clean: true,
  external: ["@prisma/client"],
  esbuildOptions(options) {
    options.alias = {
      "@": path.resolve(__dirname, "src"),
    };
  },
});
```

### package.json additions
```json
{
  "scripts": {
    "build:dev-cli": "tsup --config tsup.dev-cli.config.ts",
    "monty": "tsx scripts/monty.ts"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct tool function calls | CLI wrappers around shell commands | Phase 63 (new) | Dev agents use shell-level tools, not internal APIs |
| Single orchestrator entry | Two entry points (chat.ts + monty.ts) | Phase 63 (new) | Clean separation of campaign ops vs platform engineering |

## Open Questions

1. **loadMemoryContext signature for project-scoped use**
   - What we know: The function accepts `(slug: string, options?: MemoryOptions)`. For Monty, slug is irrelevant since memory is topic-based not workspace-based.
   - What's unclear: Should slug be empty string `""` or should there be a sentinel value?
   - Recommendation: Pass empty string `""` with `{ memoryRoot: ".monty/memory" }`. The function should still work since it reads from the memoryRoot directly. Verify this works before writing monty.ts.

2. **deploy-status reliability**
   - What we know: Vercel CLI v50.23.2 is installed globally. The `vercel ls` and `vercel inspect` commands exist.
   - What's unclear: Whether the CLI is authenticated / project-linked in the outsignal-agents directory. JSON output format may vary.
   - Recommendation: Implement with graceful fallback (try vercel commands, catch and return "not configured" status). Test during implementation.

3. **vitest output parsing**
   - What we know: vitest outputs colored terminal text by default. `--reporter=json` flag produces machine-parseable output.
   - What's unclear: Exact JSON schema of vitest reporter output.
   - Recommendation: Use `npx vitest run --reporter=json` and parse the JSON output. Falls back to text parsing if JSON reporter fails.

## Sources

### Primary (HIGH confidence)
- `scripts/cli/_cli-harness.ts` and `scripts/dev-cli/_cli-harness.ts` -- identical harness pattern, verified by reading both files
- `scripts/chat.ts` -- 287-line REPL entry point, full template for monty.ts
- `src/lib/agents/monty-orchestrator.ts` -- Monty orchestrator config with stub tools, created in Phase 62-03
- `src/lib/agents/memory.ts` -- loadMemoryContext with MemoryOptions.memoryRoot parameter, created in Phase 62-01
- `tsup.cli.config.ts` -- Build configuration pattern for CLI scripts
- `package.json` -- Existing scripts and dependencies

### Secondary (MEDIUM confidence)
- Vercel CLI commands (vercel ls, vercel inspect) -- based on installed CLI v50.23.2, exact JSON format needs verification during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed, patterns established
- Architecture: HIGH -- every pattern exists in the codebase (Nova CLI tools, chat.ts, harness)
- Pitfalls: HIGH -- identified from real codebase patterns (maxBuffer, cwd, memory namespace)

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable patterns, no external API dependencies)
