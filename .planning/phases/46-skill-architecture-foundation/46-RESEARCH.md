# Phase 46: Skill Architecture Foundation - Research

**Researched:** 2026-03-23
**Domain:** Claude Code skill infrastructure, security architecture, shared rules system
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Dual-mode strategy
- **Shared rules files** — extract all agent behavioral rules to `.claude/rules/` as the single source of truth
- Both CLI skills and API agents reference the same rules files — true single source, zero drift
- **All agent rules** shared: copy quality (hyphen bans, tone constraints, sequence limits), discovery approval workflow, campaign state machine, KB search patterns — every agent's behavioral rules
- **Per-agent files** in `.claude/rules/`: `writer-rules.md`, `leads-rules.md`, `campaign-rules.md`, `research-rules.md`, `deliverability-rules.md`, `onboarding-rules.md`, `intelligence-rules.md`
- **API agents refactored** to read rules from `.claude/rules/` at prompt-build time — not keeping hardcoded prompts in TypeScript files

#### Memory location
- **`.nova/memory/{slug}/`** at project root — dedicated Nova namespace, clear separation from Claude Code's own memory
- **Gitignored** — no client intelligence leaks to version control. Directory structure preserved via `.gitkeep`
- **Backup strategy**: Vercel Blob storage for accumulated intelligence (periodic snapshots via `nova-memory backup` / `nova-memory restore`)
- **Seed script** (`nova-memory seed`) for new workspaces or factory reset — regenerates baseline from DB (ICP, tone, recent campaigns)
- Accumulated intelligence (copy-wins, feedback, approval patterns) preserved in Blob — never lost on machine wipe

#### Sanitization scope
- **Secrets only** — strip DATABASE_URL, API keys, tokens, passwords. PII (emails, names) stays because agents need it to do their job
- **Pattern-based detection** — regex for known secret formats (DATABASE_URL, sk_*, tr_*, Bearer tokens, ANTHROPIC_API_KEY, etc.)
- **Replacement format**: `[REDACTED:type]` — e.g. `[REDACTED:DATABASE_URL]`, `[REDACTED:API_KEY]`. Agent knows what was redacted but can't see the value

#### Skill invocation UX
- **`/nova {slug}`** as primary entry point — orchestrator delegates to whichever agents are needed
- **`/nova-writer {slug}`**, `/nova-research {slug}`, `/nova-leads {slug}`, `/nova-campaign {slug}` for direct specialist access
- **New agent short names**: `/nova-deliver`, `/nova-onboard`, `/nova-intel`
- **No slug = workspace picker** — shows list of all 8 workspaces to select from
- Full agent list: nova (orchestrator), nova-writer, nova-research, nova-leads, nova-campaign, nova-deliver, nova-onboard, nova-intel

### Claude's Discretion
- `.claudeignore` file content and patterns beyond `.env*`
- Exact regex patterns for secret detection in `sanitize-output.ts`
- Internal structure of per-agent rules files
- 200-line budget enforcement mechanism (documentation only vs automated check)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | `.claudeignore` prevents `.env*` files and secrets from being loaded into agent context | `.claudeignore` format documented; patterns identified from project structure |
| SEC-02 | `sanitize-output.ts` utility strips credentials, DB URLs, and API keys from all CLI wrapper stdout | Existing `utils.ts` injection guard + locked decision on `[REDACTED:type]` format provides implementation blueprint |
| SEC-03 | Skill content budget documented and enforced (200-line max per skill file) | Budget strategy: rules files in `.claude/rules/` hold overflow; skill files stay under 200 lines via import |
| SEC-04 | Dual-mode strategy decided and documented (shared rules vs time-boxed fallback) | Already locked: shared rules files in `.claude/rules/` — research confirms implementation path |
| SEC-05 | `.claude/rules/` directory houses shared behavioral rules importable by both CLI skills and API agents | Rules extraction from `writer.ts`, `leads.ts`, `orchestrator.ts`, `campaign.ts` documented; file names specified |
</phase_requirements>

---

## Summary

Phase 46 is pure infrastructure — no skill files get written, no campaigns run. The phase establishes three things that gate every downstream phase: (1) `.claudeignore` preventing secret exposure when Claude Code reads project files, (2) `sanitize-output.ts` stripping credentials from CLI wrapper stdout before Claude Code sees it, and (3) the `.claude/rules/` directory with extracted agent behavioral rules that both CLI skills and API agents will share.

The project already has significant relevant infrastructure. The existing `src/lib/agents/utils.ts` has prompt injection patterns (`USER_INPUT_GUARD`, `sanitizePromptInput`) — the new `sanitize-output.ts` is a different concern: it sanitizes stdout from CLI subprocesses, not user input going into prompts. The behavioral rules to extract are already written and working — they live in large `const SYSTEM_PROMPT` blocks inside `writer.ts` (752 lines), `orchestrator.ts` (682 lines), `leads.ts` (1156 lines), and `campaign.ts` (514 lines). The phase extracts those rules to `.claude/rules/` files and refactors the TS agents to read from them.

The `.claude/commands/nova.md` already exists (74 lines) — it invokes the API orchestrator via `npx tsx`. This is the existing skill that Phase 46's architecture will gate and that later phases will replace with proper CLI skills. The `.claude/rules/` directory does not yet exist. There is no `.claudeignore` file. The `.gitignore` already covers `.env*` and `.env*.local`. Phase 46 creates the missing pieces.

**Primary recommendation:** Create `.claudeignore`, `src/lib/sanitize-output.ts`, `.claude/rules/` with 7 rules files extracted from existing agent TypeScript, and an `ARCHITECTURE.md` document locking the dual-mode strategy — in that order, since security gates content.

---

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `.claudeignore` | Claude Code built-in | Prevents secret files from entering Claude Code context | Native Claude Code feature — same syntax as `.gitignore` |
| TypeScript | Project standard (ES2017+) | `sanitize-output.ts` utility | All existing agent code is TypeScript; tsconfig already configured |
| Regex | Built-in | Secret pattern detection | No library needed; patterns are short and known |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| Node.js `fs` | Built-in | Rules file loading at prompt-build time | API agents read `.claude/rules/*.md` at runtime |
| `.gitignore` | Already exists | Prevents `.env*` commits | Already covers env files — `.claudeignore` adds Claude Code layer |

### No npm Installs Required
Phase 46 is entirely file creation + TypeScript — no new dependencies.

---

## Architecture Patterns

### Recommended Directory Structure After Phase 46
```
.claude/
├── commands/
│   └── nova.md              # Existing (will be updated in Phase 49)
└── rules/                   # NEW — created in this phase
    ├── writer-rules.md      # Extracted from WRITER_SYSTEM_PROMPT in writer.ts
    ├── leads-rules.md       # Extracted from LEADS_SYSTEM_PROMPT in leads.ts
    ├── campaign-rules.md    # Extracted from CAMPAIGN_SYSTEM_PROMPT in campaign.ts
    ├── research-rules.md    # Extracted from research.ts system prompt
    ├── deliverability-rules.md  # NEW — authored for nova-deliver (Phase 49)
    ├── onboarding-rules.md      # NEW — authored for nova-onboard (Phase 49)
    └── intelligence-rules.md    # NEW — authored for nova-intel (Phase 49)

.nova/
└── memory/                  # OUT OF SCOPE (Phase 47)

src/lib/
└── sanitize-output.ts       # NEW — secrets stripper for CLI stdout

.claudeignore                # NEW — blocks .env*, prisma/dev.db, etc.
```

### Pattern 1: `.claudeignore` File Format
**What:** Same glob syntax as `.gitignore`. Claude Code reads this file and excludes matching paths from its context window when invoked.
**When to use:** Always first — no skill file can safely be invoked without this protection.

```
# Secrets and credentials
.env
.env.*
.env*.local
*.pem
*.key
*.p12
*.pfx

# Database files
prisma/dev.db
prisma/dev.db-journal

# Build artifacts that may contain env interpolation
.next/
dist/
.trigger/

# Local tooling state
.vercel/
coverage/
node_modules/
```

**Why this set:** `.env*` glob covers `.env`, `.env.local`, `.env.production`. Prisma dev.db contains raw data. `.next/` may have embedded env vars in server bundle. `.trigger/` is local build cache that embeds env at build time.

### Pattern 2: `sanitize-output.ts` Secret Stripper
**What:** A pure TypeScript function that takes a string (subprocess stdout) and returns a sanitized string with secrets replaced by `[REDACTED:type]` tokens.
**When to use:** Every CLI wrapper script pipes its output through this before returning to Claude Code.

**Known secret patterns from project (from `.env` inspection + STATE.md + MEMORY.md):**
- `DATABASE_URL=...` — Neon PostgreSQL connection string (contains password)
- `ANTHROPIC_API_KEY=sk-ant-...`
- `OPENAI_API_KEY=sk-...`
- `TRIGGER_SECRET_KEY=tr_...`
- `RESEND_API_KEY=re_...`
- `EMAILBISON_API_KEY=...`
- `EMAILGUARD_API_TOKEN=...`
- `INGEST_WEBHOOK_SECRET=...`
- `API_SECRET=...`
- `BLOB_READ_WRITE_TOKEN=...`
- `SLACK_BOT_TOKEN=xoxb-...`
- Bearer tokens in Authorization headers
- Generic `=<value>` assignments where key contains `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `URL`

**Implementation skeleton:**
```typescript
// src/lib/sanitize-output.ts

interface SecretPattern {
  pattern: RegExp;
  type: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // Explicit env var assignments (key=value on its own line or in JSON)
  { pattern: /DATABASE_URL=\S+/gi, type: 'DATABASE_URL' },
  { pattern: /ANTHROPIC_API_KEY=\S+/gi, type: 'API_KEY' },
  { pattern: /sk-ant-[A-Za-z0-9_-]+/g, type: 'ANTHROPIC_KEY' },
  { pattern: /sk-[A-Za-z0-9]{20,}/g, type: 'OPENAI_KEY' },
  { pattern: /tr_[A-Za-z0-9]{20,}/g, type: 'TRIGGER_KEY' },
  { pattern: /re_[A-Za-z0-9]{20,}/g, type: 'RESEND_KEY' },
  { pattern: /xoxb-[A-Za-z0-9-]+/g, type: 'SLACK_TOKEN' },
  { pattern: /vercelblob_rw_[A-Za-z0-9]+/gi, type: 'BLOB_TOKEN' },
  // Generic patterns for any KEY/SECRET/TOKEN/PASSWORD assignment
  { pattern: /\b(API_KEY|API_SECRET|SECRET_KEY|WEBHOOK_SECRET|BOT_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|BEARER)[=:]\s*["']?[^\s"']{8,}["']?/gi, type: 'SECRET' },
  // postgresql:// connection strings (contain embedded credentials)
  { pattern: /postgres(?:ql)?:\/\/[^\s"']+/gi, type: 'DATABASE_URL' },
  // Authorization header values
  { pattern: /Authorization:\s*Bearer\s+\S+/gi, type: 'BEARER_TOKEN' },
];

export function sanitizeOutput(output: string): string {
  let result = output;
  for (const { pattern, type } of SECRET_PATTERNS) {
    result = result.replace(pattern, `[REDACTED:${type}]`);
  }
  return result;
}
```

### Pattern 3: Rules File Extraction from TypeScript Agents
**What:** Extract the behavioral content of each `const AGENT_SYSTEM_PROMPT` block from `.ts` files into standalone `.md` files. The TS agent then reads these at runtime using `fs.readFileSync`.
**When to use:** For all 4 existing agents (writer, leads, campaign, research). The 3 new agents (deliverability, onboarding, intelligence) get authored fresh in Phase 49 — their rules files are created in this phase as stubs.

**Extraction mapping:**
| Source file | Line range (approx) | Target rules file | Content |
|------------|-------------------|-------------------|---------|
| `src/lib/agents/writer.ts` | Lines 387–680 | `.claude/rules/writer-rules.md` | Copy quality rules, strategies, signal-aware rules, sequence defaults |
| `src/lib/agents/leads.ts` | Lines ~800–1107 | `.claude/rules/leads-rules.md` | Discovery workflow, plan-approve-execute, credit gate, source order |
| `src/lib/agents/orchestrator.ts` | Lines 587–674 | `.claude/rules/campaign-rules.md` | Campaign workflow, delegation routing, signal campaign rules |
| `src/lib/agents/research.ts` | Lines ~100–end | `.claude/rules/research-rules.md` | Research process, ICP extraction, website analysis rules |

**TS agent refactor pattern (after extraction):**
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

function loadRules(filename: string): string {
  const rulesPath = join(process.cwd(), '.claude', 'rules', filename);
  try {
    return readFileSync(rulesPath, 'utf-8');
  } catch {
    // Fallback: return empty string if rules file missing (does not break agent)
    console.warn(`[agent] Rules file not found: ${rulesPath}`);
    return '';
  }
}

const WRITER_SYSTEM_PROMPT = `You are the Outsignal Writer Agent...
[short identity/purpose block only — behavioral rules loaded below]

${loadRules('writer-rules.md')}`;
```

**Why this refactor matters:** CLI skill files will reference the same `.claude/rules/writer-rules.md` via `!` (file include) syntax. If the rules lived only in TypeScript, CLI skills would need a separate copy — creating drift. The `.md` file is the single source.

### Pattern 4: 200-Line Budget Enforcement
**What:** Documentation-only enforcement for Phase 46. Skill files created in Phase 49 must stay under 200 lines, with overflow rules in `.claude/rules/*.md`.
**How skills stay under budget:** The skill file contains identity, tools list, invocation patterns, and memory read/write instructions. Behavioral rules are `!include`'d from `.claude/rules/`. A skill file of 200 lines with 50 lines of rules import can stay lean.
**Claude's discretion note:** Automated check (e.g. a pre-commit hook or CI check) is optional but clean. Recommendation: document the budget in `ARCHITECTURE.md` + add a comment at the top of each skill file listing its line count. Automated enforcement can come in Phase 49 when skill files actually exist.

### Anti-Patterns to Avoid
- **Sanitizing PII in output:** Names and email addresses stay — agents need them. Only credentials get redacted. (Locked decision.)
- **Loading `.env` in the sanitizer:** The sanitizer works on stdout strings, it does not read `.env`. The sanitizer must never import `dotenv` or `process.env` — it is pure string transformation.
- **Rules files with TypeScript imports:** Rules files are `.md`, not `.ts`. They contain prompt text only. They are read as strings. No TypeScript constructs.
- **Stub rules files for new agents in this phase:** `deliverability-rules.md`, `onboarding-rules.md`, `intelligence-rules.md` can be minimal stubs (5-10 lines) since the full content is authored in Phase 49. Do not leave them empty — a placeholder heading and intent statement is enough.
- **Forgetting `USER_INPUT_GUARD` during refactor:** When extracting system prompts, the `USER_INPUT_GUARD` appended in each agent config (`systemPrompt: PROMPT + USER_INPUT_GUARD`) must be preserved. It should NOT go into the rules file — it belongs in the agent config as now.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File exclusion from Claude context | Custom filtering | `.claudeignore` native Claude Code feature | Native, maintained, zero overhead |
| Secret detection library | Complex parser | Simple regex patterns | Known secret formats are finite; regex is testable and auditable |
| Rules file loading | Complex import system | `fs.readFileSync` at config initialization | Agents already use Node.js; no new runtime needed |
| Line count enforcement | Complex AST analysis | Manual count + comment annotation | 200 lines is a soft budget — annotation is sufficient for Phase 46 |

**Key insight:** This phase is file creation + refactoring, not new feature development. The complexity lives in getting the patterns right, not the implementation machinery.

---

## Common Pitfalls

### Pitfall 1: `.claudeignore` Not Covering All Secret Paths
**What goes wrong:** `.env.local` or `prisma/dev.db` not listed — Claude Code reads database credentials when indexing files.
**Why it happens:** Developers copy standard `.gitignore` patterns but miss Claude-specific concerns (Claude reads files the build system ignores).
**How to avoid:** Use wildcards: `.env*` covers all env variants. Add `prisma/dev.db*` for both db and journal. Also add `.next/` since Next.js server bundles may contain interpolated env vars.
**Warning signs:** Claude Code references a real API key value in a response.

### Pitfall 2: `sanitize-output.ts` Over-Redacting
**What goes wrong:** Generic patterns (`/[A-Z_]+=\S+/`) redact workspace slugs, campaign names, variable names — making CLI output unreadable.
**Why it happens:** Trying to be comprehensive rather than targeted.
**How to avoid:** Pattern match on known prefixes (`sk-ant-`, `tr_`, `re_`, `xoxb-`) + explicit env var names (`DATABASE_URL=`, `ANTHROPIC_API_KEY=`). Add a test case with sample output before finalizing patterns.
**Warning signs:** CLI output shows `[REDACTED:SECRET]` for workspace name `rise` or campaign slug.

### Pitfall 3: Rules File Content Doesn't Match Agent Behavior
**What goes wrong:** Extracting system prompt to rules file but forgetting to update the TS agent — both copies exist, the hardcoded one wins.
**Why it happens:** Incomplete refactor — extract was done but old const was not replaced with `loadRules()` call.
**How to avoid:** After extraction, delete the original `const AGENT_SYSTEM_PROMPT` block and replace with the dynamic load. Run the agent once to verify it still works.
**Warning signs:** Changes to `.claude/rules/writer-rules.md` have no effect on API agent behavior.

### Pitfall 4: Rules Files Accidentally Gitignored
**What goes wrong:** `.claude/rules/*.md` gets excluded from git and the single source of truth disappears on another machine.
**Why it happens:** Overly broad `.gitignore` patterns like `.claude/` (if added).
**How to avoid:** Check `.gitignore` before creating `.claude/rules/`. Currently `.gitignore` does not exclude `.claude/`. Rules files SHOULD be committed — they are code, not secrets.
**Warning signs:** `git status` shows `.claude/rules/` as ignored.

### Pitfall 5: `process.cwd()` Fails in Compiled dist/cli/
**What goes wrong:** Rules loading via `fs.readFileSync(join(process.cwd(), '.claude/rules/...'))` works in `npx tsx` context but fails when called from `dist/cli/` scripts because cwd differs.
**Why it happens:** `process.cwd()` is runtime-dependent; compiled scripts may run from a different directory.
**How to avoid:** Use `__dirname` relative path for compiled scripts OR always invoke scripts from the project root (document this requirement). The `nova.md` skill already uses `cd /Users/jjay/programs/outsignal-agents` — same pattern works.
**Warning signs:** Agent silently falls back to empty rules (the `catch` block in `loadRules` returns `''`).

---

## Code Examples

### `.claudeignore` — Complete File
```
# Secrets and credentials — never load into agent context
.env
.env.*
.env*.local

# Database files
prisma/dev.db
prisma/dev.db-journal

# Build output (may contain env interpolation)
.next/
dist/
.trigger/

# Vercel deployment config (contains project IDs, may reference tokens)
.vercel/

# Dependencies and caches
node_modules/
worker/node_modules/
coverage/

# OS artifacts
.DS_Store
*.pem
```

### `sanitize-output.ts` — Test Case Sketch
```typescript
// Verify sanitizer does not over-redact
const sampleOutput = `
Workspace: rise
Campaigns found: 3
DATABASE_URL=postgresql://user:super_secret@neon.tech/db
ANTHROPIC_API_KEY=sk-ant-api03-abc123def456
Campaign "Rise Q2 Email" — status: draft
Contact: april@rise.co (FIRSTNAME=April, COMPANYNAME=Rise)
`;

const sanitized = sanitizeOutput(sampleOutput);
// Expected: DATABASE_URL and API key redacted, workspace/campaign/contact preserved
assert(sanitized.includes('[REDACTED:DATABASE_URL]'));
assert(sanitized.includes('[REDACTED:ANTHROPIC_KEY]'));
assert(sanitized.includes('Workspace: rise'));   // NOT redacted
assert(sanitized.includes('april@rise.co'));      // NOT redacted (PII stays)
assert(sanitized.includes('Rise Q2 Email'));      // NOT redacted
```

### Rules File `loadRules` Utility
```typescript
// src/lib/agents/load-rules.ts
import { readFileSync } from 'fs';
import { join } from 'path';

export function loadRules(filename: string): string {
  // Always resolve relative to project root, not cwd
  // PROJECT_ROOT can be set as env var for compiled contexts
  const root = process.env.PROJECT_ROOT ?? join(__dirname, '..', '..', '..');
  const rulesPath = join(root, '.claude', 'rules', filename);
  try {
    return readFileSync(rulesPath, 'utf-8');
  } catch (err) {
    console.warn(`[nova] Rules file not found: ${rulesPath}. Agent running without loaded rules.`);
    return '';
  }
}
```

### `ARCHITECTURE.md` Key Sections
The architecture doc locks the dual-mode strategy. Key sections to include:
1. **Overview** — CLI skills vs API agents, when each is used
2. **Dual-mode strategy** — shared rules as single source of truth
3. **`.claude/rules/` contract** — how skills reference them (! syntax), how API agents load them (readFileSync)
4. **Secret handling** — `.claudeignore` + `sanitize-output.ts` + what is redacted vs preserved
5. **200-line skill budget** — what goes in skill files vs rules files
6. **Memory namespace** — preview of Phase 47 decisions (`.nova/memory/{slug}/`)
7. **Skill registry** — full list of 8 skills with command names

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded prompts in TypeScript | Prompts in `.md` files loaded at runtime | Phase 46 (this phase) | Rules editable without TypeScript recompile; shareable with CLI skills |
| API agent only (`runWriterAgent()`) | CLI skill + API fallback (dual-mode) | Phase 46 foundation, Phase 49 implementation | Zero Anthropic API cost for CLI sessions |
| No secret protection for CLI context | `.claudeignore` + `sanitize-output.ts` | Phase 46 (this phase) | CVE-2025-59536 credential exposure mitigated |

**Deprecated/outdated:**
- `const AGENT_SYSTEM_PROMPT` blocks hardcoded in TypeScript: replaced by `loadRules()` + `.claude/rules/*.md` after Phase 46 refactor.

---

## Open Questions

1. **`__dirname` availability in compiled `dist/cli/` scripts**
   - What we know: `process.cwd()` is unreliable; `__dirname` works in CommonJS but not ES modules
   - What's unclear: Whether compiled output uses CJS or ESM (tsconfig has `"module": "esnext"`)
   - Recommendation: Use `PROJECT_ROOT` env var as the safe fallback. Document in `ARCHITECTURE.md`. Phase 48 (CLI wrappers) should validate this early per STATE.md blocker note.

2. **Rules file size — are 7 files under 200 lines each?**
   - What we know: `WRITER_SYSTEM_PROMPT` alone spans ~300 lines in writer.ts (lines 387–680)
   - What's unclear: Whether writer rules will fit in 200 lines or need further sub-chunking
   - Recommendation: Writer rules can split into `writer-copy-rules.md` (quality rules) and `writer-strategies.md` if needed. This is editorial, not architectural — decide at authoring time.

3. **`readFileSync` call timing — module load vs function call**
   - What we know: Calling `readFileSync` at module load time (outside a function) fails if cwd is wrong at import time
   - What's unclear: Whether Next.js module loading context is different from CLI context
   - Recommendation: Always call `loadRules()` inside the function/closure that builds the system prompt string, not at module top level. This defers the file read to invocation time.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/lib/agents/writer.ts` (752 lines), `orchestrator.ts` (682 lines), `leads.ts` (1156 lines), `campaign.ts` (514 lines), `utils.ts` (54 lines)
- Direct file inspection: `.claude/commands/nova.md` (74 lines), `.gitignore`, `tsconfig.json`
- `.planning/phases/46-skill-architecture-foundation/46-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` — SEC-01 through SEC-05 definitions
- `.planning/STATE.md` — v7.0 decisions and blocker notes

### Secondary (MEDIUM confidence)
- Claude Code `.claudeignore` behavior: documented in Anthropic Claude Code docs (gitignore-syntax file exclusion)
- Node.js `fs.readFileSync` at runtime: standard Node.js pattern, well-understood

### Tertiary (LOW confidence)
- `__dirname` behavior in compiled ESM output — needs validation in Phase 48 (STATE.md blocker note)

---

## Metadata

**Confidence breakdown:**
- Security patterns (`.claudeignore`, sanitize-output): HIGH — locked decisions + code inspection confirms exact patterns needed
- Architecture (rules extraction, loadRules pattern): HIGH — existing agent code is the source; extraction path is clear
- Pitfalls: HIGH — derived from direct code inspection and known Node.js/TypeScript constraints

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable domain — Claude Code `.claudeignore` spec is stable; TypeScript patterns are stable)
