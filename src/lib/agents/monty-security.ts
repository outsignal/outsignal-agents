import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";
import { runAgent } from "./runner";
import { montySecurityOutputSchema, NOVA_MODEL } from "./types";
import type {
  AgentConfig,
  MontySecurityInput,
  MontySecurityOutput,
} from "./types";
import { loadRules } from "./load-rules";
import { appendToMontyMemory, appendToGlobalMemory } from "./memory";

// --- Dev-CLI Wrapper ---

function runDevCli(script: string, args: string[] = []): unknown {
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
  const cmd = ["node", `dist/dev-cli/${script}`, ...args].join(" ");
  const result = execSync(cmd, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const envelope = JSON.parse(result);
  if (!envelope.ok) {
    throw new Error(envelope.error ?? `${script} failed`);
  }
  return envelope.data;
}

// --- 6 Dev-CLI Tools (read-only subset, same as QA) ---

const checkTypes = tool({
  description: "Run TypeScript compilation check (tsc --noEmit)",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      return runDevCli("check-types.js");
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "check-types failed",
      };
    }
  },
});

const runTests = tool({
  description:
    "Run vitest tests -- target specific file paths for efficiency",
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe("Path to a specific test file or directory"),
  }),
  execute: async ({ path }) => {
    try {
      const args = path ? ["--path", path] : [];
      return runDevCli("run-tests.js", args);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "run-tests failed",
      };
    }
  },
});

const readFileTool = tool({
  description: "Read a file's contents for security review",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to the file"),
    start: z
      .number()
      .optional()
      .describe("Start line number (1-based)"),
    end: z
      .number()
      .optional()
      .describe("End line number (1-based, inclusive)"),
  }),
  execute: async ({ path, start, end }) => {
    try {
      const args = ["--path", path];
      if (start !== undefined) args.push("--start", String(start));
      if (end !== undefined) args.push("--end", String(end));
      return runDevCli("read-file.js", args);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "read-file failed",
      };
    }
  },
});

const listFiles = tool({
  description: "List files in a directory to find related code",
  inputSchema: z.object({
    dir: z
      .string()
      .optional()
      .describe("Directory to list (defaults to project root)"),
    glob: z
      .string()
      .optional()
      .describe("Glob pattern to filter files (e.g. '*.ts')"),
  }),
  execute: async ({ dir, glob }) => {
    try {
      const args: string[] = [];
      if (dir) args.push("--dir", dir);
      if (glob) args.push("--glob", glob);
      return runDevCli("list-files.js", args);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "list-files failed",
      };
    }
  },
});

const searchCode = tool({
  description:
    "Search for patterns across the codebase -- use for credential scanning and security pattern detection",
  inputSchema: z.object({
    pattern: z.string().describe("Regex or literal pattern to search for"),
    glob: z
      .string()
      .optional()
      .describe("Glob pattern to filter files (e.g. '*.ts')"),
  }),
  execute: async ({ pattern, glob }) => {
    try {
      const args = ["--pattern", pattern];
      if (glob) args.push("--glob", glob);
      return runDevCli("search-code.js", args);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "search-code failed",
      };
    }
  },
});

const gitDiff = tool({
  description: "Show git diff to understand what changed",
  inputSchema: z.object({
    staged: z
      .boolean()
      .optional()
      .describe("If true, show staged changes only"),
  }),
  execute: async ({ staged }) => {
    try {
      const args = staged ? ["--staged"] : [];
      return runDevCli("git-diff.js", args);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "git-diff failed",
      };
    }
  },
});

// --- 1 New Tool: npmAudit ---

const npmAudit = tool({
  description:
    "Run npm audit and return vulnerability report with severity levels",
  inputSchema: z.object({}),
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
        } catch {
          /* fall through */
        }
      }
      return { error: "npm audit failed" };
    }
  },
});

// --- Tool Export ---

export const montySecurityTools = {
  checkTypes,
  runTests,
  readFile: readFileTool,
  listFiles,
  searchCode,
  gitDiff,
  npmAudit,
};

// --- System Prompt ---

const MONTY_SECURITY_SYSTEM_PROMPT = `You are the Monty Security Agent -- a security gate for platform engineering changes on the Outsignal project.

You review code changes for security vulnerabilities and can BLOCK deployments when critical or high severity issues are found. You are a READ-ONLY reviewer (Tier 1). You NEVER fix code -- you report findings for the Dev Agent to remediate.

## OWASP Top 10:2025 Reference

Map every finding to the relevant OWASP category:

| OWASP ID | Category | Finding Category |
|----------|----------|-----------------|
| A01:2025 | Broken Access Control | auth-bypass |
| A02:2025 | Cryptographic Failures | secrets-exposure |
| A03:2025 | Injection | injection |
| A04:2025 | Insecure Design | owasp-compliance |
| A05:2025 | Security Misconfiguration | owasp-compliance |
| A06:2025 | Vulnerable and Outdated Components | dependency-vuln |
| A07:2025 | Identification and Authentication Failures | auth-bypass |
| A08:2025 | Software and Data Integrity Failures | input-validation |
| A09:2025 | Security Logging and Monitoring Failures | error-leakage |
| A10:2025 | Server-Side Request Forgery (SSRF) | injection |

## Review Process
1. Read the changed files using readFile
2. Run checkTypes to verify TypeScript compilation
3. Run npmAudit to check for dependency vulnerabilities
4. Use searchCode to scan for credential patterns
5. Use gitDiff to understand the scope of changes
6. Review auth flows, input validation, and error handling

## Credential Scanning Guidance

Scan for these patterns using searchCode:

### CRITICAL (hardcoded secrets in source)
- Regex: \`(api[_-]?key|secret|token|password|auth)\\s*[:=]\\s*['"][A-Za-z0-9+/=]{16,}['"]\`
- Regex: \`Bearer\\s+[A-Za-z0-9._~+/=-]{20,}\`
- Hardcoded connection strings with embedded passwords

### SAFE (expected patterns)
- \`process.env.API_KEY\`, \`process.env.SECRET\` -- server-side env var access is correct
- Secret names in .env.example with placeholder values
- Test fixtures with obviously fake credentials

### POTENTIAL ISSUE (flag for review)
- Env var names referenced in client-side code (files under src/app/ without "api" in path)
- Secrets logged to console.log or console.error
- Credentials passed as URL query parameters

## Auth Flow Review Checklist
- Are all API routes behind authentication middleware?
- Are admin-only routes checking role/permissions?
- Is session handling using secure cookies (httpOnly, secure, sameSite)?
- Are API keys validated with constant-time comparison?
- Are tokens expiring and being rotated?
- Is CORS configured to restrict origins?

## Deployment Gate Rule
Set blockDeploy=true if ANY critical or high severity finding is unresolved. Include a clear gateReason explaining why deployment should be blocked. The orchestrator will halt the pipeline and require human approval to proceed.

## NO Minimum Findings Rule
Only report REAL vulnerabilities. Do not fabricate findings to meet a quota. False positives erode trust in the security gate. If the code is clean, say so and return an empty findings array.

## Output Format
Return a JSON object matching this schema:
{
  "reviewSummary": "Overall security assessment",
  "findings": [{ file, line?, severity, category, owaspCategory?, description, remediation }],
  "blockDeploy": false,
  "gateReason": "Optional: why deployment is blocked",
  "npmAuditRun": true,
  "npmAuditSummary": "Optional: summary of npm audit results",
  "affectsNova": false,
  "novaNotification": "Optional: what Nova agents need to know"
}

## Cross-Team Awareness
If your findings affect Nova agents (e.g., a vulnerability in a shared API endpoint, auth bypass on a route Nova agents call):
- Set affectsNova: true
- Include a clear novaNotification describing the security impact

${loadRules("monty-security-rules.md")}`;

// --- Agent Config ---

export const montySecurityConfig: AgentConfig = {
  name: "monty-security",
  model: NOVA_MODEL,
  systemPrompt: MONTY_SECURITY_SYSTEM_PROMPT,
  tools: montySecurityTools,
  maxSteps: 15,
  memoryRoot: ".monty/memory",
  outputSchema: montySecurityOutputSchema,
  onComplete: async (result, _options) => {
    const output = result.output as MontySecurityOutput;

    // Write critical/high findings to security.md (SEC-06)
    const serious = output?.findings?.filter(
      (f) => f.severity === "critical" || f.severity === "high",
    );
    if (serious && serious.length > 0) {
      const lines = serious
        .map(
          (f) =>
            `[${f.severity.toUpperCase()}] ${f.file}:${f.line ?? "?"} -- ${f.category}: ${f.description}`,
        )
        .join("; ");
      await appendToMontyMemory("security.md", `Security Review: ${lines}`);
    }

    // Cross-team notification to global-insights.md (SEC-07)
    if (output?.affectsNova && output?.novaNotification) {
      await appendToGlobalMemory(
        `[Monty Security] ${output.novaNotification}`,
      );
    }
  },
};

// --- Run Wrapper ---

function buildSecurityMessage(input: MontySecurityInput): string {
  let message = `Task: ${input.task}`;
  if (input.changedFiles && input.changedFiles.length > 0) {
    message += `\n\nChanged files:\n${input.changedFiles.map((f) => `- ${f}`).join("\n")}`;
  }
  return message;
}

export async function runMontySecurityAgent(
  input: MontySecurityInput,
): Promise<MontySecurityOutput> {
  const userMessage = buildSecurityMessage(input);

  try {
    const result = await runAgent<MontySecurityOutput>(
      montySecurityConfig,
      userMessage,
      {
        triggeredBy: "orchestrator",
      },
    );
    return result.output;
  } catch (error) {
    console.error("[monty-security] Agent failed:", error);
    throw error;
  }
}
