import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Block direct Anthropic API usage — forces Claude Code CLI path (Max plan).
  // See memory/feedback_nova_no_api.md for history (4 incidents, ~$35 burned).
  {
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "@ai-sdk/anthropic",
            message: "Direct Anthropic API calls bypass Max plan and incur billing. Use Claude Code CLI (see ~/.claude/commands/nova.md). Allow-listed: src/lib/icp/scorer.ts (Haiku, deliberate exception). See memory/feedback_nova_no_api.md.",
          },
          {
            name: "@anthropic-ai/sdk",
            message: "Direct Anthropic API calls bypass Max plan and incur billing. Use Claude Code CLI. See memory/feedback_nova_no_api.md.",
          },
          {
            name: "ai",
            importNames: ["generateText", "generateObject"],
            message: "generateText/generateObject hit the Anthropic API directly, bypassing Max plan. Use Claude Code CLI. Allow-listed: src/lib/icp/scorer.ts. See memory/feedback_nova_no_api.md.",
          },
        ],
      }],
    },
  },
  // Allow-list: server-side AI workloads (webhooks, cron, serverless) + ICP scorer + tests.
  // Rule of thumb — if there's no human at a terminal when it runs, API use is permitted here.
  // All interactive CLI entry points that previously used generateText/generateObject have been
  // removed or reduced to thin launchers (BL-060). Remaining runAgent() call paths are purely
  // server-side (specialists called from /api/chat route handler and trigger/ jobs) and
  // Vercel production deploys have no Max plan access — API use is correct here.
  {
    files: [
      "src/lib/icp/**",
      "src/lib/agents/**",
      "src/lib/reply-analysis.ts",
      "src/lib/classification/**",
      "src/lib/ooo/**",
      "src/lib/normalizer/**",
      "src/lib/analytics/**",
      "src/lib/insights/**",
      "src/lib/support/**",
      "src/app/api/**",
      "trigger/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
