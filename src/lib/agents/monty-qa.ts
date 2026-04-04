import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";
import { runAgent } from "./runner";
import { montyQAOutputSchema, NOVA_MODEL } from "./types";
import type { AgentConfig, MontyQAInput, MontyQAOutput } from "./types";
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

// --- 6 QA Tools (read-only subset) ---

const checkTypes = tool({
  description:
    "Run TypeScript compilation check (tsc --noEmit)",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      return runDevCli("check-types.js");
    } catch (error) {
      return { error: error instanceof Error ? error.message : "check-types failed" };
    }
  },
});

const runTests = tool({
  description:
    "Run vitest tests — target specific file paths for efficiency",
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
      return { error: error instanceof Error ? error.message : "run-tests failed" };
    }
  },
});

const readFileTool = tool({
  description:
    "Read a file's contents for code review",
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
      return { error: error instanceof Error ? error.message : "read-file failed" };
    }
  },
});

const listFiles = tool({
  description:
    "List files in a directory to find related code",
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
      return { error: error instanceof Error ? error.message : "list-files failed" };
    }
  },
});

const searchCode = tool({
  description:
    "Search for patterns across the codebase — use for dead code detection and pattern consistency checks",
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
      return { error: error instanceof Error ? error.message : "search-code failed" };
    }
  },
});

const gitDiff = tool({
  description:
    "Show git diff to understand what changed",
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
      return { error: error instanceof Error ? error.message : "git-diff failed" };
    }
  },
});

// --- Tool Export ---

export const montyQATools = {
  checkTypes,
  runTests,
  readFile: readFileTool,
  listFiles,
  searchCode,
  gitDiff,
};

// --- System Prompt ---

const MONTY_QA_SYSTEM_PROMPT = `You are the Monty QA Agent — an adversarial code reviewer for the Outsignal project.

You review code changes and find REAL PROBLEMS. You are not here to rubber-stamp. You are here to catch bugs, inconsistencies, dead code, and test gaps before they ship.

## Review Process
1. Read the changed files using readFile
2. Run checkTypes to catch TypeScript compilation errors
3. Run runTests on affected test files (identify test files from changedFiles paths — look for .test.ts or .spec.ts siblings)
4. Use searchCode to check pattern consistency (naming conventions, import patterns, error handling)
5. Use searchCode for dead code detection: find exports with no importers in src/, scripts/, trigger/
6. Check API integrations for pagination, error handling, and rate limit compliance

## Minimum Findings Rule (MANDATORY)
Every review MUST produce at least 3 findings. If the code is genuinely clean:
1. Look harder — check edge cases, error paths, null handling
2. Check test coverage — are there untested code paths?
3. Check for improvements — performance, naming, documentation gaps
4. If still < 3 genuine findings after thorough review: you MUST still provide findings but can use "info" severity for observations. Include explicit justification in reviewSummary explaining what you checked.

## Finding Severity
- critical: Will break production (type errors, missing null checks on critical paths, auth bypasses)
- high: Likely to cause bugs (unhandled error paths, missing validation, race conditions)
- medium: Code quality issues (inconsistent patterns, missing error handling on non-critical paths)
- low: Minor improvements (better naming, minor refactoring opportunities)
- info: Observations and suggestions (documentation gaps, test coverage notes)

## Dead Code Detection Rules
Only flag exports as dead code if:
(a) Not imported anywhere in src/, scripts/, trigger/ directories
(b) Not exported from a barrel/index file
(c) Not an API route handler (GET, POST, PUT, DELETE exports in route.ts files)
(d) Not a CLI script entry point
When uncertain, use "info" severity.

## API Integration Review
When reviewing API client code, check:
- Pagination: Does it handle multi-page responses? Does it use the established client (not raw fetch)?
- Error handling: Are errors caught and wrapped properly?
- Rate limits: Are there retry/backoff mechanisms where expected?

## Cross-Team Awareness
If your findings affect Nova agents (e.g., a bug in a CLI tool that agents use, a broken API endpoint, a type change in shared types):
- Set affectsNova: true
- Include a clear novaNotification describing the impact

## Output Format
Return a JSON object:
{
  "reviewSummary": "Overall assessment of code quality",
  "findings": [{ file, line?, severity, category, description, suggestion }],
  "testsRun": true/false,
  "testsPassed": true/false,
  "testDetails": "Optional: specific test results",
  "affectsNova": false,
  "novaNotification": "Optional: what Nova agents need to know",
  "changeType": "qa-finding"
}

${loadRules("monty-qa-rules.md")}`;

// --- Agent Config ---

export const montyQAConfig: AgentConfig = {
  name: "monty-qa",
  model: NOVA_MODEL,
  systemPrompt: MONTY_QA_SYSTEM_PROMPT,
  tools: montyQATools,
  maxSteps: 15,
  memoryRoot: ".monty/memory",
  outputSchema: montyQAOutputSchema,
  onComplete: async (result, _options) => {
    const output = result.output as MontyQAOutput;

    // Write critical/high findings to incidents.md (QA-07)
    const criticalFindings = output?.findings?.filter(
      (f) => f.severity === "critical" || f.severity === "high",
    );
    if (criticalFindings && criticalFindings.length > 0) {
      const summary = criticalFindings
        .map((f) => `${f.severity.toUpperCase()}: ${f.file} — ${f.description}`)
        .join("; ");
      await appendToMontyMemory("incidents.md", `QA Review: ${summary}`);
    }

    // Cross-team notification when QA findings affect Nova (QA-08)
    if (output?.affectsNova && output?.novaNotification) {
      const changeType = output.changeType ?? "qa-finding";
      await appendToGlobalMemory(
        `[CROSS-TEAM] [Source: monty-qa] [Type: ${changeType}] ${output.novaNotification}`,
      );
    }
  },
};

// --- Run Wrapper ---

function buildQAMessage(input: MontyQAInput): string {
  let message = `Task: ${input.task}`;
  if (input.changedFiles && input.changedFiles.length > 0) {
    message += `\n\nChanged files:\n${input.changedFiles.map((f) => `- ${f}`).join("\n")}`;
  }
  return message;
}

export async function runMontyQAAgent(
  input: MontyQAInput,
): Promise<MontyQAOutput> {
  const userMessage = buildQAMessage(input);

  try {
    const result = await runAgent<MontyQAOutput>(montyQAConfig, userMessage, {
      triggeredBy: "orchestrator",
    });
    return result.output;
  } catch (error) {
    console.error("[monty-qa] Agent failed:", error);
    throw error;
  }
}
