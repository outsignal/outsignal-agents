import { readFileSync } from "fs";
import { join } from "path";

/**
 * Load a rules file from .claude/rules/ at invocation time.
 *
 * Used by API agents to inject shared behavioral rules into system prompts.
 * CLI skills reference the same files via ! (file include) syntax.
 *
 * Resolution order:
 *   1. PROJECT_ROOT env var (needed for compiled dist/cli/ scripts)
 *   2. __dirname relative navigation: src/lib/agents/ -> project root
 */
export function loadRules(filename: string): string {
  const projectRoot =
    process.env.PROJECT_ROOT ?? join(__dirname, "..", "..", "..");
  const rulesPath = join(projectRoot, ".claude", "rules", filename);

  try {
    return readFileSync(rulesPath, "utf-8");
  } catch {
    console.warn(`[nova] Rules file not found: ${rulesPath}`);
    return "";
  }
}
