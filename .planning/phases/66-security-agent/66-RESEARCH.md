# Phase 66: Security Agent - Research

**Researched:** 2026-04-04
**Domain:** AI agent security review (OWASP compliance, credential scanning, auth gating)
**Confidence:** HIGH

## Summary

Phase 66 builds the fourth and final Monty team agent: a Security Agent that acts as a deployment gate for changes touching auth, credentials, or session management. The implementation follows the exact same pattern as monty-qa.ts (Phase 65) -- types in types.ts, agent module with tools in monty-security.ts, orchestrator delegation via runMontySecurityAgent, and memory write-back hooks.

The Security Agent is a **read-only reviewer** (like QA). It does not fix code -- it reports findings and can BLOCK deployment by returning a `blockDeploy: true` flag that the orchestrator respects. The agent reuses the same 6 dev-cli tools as QA (checkTypes, readFile, listFiles, searchCode, gitDiff, runTests) plus a new `npmAudit` tool. The existing stub in monty-orchestrator.ts (lines 75-92) needs to be replaced with a real delegation that calls `runMontySecurityAgent`.

**Primary recommendation:** Clone the monty-qa.ts pattern exactly. Add MontySecurityInput/Output types to types.ts, create monty-security.ts with 7 tools (QA's 6 + npmAudit), wire the orchestrator stub to the real agent, and update the system prompt to remove the "Security Agent not yet built" note.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | OWASP Top 10:2025 compliance check on code changes touching auth, input handling, or data access | System prompt embeds OWASP Top 10:2025 checklist (A01-A10). Agent uses readFile + searchCode to analyse changed files against each category. No external library needed -- LLM-driven analysis with checklist enforcement. |
| SEC-02 | Credential exposure detection -- scan for hardcoded secrets, API keys in source, .env values in logs | searchCode tool with regex patterns for secrets (API_KEY, SECRET, TOKEN, password, hardcoded strings). System prompt includes specific regex patterns and file exclusion rules (.gitignore check). |
| SEC-03 | Auth flow review -- authentication, session handling, API key management, token storage | readFile tool on auth-related files (src/app/api/auth/, middleware.ts, lib/tokens.ts, lib/session.ts). System prompt includes auth-specific review checklist from monty-security-rules.md. |
| SEC-04 | On-call gate -- changes touching auth/credentials/sessions blocked until Security Agent reviews | MontySecurityOutput includes `blockDeploy: boolean` and `gateReason?: string`. Orchestrator checks this flag and blocks further pipeline progression if true. Orchestrator system prompt already describes this flow. |
| SEC-05 | AgentConfig with security scanning tools (npm audit, eslint-plugin-security if ESLint v9 compatible) | 7 tools: 6 from QA (checkTypes, readFile, listFiles, searchCode, gitDiff, runTests) + 1 new npmAudit tool. eslint-plugin-security is SKIPPED -- ESLint v9 flat config compatibility is unverified (MEDIUM confidence concern from STATE.md), and the LLM-driven OWASP review provides equivalent coverage without the dependency risk. |
| SEC-06 | onComplete writes security findings to .monty/memory/security.md | onComplete hook filters for critical/high findings and writes to security.md via appendToMontyMemory("security.md", ...). Same pattern as QA writing to incidents.md. |
| SEC-07 | Writes to .nova/memory/global-insights.md when security findings affect Nova agent behaviour | onComplete checks output.affectsNova flag and writes output.novaNotification to global-insights.md via appendToGlobalMemory(). Identical pattern to QA agent. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (AI SDK) | 6.x (already installed) | Agent framework, tool() function | All Monty agents use this |
| zod | 4.x (already installed) | Input/output schema validation | All Monty agents use this |
| child_process | Node built-in | execSync for dev-cli and npm audit | Same as monty-qa.ts pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | No new dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LLM-driven OWASP review | eslint-plugin-security | eslint-plugin-security requires ESLint v9 flat config verification (MEDIUM confidence). LLM review is more comprehensive (covers all OWASP Top 10, not just a subset of JS patterns). Skip the dependency. |
| Custom secret scanner | gitleaks / trufflehog | External binary dependency. searchCode with regex patterns achieves the same result within the existing tool surface. No need for external tools. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/lib/agents/
├── types.ts              # Add MontySecurityInput, MontySecurityFinding, MontySecurityOutput, montySecurityOutputSchema
├── monty-security.ts     # NEW: Security agent (mirrors monty-qa.ts exactly)
├── monty-orchestrator.ts # MODIFY: Replace stub with real delegation
├── monty-qa.ts           # Reference pattern (read-only reviewer)
├── monty-dev.ts          # Reference pattern (generalist agent)
└── memory.ts             # appendToMontyMemory, appendToGlobalMemory (no changes)
```

### Pattern 1: Security Agent Module (mirrors monty-qa.ts)
**What:** A read-only agent with tools, system prompt, AgentConfig, onComplete hooks, and runMontySecurityAgent export
**When to use:** This is the only pattern -- all Monty agents follow it
**Structure:**
```typescript
// 1. Dev-CLI wrapper (reuse from monty-qa.ts pattern)
function runDevCli(script: string, args: string[] = []): unknown { ... }

// 2. Tools (6 from QA + 1 new npmAudit)
const npmAudit = tool({
  description: "Run npm audit and return vulnerability report with severity levels",
  inputSchema: z.object({}),
  execute: async () => {
    const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
    const result = execSync("npm audit --json", {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result);
  },
});

// 3. System prompt with OWASP checklist + security rules
const MONTY_SECURITY_SYSTEM_PROMPT = `...${loadRules("monty-security-rules.md")}`;

// 4. AgentConfig with onComplete hooks
export const montySecurityConfig: AgentConfig = { ... };

// 5. Run wrapper
export async function runMontySecurityAgent(input: MontySecurityInput): Promise<MontySecurityOutput> { ... }
```

### Pattern 2: Orchestrator Delegation (mirrors delegateToQA)
**What:** Replace the stub delegateToSecurity tool with a real delegation that calls runMontySecurityAgent
**When to use:** When wiring the security agent into the orchestrator
**Key change:** The stub at lines 75-92 of monty-orchestrator.ts becomes a real tool that:
1. Calls `runMontySecurityAgent({ task, changedFiles })`
2. Returns the structured output including `blockDeploy` flag
3. Orchestrator system prompt updated to remove "Security Agent not yet built" note

### Pattern 3: npmAudit Tool
**What:** A tool that runs `npm audit --json` and returns parsed vulnerability data
**Why separate from dev-cli:** npm audit is security-specific and returns large JSON output. It does not fit the dev-cli harness pattern (which expects `{ ok, data }` envelope). Better to run it directly with execSync.
**Important:** `npm audit` returns exit code 1 when vulnerabilities are found. The tool must catch this and still parse the JSON output (the JSON is written to stdout regardless of exit code).
```typescript
execute: async () => {
  try {
    const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
    // npm audit exits non-zero when vulns found -- that is expected
    const result = execSync("npm audit --json 2>/dev/null", {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch (error: unknown) {
    // execSync throws on non-zero exit. stdout is still in error.stdout
    if (error && typeof error === "object" && "stdout" in error) {
      try {
        return JSON.parse((error as { stdout: string }).stdout);
      } catch { /* fall through */ }
    }
    return { error: "npm audit failed" };
  }
}
```

### Anti-Patterns to Avoid
- **Adding eslint-plugin-security as a dependency:** ESLint v9 flat config compatibility is unverified. The LLM-driven review covers more ground. Do not add it.
- **Making the Security Agent write code:** It is a reviewer, not a fixer. It reports findings. The Dev Agent fixes them.
- **Using a minimum findings rule (like QA):** Security is binary -- either there are real vulnerabilities or there are not. Unlike QA, do NOT enforce a minimum finding count. False positives erode trust in the security gate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret scanning | Custom regex parser | searchCode tool with patterns | Already available, covers the codebase |
| npm audit parsing | Custom vulnerability DB | `npm audit --json` | Built into npm, maintained by npm team |
| OWASP compliance | Checklist validation code | LLM system prompt with OWASP categories | LLM can reason about code context, not just pattern match |
| Memory write-back | Custom file operations | `appendToMontyMemory` / `appendToGlobalMemory` | Already built and used by QA and Dev agents |

**Key insight:** The Security Agent's intelligence comes from the LLM's system prompt, not from external scanning tools. The tools give it READ access to the codebase; the LLM applies security expertise.

## Common Pitfalls

### Pitfall 1: npm audit non-zero exit code
**What goes wrong:** `execSync` throws when `npm audit` finds vulnerabilities (exit code 1). If not handled, the tool returns an error instead of the audit results.
**Why it happens:** npm audit is designed to exit non-zero as a CI signal. execSync treats non-zero as an error.
**How to avoid:** Wrap in try/catch, parse `error.stdout` when execSync throws. The JSON output is still in stdout.
**Warning signs:** npmAudit tool always returns `{ error: "..." }` instead of vulnerability data.

### Pitfall 2: blockDeploy flag not respected by orchestrator
**What goes wrong:** Security agent returns `blockDeploy: true` but the orchestrator continues the pipeline.
**Why it happens:** The orchestrator's system prompt must explicitly check the security output and halt.
**How to avoid:** Update the orchestrator system prompt to include: "If Security Agent returns blockDeploy: true, STOP the pipeline. Report the findings to the user and wait for explicit approval before proceeding."
**Warning signs:** Auth changes getting deployed without security review completing.

### Pitfall 3: Over-reporting false positives
**What goes wrong:** Security agent flags every API key reference, even legitimate env var usage in server-side code.
**Why it happens:** Naive pattern matching without context awareness.
**How to avoid:** System prompt must distinguish between: (a) hardcoded secrets in source files (CRITICAL), (b) `process.env.API_KEY` usage in server code (SAFE), (c) env var names appearing in client-side code (POTENTIAL ISSUE).
**Warning signs:** Every review producing 10+ findings, mostly false positives.

### Pitfall 4: MontyMemoryFile type does not include "security.md"
**What goes wrong:** `appendToMontyMemory("security.md", ...)` fails to compile because "security.md" is not in the MontyMemoryFile union type.
**Why it happens:** The type was defined in Phase 62 and may not include all files.
**How to avoid:** Check the MontyMemoryFile type in memory.ts. If "security.md" is not included, add it.
**Warning signs:** TypeScript compilation error on the onComplete hook.

## Code Examples

### MontySecurityInput/Output Types (add to types.ts)
```typescript
// --- Monty Security Agent ---

export interface MontySecurityInput {
  task: string;
  changedFiles?: string[];
}

export interface MontySecurityFinding {
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  category:
    | "secrets-exposure"
    | "auth-bypass"
    | "input-validation"
    | "injection"
    | "xss"
    | "csrf"
    | "rate-limiting"
    | "error-leakage"
    | "dependency-vuln"
    | "owasp-compliance";
  owaspCategory?: string; // e.g. "A01:2025 Broken Access Control"
  description: string;
  remediation: string;
}

export interface MontySecurityOutput {
  reviewSummary: string;
  findings: MontySecurityFinding[];
  blockDeploy: boolean;
  gateReason?: string; // Required when blockDeploy is true
  npmAuditRun: boolean;
  npmAuditSummary?: string;
  affectsNova: boolean;
  novaNotification?: string;
}
```

### montySecurityOutputSchema (add to types.ts)
```typescript
export const montySecurityOutputSchema = z.object({
  reviewSummary: z.string(),
  findings: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      category: z.enum([
        "secrets-exposure",
        "auth-bypass",
        "input-validation",
        "injection",
        "xss",
        "csrf",
        "rate-limiting",
        "error-leakage",
        "dependency-vuln",
        "owasp-compliance",
      ]),
      owaspCategory: z.string().optional(),
      description: z.string(),
      remediation: z.string(),
    }),
  ),
  blockDeploy: z.boolean(),
  gateReason: z.string().optional(),
  npmAuditRun: z.boolean(),
  npmAuditSummary: z.string().optional(),
  affectsNova: z.boolean(),
  novaNotification: z.string().optional(),
});
```

### Orchestrator Delegation Replacement (monty-orchestrator.ts)
```typescript
// Replace the stub at lines 75-92 with:
import { runMontySecurityAgent } from "./monty-security";

const delegateToSecurity = tool({
  description:
    "Delegate a security review to the Security Agent. Use for: auth changes, credential handling, deployment gates.",
  inputSchema: z.object({
    task: z.string().describe("What the Security Agent should review"),
    changedFiles: z
      .array(z.string())
      .optional()
      .describe("File paths that changed"),
  }),
  execute: async ({ task, changedFiles }) => {
    try {
      const result = await runMontySecurityAgent({ task, changedFiles });
      return {
        status: "complete" as const,
        reviewSummary: result.reviewSummary,
        findings: result.findings,
        blockDeploy: result.blockDeploy,
        gateReason: result.gateReason,
        npmAuditRun: result.npmAuditRun,
        affectsNova: result.affectsNova,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        error: error instanceof Error ? error.message : "Security Agent failed",
      };
    }
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OWASP Top 10:2021 | OWASP Top 10:2025 | 2025 | A11 renamed, categories reshuffled. System prompt must reference 2025 edition. |
| eslint-plugin-security | LLM-driven review | Project decision (STATE.md) | Avoids ESLint v9 flat config compatibility risk. LLM covers more patterns. |

**Deprecated/outdated:**
- eslint-plugin-security: Skipped due to ESLint v9 flat config compatibility uncertainty. Not a blocker -- LLM review is superior for this use case.

## Open Questions

1. **MontyMemoryFile union type**
   - What we know: QA uses `appendToMontyMemory("incidents.md", ...)`. Security needs `appendToMontyMemory("security.md", ...)`.
   - What's unclear: Whether "security.md" is already in the MontyMemoryFile type (it was defined in Phase 62 foundation).
   - Recommendation: Check memory.ts during implementation. If missing, add it. LOW risk -- simple type union change.

2. **OWASP Top 10:2025 exact categories**
   - What we know: The 2025 edition exists and is the current standard.
   - What's unclear: Whether category IDs changed from 2021 (A01-A10 numbering).
   - Recommendation: Use the categories from the existing monty-security-rules.md checklist (secrets exposure, auth bypass, input validation, SQL injection, XSS, CSRF, rate limiting, error leakage). These map cleanly to OWASP regardless of exact numbering.

## Implementation Plan Summary

The phase splits naturally into **2 plans** (matching Phase 65 QA pattern):

**Plan 01: Security Agent Module**
1. Add MontySecurityInput, MontySecurityFinding, MontySecurityOutput types to types.ts
2. Add montySecurityOutputSchema to types.ts
3. Create monty-security.ts with 7 tools (6 from QA + npmAudit)
4. System prompt with OWASP checklist, credential scanning patterns, and auth review checklist
5. onComplete hooks for security.md and global-insights.md
6. Export runMontySecurityAgent

**Plan 02: Orchestrator Security Integration**
1. Replace delegateToSecurity stub with real delegation calling runMontySecurityAgent
2. Update orchestrator system prompt: remove "not yet built" note, add blockDeploy gate enforcement
3. Import runMontySecurityAgent in monty-orchestrator.ts

**Files to modify:** `src/lib/agents/types.ts`, `src/lib/agents/monty-orchestrator.ts`
**Files to create:** `src/lib/agents/monty-security.ts`
**Dependencies:** None new. All tools, utilities, and patterns already exist.

## Sources

### Primary (HIGH confidence)
- `src/lib/agents/monty-qa.ts` - Direct pattern to clone (read in full)
- `src/lib/agents/monty-orchestrator.ts` - Stub to replace (read in full)
- `src/lib/agents/types.ts` - Type patterns to follow (read lines 290-369)
- `.claude/rules/monty-security-rules.md` - Security review checklist and rules (read in full)
- `.planning/REQUIREMENTS.md` - SEC-01 through SEC-07 definitions (read in full)

### Secondary (MEDIUM confidence)
- `npm audit --json` output format verified by running locally (produces auditReportVersion 2 JSON)
- ESLint v9 flat config present in project (eslint.config.mjs) -- eslint-plugin-security compatibility not verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all patterns proven in Phase 65
- Architecture: HIGH - Exact clone of monty-qa.ts with security-specific additions
- Pitfalls: HIGH - npm audit exit code, blockDeploy enforcement, false positive management all documented

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (stable -- no external dependencies)
