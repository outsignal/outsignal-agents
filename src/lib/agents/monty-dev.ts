import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";
import { runAgent } from "./runner";
import { montyDevOutputSchema, NOVA_MODEL } from "./types";
import type { AgentConfig, MontyDevInput, MontyDevOutput } from "./types";
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

// --- 9 Dev Agent Tools ---

const gitStatus = tool({
  description:
    "Check git working tree status — branch, clean/dirty, changed files",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      return runDevCli("git-status.js");
    } catch (error) {
      return { error: error instanceof Error ? error.message : "git-status failed" };
    }
  },
});

const gitDiff = tool({
  description:
    "Show git diff output — defaults to unstaged changes, pass staged=true for staged changes",
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

const gitLog = tool({
  description:
    "Show recent git commit history — defaults to 10 commits",
  inputSchema: z.object({
    count: z
      .number()
      .optional()
      .default(10)
      .describe("Number of commits to show (default 10)"),
  }),
  execute: async ({ count }) => {
    try {
      return runDevCli("git-log.js", ["--count", String(count)]);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "git-log failed" };
    }
  },
});

const readFileTool = tool({
  description:
    "Read a file's contents — optionally specify line range with start and end",
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
    "List files in a directory — optionally filter by glob pattern",
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
    "Search for a pattern across the codebase — returns matching lines with file paths",
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

const runTests = tool({
  description:
    "Run tests via vitest — optionally target a specific test file or directory",
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

const checkTypes = tool({
  description:
    "Run TypeScript type checking (tsc --noEmit) — returns errors if any",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      return runDevCli("check-types.js");
    } catch (error) {
      return { error: error instanceof Error ? error.message : "check-types failed" };
    }
  },
});

const deployStatus = tool({
  description:
    "Check current deployment status — shows recent Vercel and Trigger.dev deployments",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      return runDevCli("deploy-status.js");
    } catch (error) {
      return { error: error instanceof Error ? error.message : "deploy-status failed" };
    }
  },
});

// --- Tool Export ---

export const montyDevTools = {
  gitStatus,
  gitDiff,
  gitLog,
  readFile: readFileTool,
  listFiles,
  searchCode,
  runTests,
  checkTypes,
  deployStatus,
};

// --- System Prompt ---

const MONTY_DEV_SYSTEM_PROMPT = `You are the Monty Dev Agent — a platform engineering generalist for the Outsignal project.

You handle backend, frontend, and infrastructure tasks delegated by the Monty Orchestrator.

## Capabilities
- Backend: API routes, Prisma schema/queries, server logic, Trigger.dev tasks
- Frontend: React components, pages, design system (reference UI UX Pro Max skill)
- Infrastructure: deploy config, Railway, Vercel, Trigger.dev, DNS

## Action Tiers
- Tier 1 (read-only): All tools available to you are Tier 1. Use freely.
- Tier 2 (reversible): File edits, git branches, dev dependency installs. Log to decisions.md before executing. The orchestrator handles approval.
- Tier 3 (gated): DB migrations, production deploys, env var changes. The orchestrator gates these — you will not be asked to execute Tier 3 directly.

## Memory Context
Your memory context from .monty/memory/ is loaded automatically. Reference past decisions and architecture patterns before acting.

## Cross-Team Awareness
When your changes affect Nova agents (new CLI scripts, API changes, schema modifications that impact agent tools):
- Set affectsNova: true in your output
- Include a clear novaNotification describing what changed and how it impacts Nova

## Output Format
Return a JSON object with this structure:
\`\`\`json
{
  "action": "What was done (verb phrase)",
  "summary": "Human-readable summary of the work",
  "filesChanged": ["absolute/path/to/file.ts"],
  "affectsNova": false,
  "novaNotification": "Optional: what Nova agents need to know",
  "changeType": "schema-change | api-change | tool-change | config-change"
}
\`\`\`

${loadRules("monty-dev-rules.md")}`;

// --- Agent Config ---

export const montyDevConfig: AgentConfig = {
  name: "monty-dev",
  model: NOVA_MODEL,
  systemPrompt: MONTY_DEV_SYSTEM_PROMPT,
  tools: montyDevTools,
  maxSteps: 15,
  memoryRoot: ".monty/memory",
  outputSchema: montyDevOutputSchema,
  onComplete: async (result, _options) => {
    const output = result.output as MontyDevOutput;

    // Write session summary to decisions.md (DEV-08)
    if (output?.action && output?.summary) {
      await appendToMontyMemory(
        "decisions.md",
        `Dev: ${output.action} — ${output.summary}`,
      );
    }

    // Cross-team notification when platform changes affect Nova (DEV-09)
    if (output?.affectsNova && output?.novaNotification) {
      const changeType = output.changeType ?? "tool-change";
      await appendToGlobalMemory(
        `[CROSS-TEAM] [Source: monty-dev] [Type: ${changeType}] ${output.novaNotification}`,
      );
    }
  },
};

// --- Run Wrapper ---

function buildDevMessage(input: MontyDevInput): string {
  return `Task: ${input.task}\nAction Tier: ${input.tier}`;
}

export async function runMontyDevAgent(
  input: MontyDevInput,
): Promise<MontyDevOutput> {
  const userMessage = buildDevMessage(input);

  try {
    const result = await runAgent<MontyDevOutput>(montyDevConfig, userMessage, {
      triggeredBy: "orchestrator",
    });
    return result.output;
  } catch (error) {
    console.error("[monty-dev] Agent failed:", error);
    throw error;
  }
}
