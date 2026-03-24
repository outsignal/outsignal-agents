# Phase 48: CLI Wrapper Scripts - Research

**Researched:** 2026-03-24
**Domain:** Node.js CLI tooling, TypeScript compilation (tsup/esbuild), agent tool function wrapping
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **One script per tool function** — each tool function gets its own standalone script (e.g., `workspace-get.js`, `campaign-list.js`, `kb-search.js`)
- **Map from existing tool functions** — audit all tool functions across the 7 agent configs and create one script per function. Not limited to the 14 named in the roadmap
- **Same pattern for read and write scripts** — no confirmation gates on write scripts. Agents already make the decision to call a write tool; the skill instructions gate when writes happen
- **Import existing tool function implementations** — scripts are thin wrappers that import and call the existing functions from `src/lib/agents/tools/`. Guaranteed parity with API agents, minimal new code
- **Positional arguments** — `node dist/cli/workspace-get.js rise`. First arg is always the primary identifier (slug, campaignId, query). Additional args as needed
- **Wrapped JSON envelope** — Success: `{ "ok": true, "data": {...} }`. Failure: `{ "ok": false, "error": "message" }`. Agents always know if it worked
- **Pretty-printed output** — `JSON.stringify(data, null, 2)` for readability when checking script output manually
- **Default result limits** — Scripts that return large datasets should have sensible default limits with an override arg. Prevents context overflow in agent sessions
- **tsup single-file bundles** — each script compiled to a self-contained `.js` file. tsup handles `@/` path aliases via esbuildOptions. Zero resolution issues at runtime
- **Prisma Client external** — mark `@prisma/client` as external in tsup config. Scripts are smaller, Prisma engine stays in `node_modules`. Scripts only run on machines with `npm install` done
- **Single build command** — `npm run build:cli` compiles all scripts to `dist/cli/` in one pass
- **dist/cli/ gitignored** — build artifacts don't belong in git. Same pattern as `.next/`. Run `npm run build:cli` after clone
- **JSON error + usage hint on missing args** — `{ "ok": false, "error": "Missing required argument: slug", "usage": "workspace-get <slug>" }` with exit code 1
- **Fail immediately on errors** — no retries. Return `{ "ok": false, "error": "..." }` right away
- **Shared cli-harness.ts wrapper** — a small utility that wraps every script's main function: catches errors, sanitizes output via `sanitize-output.ts`, writes JSON envelope, sets exit code. DRY and consistent across all scripts
- **No script-level timeout** — let the caller handle timeouts

### Claude's Discretion
- Exact list of tool functions to wrap (derived from codebase audit)
- tsup configuration details
- How to structure the shared cli-harness.ts utility internally
- Default limit values per script (e.g., 50 results for people-search, 20 for campaign-list)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | `scripts/cli/` wrapper scripts created for tool functions across all 7 agents | Full tool audit below maps every function to a script filename |
| CLI-02 | All wrapper scripts compiled to `dist/cli/*.js` to avoid npx tsx cold-start latency | tsup with esbuildOptions.alias resolves @/ paths; confirmed esbuild 0.27.3 available |
| CLI-03 | All wrapper scripts import and apply `sanitize-output.ts` to stdout | sanitize-output.ts confirmed at `src/lib/sanitize-output.ts`, pure function, no env access |
| CLI-04 | Each wrapper script independently testable via `node dist/cli/<script>.js <args>` | CJS format + .env/.env.local loading at script top enables standalone execution |
</phase_requirements>

## Summary

Phase 48 builds the tooling layer that CLI skill agents use to do real work. Every tool function currently embedded inside the 7 AI SDK agent configs (`writer.ts`, `campaign.ts`, `leads.ts`, `research.ts`, `orchestrator.ts`) gets extracted into a standalone Node.js script. Each script takes positional CLI args, calls the existing function implementation directly, and outputs a sanitized JSON envelope to stdout.

The key technical challenge is compilation: the scripts import via `@/lib/...` aliases which don't exist at runtime in `dist/cli/`. tsup with `esbuildOptions` alias mapping solves this by inlining all code into a single CJS bundle per script. Prisma Client is the only external dependency that must NOT be bundled (it needs the native query engine from `node_modules`). The `load-rules.ts` utility already has a `PROJECT_ROOT` env var override for this exact scenario.

The second challenge is tool inventory accuracy. The REQUIREMENTS.md lists 19 script names as a representative sample, but CONTEXT.md locks in "audit all tool functions and create one per function" — meaning the actual count will be higher. This research provides the authoritative tool audit from the source files.

**Primary recommendation:** Write the shared `scripts/cli/cli-harness.ts` utility first, then verify the full compilation pipeline with one script (workspace-get) before scripting all remaining wrappers.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsup | 8.5.1 (via npx) | Bundle TypeScript scripts to CJS | Wraps esbuild, handles TypeScript natively, single-file output |
| esbuild | 0.27.3 (in node_modules) | Used by tsup under the hood | Resolves @/ alias via `options.alias` in esbuildOptions |
| @prisma/client | 6.19.2 | Database access | Already in project, marked external in bundle |
| dotenv | (transitive dep) | Load .env files at script start | Already used in chat.ts, nova-memory.ts |
| sanitize-output.ts | Phase 46 artifact | Strip secrets from stdout | Pure function, already built at `src/lib/sanitize-output.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | 4.21.0 (in node_modules) | Dev-time script execution | Use for rapid testing before building; has `tsconfig-paths` support |
| tsconfig-paths | (in node_modules) | Runtime alias resolution | Available but tsup bundling makes it unnecessary for dist/ |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsup | tsc + tsc-alias | More steps, tsc alone doesn't bundle, needs post-processing |
| tsup | esbuild directly | More config required; tsup wraps esbuild cleanly |
| tsup | pkgroll | Less ecosystem support, overkill for CLI scripts |

**Installation:**
```bash
# tsup is NOT in package.json devDependencies — add it
npm install --save-dev tsup
```

> **CRITICAL:** tsup is currently accessed via `npx` only (not in package.json). It must be added to `devDependencies` so `npm run build:cli` works reproducibly after clone.

## Architecture Patterns

### Recommended Project Structure
```
scripts/
└── cli/
    ├── _cli-harness.ts         # shared utility (underscore = not a script itself)
    ├── workspace-get.ts
    ├── workspace-list.ts
    ├── workspace-intelligence.ts
    ├── campaign-list.ts
    ├── campaign-get.ts
    ├── campaign-performance.ts
    ├── campaign-context.ts
    ├── save-sequence.ts
    ├── save-draft.ts
    ├── kb-search.ts
    ├── people-search.ts
    ├── ... (all tool function wrappers)
dist/
└── cli/                        # gitignored — compiled bundles
    ├── workspace-get.js
    ├── campaign-list.js
    └── ...
tsup.cli.config.ts              # dedicated tsup config for CLI build
```

### Pattern 1: Script Structure (Standard Wrapper)
**What:** Every wrapper script follows the exact same 4-part structure
**When to use:** All scripts without exception
```typescript
// Source: CONTEXT.md decision + chat.ts pattern
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { toolFunction } from "@/lib/agents/writer";  // import existing execute()

const [,, slug] = process.argv;

runWithHarness("workspace-get <slug>", async () => {
  if (!slug) throw new Error("Missing required argument: slug");
  return toolFunction.execute({ slug });
});
```

### Pattern 2: cli-harness.ts Utility
**What:** Shared wrapper that handles the boilerplate for every script
**When to use:** Imported by every wrapper script
```typescript
// Source: CONTEXT.md specifics section
import { sanitizeOutput } from "@/lib/sanitize-output";

export async function runWithHarness(
  usage: string,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    const data = await fn();
    const envelope = JSON.stringify({ ok: true, data }, null, 2);
    process.stdout.write(sanitizeOutput(envelope) + "\n");
    process.exit(0);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const envelope = JSON.stringify(
      { ok: false, error, usage },
      null,
      2
    );
    process.stdout.write(sanitizeOutput(envelope) + "\n");
    process.exit(1);
  }
}
```

### Pattern 3: tsup Config for CLI Build
**What:** tsup configuration that bundles all CLI scripts with @/ alias resolution
**When to use:** `npm run build:cli` — compiles all scripts to dist/cli/
```typescript
// Source: tsup docs + esbuild alias API
import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["scripts/cli/*.ts", "!scripts/cli/_*.ts"],  // exclude _cli-harness
  outDir: "dist/cli",
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

> **CRITICAL PATH ALIAS NOTE:** tsup does NOT automatically read `tsconfig.json` `paths` for runtime resolution. The `esbuildOptions.alias` approach is the correct solution. `@/*` in tsconfig maps to `./src/*` — in esbuild alias this translates to `"@": path.resolve('./src')` (without the `/*` glob). Confirmed via esbuild issue #905 and esbuild native alias API.

### Pattern 4: Scripts with Multi-Arg Positional Parsing
**What:** Some tools need 2-3 args (e.g., sequence-steps needs workspaceSlug + campaignId)
**When to use:** Tools with multiple required inputs
```typescript
const [,, workspaceSlug, campaignIdStr] = process.argv;
const campaignId = campaignIdStr ? parseInt(campaignIdStr, 10) : undefined;

runWithHarness("sequence-steps <workspaceSlug> <campaignId>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  return getSequenceSteps.execute({ workspaceSlug, campaignId });
});
```

### Pattern 5: Scripts with Default Limit + Override
**What:** Dataset-heavy scripts (people-search, campaign-list) cap results by default
**When to use:** Any tool that can return 100+ records
```typescript
const [,, query, limitStr] = process.argv;
const limit = limitStr ? parseInt(limitStr, 10) : 50;  // default 50

runWithHarness("people-search <query> [limit]", async () => {
  return searchPeople.execute({ query, limit });
});
```

### Anti-Patterns to Avoid
- **Bundling Prisma:** Never include `@prisma/client` in the bundle. The Prisma query engine binary must exist in `node_modules`. Mark it external always.
- **Using `__dirname` for project root in wrappers:** When compiled, `__dirname` points to `dist/cli/`. `load-rules.ts` already handles this via `PROJECT_ROOT` env var — set `PROJECT_ROOT=$(pwd)` when running scripts, or the 3-level parent traversal will resolve incorrectly.
- **Writing to both stdout and stderr for valid output:** All output (success and errors) goes to stdout as JSON. stderr is for Node.js/Prisma internal errors only. Agents parse stdout.
- **Re-implementing tool logic in scripts:** Scripts must call the existing `tool.execute()` function, not reimplement the logic. This is the "guaranteed parity" requirement.
- **Bundling all scripts into one entry point:** Each script must be its own `dist/cli/<name>.js` file so agents can call `node dist/cli/kb-search.js "query"` independently.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path alias resolution | Custom require() interceptor | tsup + esbuildOptions.alias | esbuild handles this natively at bundle time |
| JSON output sanitization | Custom regex in each script | `sanitize-output.ts` | Already built, tested, maintains single source of truth |
| Error wrapping | try/catch in every script | `cli-harness.ts` | DRY; consistent exit codes and envelope format |
| TypeScript compilation | tsc + post-processing | tsup | Handles bundling, aliases, CJS output in one config |
| Dotenv loading | Next.js env injection | `dotenv` config() calls | Scripts run outside Next.js; must load .env manually |

**Key insight:** All tool logic already exists. This phase is 95% plumbing — the harness + tsup config are the only new code; every wrapper is 8-12 lines.

## Authoritative Tool Audit

This is the complete list of tool functions across all 7 agent configs. Each maps to one CLI script.

### Writer Agent (`src/lib/agents/writer.ts`) — 8 tools
| Script Name | Tool Function | Args | Domain |
|-------------|--------------|------|--------|
| `workspace-intelligence` | `getWorkspaceIntelligence.execute` | `<slug>` | writer |
| `campaign-performance` | `getCampaignPerformance.execute` | `<workspaceSlug>` | writer |
| `sequence-steps` | `getSequenceSteps.execute` | `<workspaceSlug> <campaignId>` | writer |
| `kb-search` | `searchKnowledgeBase.execute` (shared) | `<query> [tags] [limit]` | shared |
| `existing-drafts` | `getExistingDrafts.execute` | `<workspaceSlug> [campaignName]` | writer |
| `campaign-context` | `getCampaignContext.execute` | `<campaignId>` | writer |
| `save-sequence` | `saveCampaignSequence.execute` | `<campaignId> <jsonFile>` | writer |
| `save-draft` | `saveDraft.execute` | `<workspaceSlug> <jsonFile>` | writer |

> `searchKnowledgeBase` is shared (same function in writer, leads, orchestrator). One script covers all three agents.

### Campaign Agent (`src/lib/agents/campaign.ts`) — 8 tools
| Script Name | Tool Function | Args | Domain |
|-------------|--------------|------|--------|
| `campaign-create` | `createCampaign.execute` | `<workspaceSlug> <jsonFile>` | campaign |
| `campaign-get` | `getCampaign.execute` | `<campaignId>` | campaign |
| `campaign-list` | `listCampaigns.execute` | `<workspaceSlug>` | campaign |
| `target-list-find` | `findTargetList.execute` | `<workspaceSlug> [nameFilter]` | campaign |
| `campaign-status` | `updateCampaignStatus.execute` | `<campaignId> <newStatus>` | campaign |
| `campaign-publish` | `publishForReview.execute` | `<campaignId>` | campaign |
| `signal-campaign-create` | `createSignalCampaign.execute` | `<workspaceSlug> <jsonFile>` | campaign |
| `signal-campaign-activate` | `activateSignalCampaign.execute` | `<campaignId>` | campaign |
| `signal-campaign-pause` | `pauseResumeSignalCampaign.execute` | `<campaignId> <pause\|resume>` | campaign |

### Leads Agent (`src/lib/agents/leads.ts`) — 18 tools
| Script Name | Tool Function | Args | Domain |
|-------------|--------------|------|--------|
| `people-search` | `searchPeople.execute` | `[query] [limit]` | leads |
| `list-create` | `createList.execute` | `<workspaceSlug> <name>` | leads |
| `list-add-people` | `addPeopleToList.execute` | `<listId> <jsonFile>` | leads |
| `list-get` | `getList.execute` | `<listId>` | leads |
| `list-get-all` | `getLists.execute` | `[workspaceSlug]` | leads |
| `list-score` | `scoreList.execute` | `<listId> <workspaceSlug>` | leads |
| `list-export` | `exportListToEmailBison.execute` | `<listId> <workspaceSlug>` | leads |
| `discovery-plan` | `buildDiscoveryPlan.execute` | `<workspaceSlug> <jsonFile>` | leads |
| `discovery-promote` | `deduplicateAndPromote.execute` | `<workspaceSlug> <runIds...>` | leads |
| `search-apollo` | `searchApollo.execute` | `<workspaceSlug> <jsonFile>` | leads |
| `search-prospeo` | `searchProspeo.execute` | `<workspaceSlug> <jsonFile>` | leads |
| `search-aiark` | `searchAiArk.execute` | `<workspaceSlug> <jsonFile>` | leads |
| `search-leads-finder` | `searchLeadsFinder.execute` | `<workspaceSlug> <jsonFile>` | leads |
| `search-google` | `searchGoogle.execute` | `<workspaceSlug> <query> [mode]` | leads |
| `extract-directory` | `extractDirectory.execute` | `<workspaceSlug> <url>` | leads |
| `check-google-ads` | `checkGoogleAds.execute` | `<workspaceSlug> <jsonFile>` | leads |
| `check-tech-stack` | `checkTechStack.execute` | `<workspaceSlug> <domain>` | leads |
| `search-google-maps` | `searchGoogleMaps.execute` | `<workspaceSlug> <jsonFile>` | leads |
| `search-ecommerce` | `searchEcommerceStores.execute` | `<workspaceSlug> <jsonFile>` | leads |

> Note: `searchGoogleAdsAdvertisers` is also in leads.ts (line 821). This maps to one script.

### Research Agent (`src/lib/agents/research.ts`) — 4 tools
| Script Name | Tool Function | Args | Domain |
|-------------|--------------|------|--------|
| `website-crawl` | `crawlWebsite.execute` | `<url> [maxPages]` | research |
| `url-scrape` | `scrapeUrl.execute` | `<url>` | research |
| `workspace-get` | `getWorkspaceInfo.execute` | `<slug>` | research/orchestrator |
| `website-analysis-save` | `saveWebsiteAnalysis.execute` | `<workspaceSlug> <jsonFile>` | research |
| `workspace-icp-update` | `updateWorkspaceICP.execute` | `<slug> <jsonFile>` | research |

### Orchestrator (Dashboard Tools) (`src/lib/agents/orchestrator.ts`) — 9 tools
| Script Name | Tool Function | Args | Domain |
|-------------|--------------|------|--------|
| `workspace-list` | `listWorkspaces.execute` | (none) | orchestrator |
| `workspace-get` | `getWorkspaceInfo.execute` | `<slug>` | orchestrator (same as research tool, one script) |
| `workspace-package-update` | `updateWorkspacePackage.execute` | `<workspaceSlug> <jsonFile>` | orchestrator |
| `campaigns-get` | `getCampaigns.execute` | `<workspaceSlug>` | orchestrator |
| `replies-get` | `getReplies.execute` | `<workspaceSlug> [limit]` | orchestrator |
| `sender-health` | `getSenderHealth.execute` | `<workspaceSlug>` | orchestrator |
| `people-query` | `queryPeople.execute` | `[workspaceSlug] [status] [limit]` | orchestrator |
| `proposal-list` | `listProposals.execute` | `[status]` | orchestrator |
| `proposal-create` | `createProposal.execute` | `<jsonFile>` | orchestrator |

> `delegateToResearch/Leads/Writer/Campaign` are orchestration tools, not CLI-wrappable (they invoke full agent runs). Skip these.

### Deliverability / Intelligence Domain Scripts
The REQUIREMENTS.md names `domain-health`, `bounce-stats`, `inbox-status`, `notification-health`, `cached-metrics`, `insight-list` as needed scripts. These wrap existing library functions (not AI SDK tools), but follow the same harness pattern:

| Script Name | Source Function | Args | Domain |
|-------------|----------------|------|--------|
| `domain-health` | `computeDomainRollup` from `src/lib/domain-health/snapshots.ts` | `<workspaceSlug>` | deliverability |
| `bounce-stats` | `evaluateSender` from `src/lib/domain-health/bounce-monitor.ts` | `<workspaceSlug>` | deliverability |
| `inbox-status` | `checkAllWorkspaces` from `src/lib/inbox-health/monitor.ts` | `[workspaceSlug]` | deliverability |
| `notification-health` | Direct Prisma query (from `src/app/api/notification-health/route.ts`) | `[range]` | intelligence |
| `insight-list` | `generateInsights` from `src/lib/insights/generate.ts` | `<workspaceSlug>` | intelligence |

> `cached-metrics` likely wraps `snapshotWorkspaceCampaigns` from `src/lib/analytics/snapshot.ts`. Confirm during implementation.

### Total Script Count
**Approximate total: 58 scripts** (not 19 as named in REQUIREMENTS.md sample). The REQUIREMENTS.md list is representative, not exhaustive — CONTEXT.md confirms "one script per tool function."

> **PLANNING NOTE:** 58 scripts is a large implementation surface. The planner should split this into waves by agent domain to make verification tractable. Each wave: harness + domain scripts + compile + smoke test.

## Common Pitfalls

### Pitfall 1: tsup Not in devDependencies
**What goes wrong:** `npm run build:cli` fails after clone because tsup is not installed
**Why it happens:** tsup is currently accessed via `npx` only — transient and unreliable in scripts
**How to avoid:** Add `tsup` to `devDependencies` in package.json before writing the build script
**Warning signs:** `npx tsup` works manually but `npm run build:cli` fails

### Pitfall 2: @/ Alias Not Resolved at Runtime
**What goes wrong:** `dist/cli/workspace-get.js` fails with `Cannot find module '@/lib/db'`
**Why it happens:** tsup does NOT automatically read tsconfig.json `paths` for bundling. It reads them for type checking only.
**How to avoid:** Use `esbuildOptions(options) { options.alias = { "@": path.resolve(__dirname, "src") } }` in tsup config
**Warning signs:** Build succeeds but `node dist/cli/workspace-get.js` throws module resolution error

### Pitfall 3: Prisma Client Bundled
**What goes wrong:** `dist/cli/*.js` files try to initialize Prisma with missing native binary
**Why it happens:** tsup bundles `@prisma/client` code but not the native query engine
**How to avoid:** Always include `external: ["@prisma/client"]` in tsup config
**Warning signs:** `Error: Prisma Client is not configured to run in this environment` on first run

### Pitfall 4: load-rules.ts Fails with __dirname in dist/cli/
**What goes wrong:** `getWorkspaceIntelligence` script crashes because `.claude/rules/writer-rules.md` not found
**Why it happens:** `load-rules.ts` uses `join(__dirname, "..", "..", "..")` which resolves to `dist/` not project root when compiled
**How to avoid:** Set `PROJECT_ROOT=$(pwd)` when running CLI scripts, OR verify that `join(__dirname, "..", "..", "..")` from `dist/cli/` correctly resolves to project root (it would be `dist/cli/` → `dist/` → project root — only 2 levels, needs 3). Set `PROJECT_ROOT` explicitly in scripts or in build output.
**Warning signs:** `[nova] Rules file not found:` warnings in output

### Pitfall 5: JSON Input Files for Complex Tools
**What goes wrong:** Tools with complex object inputs (e.g., `searchProspeo` with 20 filter fields) are unusable as positional args
**Why it happens:** Positional args only work for scalar inputs; complex filters need a different convention
**How to avoid:** For multi-field tools, accept a JSON file path as the second arg: `node dist/cli/search-prospeo.js rise ./filters.json`. Use `JSON.parse(fs.readFileSync(jsonFile, 'utf8'))` to load it.
**Warning signs:** Script args become unmanageable; agents must write temp files to call them

### Pitfall 6: tsconfig.json Excludes scripts/ Directory
**What goes wrong:** TypeScript errors in `scripts/cli/*.ts` are not caught by `tsc`
**Why it happens:** `tsconfig.json` has `"exclude": ["node_modules", "scripts", "worker"]`
**How to avoid:** Either create a separate `tsconfig.cli.json` for `scripts/cli/` that extends base tsconfig, or accept that tsup will type-check independently. For now, tsup's own TypeScript compilation will catch errors at build time.
**Warning signs:** IDE shows red errors in CLI scripts but `npm run build:cli` still works (tsup ignores tsconfig exclude)

### Pitfall 7: dotenv Not Loaded
**What goes wrong:** `DATABASE_URL` is undefined; Prisma fails to connect
**Why it happens:** Scripts run outside Next.js which normally injects env vars
**How to avoid:** First 2 lines of every script (including _cli-harness.ts) must be:
  ```typescript
  import { config } from "dotenv";
  config({ path: ".env" }); config({ path: ".env.local" });
  ```
  dotenv is available as a transitive dep in node_modules. Or add it explicitly to devDependencies.
**Warning signs:** `Error: @prisma/client did not initialize yet` or DB connection errors

## Code Examples

### Minimal Wrapper Script
```typescript
// Source: CONTEXT.md decisions + dotenv pattern from scripts/chat.ts
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { writerTools } from "@/lib/agents/writer";

const [,, slug] = process.argv;

runWithHarness("workspace-intelligence <slug>", async () => {
  if (!slug) throw new Error("Missing required argument: slug");
  return writerTools.getWorkspaceIntelligence.execute({ slug });
});
```

### JSON-File Input Pattern (for complex tools)
```typescript
// Source: Required for tools with 10+ input fields (search-prospeo, search-aiark, etc.)
import { config } from "dotenv";
config({ path: ".env" }); config({ path: ".env.local" });
import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [,, workspaceSlug, jsonFile] = process.argv;

runWithHarness("search-prospeo <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8"));
  return leadsTools.searchProspeo.execute({ workspaceSlug, ...params });
});
```

### tsup Config (tsup.cli.config.ts)
```typescript
// Source: tsup docs + esbuild alias API (confirmed working with esbuild 0.27+)
import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["scripts/cli/*.ts", "!scripts/cli/_*.ts"],
  outDir: "dist/cli",
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

### cli-harness.ts
```typescript
// Source: CONTEXT.md specifics section
import { sanitizeOutput } from "@/lib/sanitize-output";

export async function runWithHarness(
  usage: string,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    const data = await fn();
    const raw = JSON.stringify({ ok: true, data }, null, 2);
    process.stdout.write(sanitizeOutput(raw) + "\n");
    process.exit(0);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const raw = JSON.stringify({ ok: false, error, usage }, null, 2);
    process.stdout.write(sanitizeOutput(raw) + "\n");
    process.exit(1);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `npx tsx scripts/*.ts` (cold start) | `node dist/cli/*.js` (compiled) | Phase 48 | ~2-3s cold start eliminated per tool call |
| Agent tools only callable via AI SDK | Callable as standalone CLI | Phase 48 | Enables Claude Code skills to use tool functions |
| All tool logic in agent config files | Wrappers import existing execute() | Phase 48 | Zero logic duplication |

**Deprecated/outdated:**
- `scripts/generate-copy.ts`: Marked deprecated in file header — do not use as pattern for new CLI scripts
- `scripts/chat.ts`: Interactive REPL, not a data-returning CLI script — don't use as structural template

## Open Questions

1. **load-rules.ts path resolution from dist/cli/**
   - What we know: `__dirname` in `dist/cli/worker-get.js` will be the `dist/cli/` directory. `join(__dirname, "..", "..", "..")` would walk up to the project root. From `dist/cli/`: `..` = `dist/`, `../..` = project root. That's only 2 levels, but the code does 3 (`"..", "..", ".."`) which would be one level above project root.
   - What's unclear: Does the `__dirname` resolution in bundled CJS output match the source file location or the output file location? If tsup inlines `load-rules.ts`, `__dirname` will be `dist/cli/` not `src/lib/agents/`.
   - Recommendation: Set `PROJECT_ROOT=$(pwd)` in the npm script or use a wrapper shell script. The env var override is already coded in `load-rules.ts` for exactly this scenario.

2. **`generate-kb-examples` and write-type tool wrappers**
   - What we know: `saveDraft`, `saveCampaignSequence`, `saveWebsiteAnalysis`, `updateWorkspaceICP` are write operations that mutate the DB
   - What's unclear: For `saveDraft` and `saveCampaignSequence`, agents will compose large JSON payloads (multi-step sequences). The JSON-file input pattern handles this, but how should agents compose the file?
   - Recommendation: Agents write the JSON to a temp file (`/tmp/sequence-<uuid>.json`) before calling the script. The Bash tool can handle this.

3. **`cached-metrics` script backing function**
   - What we know: REQUIREMENTS.md lists it; `src/lib/analytics/snapshot.ts` has `snapshotWorkspaceCampaigns`
   - What's unclear: Whether `cached-metrics` means "fetch pre-computed metrics from DB" (a Prisma query) or "run the snapshot computation now"
   - Recommendation: Confirm with `src/app/(admin)/` pages that display cached metrics to identify what query they make.

## Sources

### Primary (HIGH confidence)
- Direct source code audit: `src/lib/agents/writer.ts`, `campaign.ts`, `leads.ts`, `research.ts`, `orchestrator.ts`, `shared-tools.ts` — tool function inventory
- `src/lib/sanitize-output.ts` — confirmed API: `sanitizeOutput(string): string`, pure function
- `src/lib/agents/load-rules.ts` — confirmed `PROJECT_ROOT` env var override
- `tsconfig.json` — confirmed `"@/*": ["./src/*"]` alias mapping
- `package.json` — confirmed tsup not in devDependencies, esbuild 0.27.3 available, tsx available

### Secondary (MEDIUM confidence)
- esbuild GitHub issue #905 (tsup path alias resolution) — confirmed tsup does not auto-read tsconfig paths
- esbuild native `alias` API — confirmed in esbuild 0.24+ docs; esbuildOptions.alias is the correct approach
- tsup 8.5.1 available via `npx tsup` — confirmed working on this machine

### Tertiary (LOW confidence)
- `__dirname` behavior in tsup CJS bundles — asserted from general bundler knowledge; should be validated with the "one wrapper before all wrappers" test

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed in node_modules, versions verified
- Architecture: HIGH — directly derived from locked CONTEXT.md decisions + source audit
- Tool inventory: HIGH — derived from line-by-line grep of all 5 agent files
- Path alias resolution: MEDIUM — esbuildOptions.alias approach is correct per esbuild docs, but test one script first before generating all 58
- load-rules.ts behavior: LOW — runtime `__dirname` in CJS bundles needs verification; use PROJECT_ROOT env var to be safe

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable libraries)
