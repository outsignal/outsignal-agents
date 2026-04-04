import { appendFile, readFile, access } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { homedir } from "os";

const DEFAULT_MEMORY_ROOT = ".nova/memory";
const MAX_LINES = 200;

type MemoryFile = "campaigns.md" | "feedback.md" | "learnings.md";

interface MemoryOptions {
  memoryRoot?: string; // defaults to ".nova/memory"
}

function isValidEntry(entry: string): boolean {
  if (!entry || entry.trim().length === 0) return false;
  if (entry.includes("undefined: undefined")) return false;
  if (entry.includes("undefined --")) return false;
  if (entry.trim() === "undefined") return false;
  return true;
}

/**
 * Append an insight entry to a workspace memory file.
 *
 * - Validates the file exists (does NOT create — seed script handles that)
 * - Enforces 200-line max per governance rules
 * - Formats entry with ISO timestamp
 * - Best-effort: logs warnings on failure, never throws
 *
 * @returns true if appended, false if skipped (file missing, at capacity, etc.)
 */
export async function appendToMemory(
  slug: string,
  file: MemoryFile,
  entry: string,
): Promise<boolean> {
  try {
    const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
    const filePath = join(projectRoot, DEFAULT_MEMORY_ROOT, slug, file);

    // File must exist (seeded by nova-memory.ts)
    try {
      await access(filePath, constants.F_OK);
    } catch {
      console.warn(`[memory] File not found, skipping: ${filePath}`);
      return false;
    }

    // Enforce max line count
    const content = await readFile(filePath, "utf8");
    const lineCount = content.split("\n").length;
    if (lineCount >= MAX_LINES) {
      console.warn(
        `[memory] ${slug}/${file} at max lines (${lineCount}), skipping`,
      );
      return false;
    }

    // Validate entry content
    if (!isValidEntry(entry)) {
      console.warn(`[memory] Rejecting malformed entry for ${slug}/${file}: "${entry.slice(0, 50)}"`);
      return false;
    }

    // Append with ISO timestamp
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] — ${entry}\n`;
    await appendFile(filePath, line, "utf8");
    return true;
  } catch (error) {
    console.error(`[memory] Failed to append to ${slug}/${file}:`, error);
    return false;
  }
}

/**
 * Append an insight entry to the global-insights.md file.
 *
 * Same contract as appendToMemory but targets the cross-client
 * global-insights.md file instead of per-workspace files.
 * Enforces the 200-line cap to prevent unbounded growth.
 *
 * @returns true if appended, false if skipped
 */
export async function appendToGlobalMemory(entry: string): Promise<boolean> {
  try {
    const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
    const filePath = join(projectRoot, DEFAULT_MEMORY_ROOT, "global-insights.md");

    // File must exist (seeded by nova-memory.ts)
    try {
      await access(filePath, constants.F_OK);
    } catch {
      console.warn(`[memory] Global insights file not found, skipping: ${filePath}`);
      return false;
    }

    // Enforce max line count
    const content = await readFile(filePath, "utf8");
    const lineCount = content.split("\n").length;
    if (lineCount >= MAX_LINES) {
      console.warn(
        `[memory] global-insights.md at max lines (${lineCount}), skipping`,
      );
      return false;
    }

    // Validate entry content
    if (!isValidEntry(entry)) {
      console.warn(`[memory] Rejecting malformed global insight: "${entry.slice(0, 50)}"`);
      return false;
    }

    // Append with ISO timestamp
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${entry}\n`;
    await appendFile(filePath, line, "utf8");
    return true;
  } catch (error) {
    console.error("[memory] Failed to append to global-insights.md:", error);
    return false;
  }
}

// --- Monty Memory Namespace ---

type MontyMemoryFile = "decisions.md" | "incidents.md" | "architecture.md" | "security.md";

/**
 * Append an entry to a Monty platform engineering memory file.
 * Same contract as appendToMemory but targets .monty/memory/ namespace.
 *
 * @returns true if appended, false if skipped
 */
export async function appendToMontyMemory(
  file: MontyMemoryFile,
  entry: string,
): Promise<boolean> {
  try {
    const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
    const filePath = join(projectRoot, ".monty/memory", file);

    // File must exist
    try {
      await access(filePath, constants.F_OK);
    } catch {
      console.warn(`[monty-memory] File not found, skipping: ${filePath}`);
      return false;
    }

    // Enforce max line count
    const content = await readFile(filePath, "utf8");
    const lineCount = content.split("\n").length;
    if (lineCount >= MAX_LINES) {
      console.warn(
        `[monty-memory] ${file} at max lines (${lineCount}), skipping`,
      );
      return false;
    }

    // Validate entry content
    if (!isValidEntry(entry)) {
      console.warn(`[monty-memory] Rejecting malformed entry for ${file}: "${entry.slice(0, 50)}"`);
      return false;
    }

    // Append with ISO timestamp
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] — ${entry}\n`;
    await appendFile(filePath, line, "utf8");
    return true;
  } catch (error) {
    console.error(`[monty-memory] Failed to append to ${file}:`, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Memory Read System
// ---------------------------------------------------------------------------

/**
 * Read a memory file, returning its content or null if missing/empty.
 * Truncates files exceeding maxLines, keeping header + recent entries.
 */
async function readMemoryFile(
  filePath: string,
  maxLines: number = MAX_LINES,
): Promise<string | null> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return null;
  }

  const content = await readFile(filePath, "utf8");
  const trimmed = content.trim();
  if (!trimmed) return null;

  const lines = trimmed.split("\n");
  if (lines.length <= maxLines) return trimmed;

  // Truncate: keep first 3 lines (header/comments) + marker + last (maxLines - 4) lines
  console.warn(
    `[memory] Truncating ${filePath}: ${lines.length} lines -> ${maxLines}`,
  );
  const header = lines.slice(0, 3);
  const recent = lines.slice(-(maxLines - 4));
  return [
    ...header,
    "<!-- truncated: older entries removed -->",
    ...recent,
  ].join("\n");
}

/**
 * Check if content contains real timestamped entries (not just seed placeholders).
 * Seed-only files contain "(No X recorded yet)" and HTML comments but no ISO-dated entries.
 */
function hasRealEntries(content: string): boolean {
  return /\[\d{4}-\d{2}-\d{2}T/.test(content);
}

/**
 * Load system-wide MEMORY.md context (user's Claude project memory).
 * Returns null in production (Vercel) where the file doesn't exist.
 */
async function loadSystemContext(): Promise<string | null> {
  const memoryPath = join(
    homedir(),
    ".claude/projects/-Users-jjay-programs/memory/MEMORY.md",
  );
  return readMemoryFile(memoryPath);
}

/**
 * Load cross-client global insights file.
 * Returns null if file is missing or contains only seed content.
 */
async function loadCrossClientContext(memoryRoot: string): Promise<string | null> {
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
  const filePath = join(projectRoot, memoryRoot, "global-insights.md");
  const content = await readMemoryFile(filePath);
  if (!content || !hasRealEntries(content)) return null;
  return content;
}

/**
 * Load all workspace-specific memory files for a given slug.
 * Skips seed-only files. Returns null if all files are empty/seed-only.
 */
async function loadWorkspaceMemory(
  slug: string,
  memoryRoot: string,
): Promise<string | null> {
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
  const dir = join(projectRoot, memoryRoot, slug);
  const files = ["profile.md", "learnings.md", "campaigns.md", "feedback.md"];

  const sections: string[] = [];
  for (const file of files) {
    const content = await readMemoryFile(join(dir, file));
    if (content && hasRealEntries(content)) {
      sections.push(content);
    }
  }

  return sections.length > 0 ? sections.join("\n\n---\n\n") : null;
}

/**
 * Format the three memory layers into XML-tagged context for injection
 * into agent system prompts.
 */
function formatMemoryContext(
  systemCtx: string | null,
  crossClientCtx: string | null,
  workspaceCtx: string | null,
): string {
  if (!systemCtx && !crossClientCtx && !workspaceCtx) return "";

  const parts: string[] = [];
  parts.push(
    "<agent_memory>",
    "The following is your persistent memory from previous sessions. Use it to inform your decisions but prioritize workspace-specific memory over cross-client patterns, and cross-client patterns over system state.",
    "",
  );

  if (systemCtx) {
    parts.push("<system_memory>", systemCtx, "</system_memory>", "");
  }

  if (crossClientCtx) {
    parts.push(
      "<cross_client_memory>",
      crossClientCtx,
      "</cross_client_memory>",
      "",
    );
  }

  if (workspaceCtx) {
    parts.push(
      "<workspace_memory>",
      workspaceCtx,
      "</workspace_memory>",
      "",
    );
  }

  parts.push("</agent_memory>");
  return parts.join("\n");
}

/**
 * Load all memory context layers for an agent session.
 *
 * - System-wide MEMORY.md (user's Claude project memory)
 * - Cross-client global-insights.md
 * - Workspace-specific memory files (if workspaceSlug provided)
 *
 * Best-effort: on ANY error, logs a warning and returns empty string.
 * Memory loading failure never blocks agent execution.
 */
export async function loadMemoryContext(
  workspaceSlug?: string,
  options?: MemoryOptions,
): Promise<string> {
  try {
    const memoryRoot = options?.memoryRoot ?? DEFAULT_MEMORY_ROOT;
    const [systemCtx, crossClientCtx, workspaceCtx] = await Promise.all([
      loadSystemContext(),
      loadCrossClientContext(memoryRoot),
      workspaceSlug ? loadWorkspaceMemory(workspaceSlug, memoryRoot) : Promise.resolve(null),
    ]);

    return formatMemoryContext(systemCtx, crossClientCtx, workspaceCtx);
  } catch (error) {
    console.warn("[memory] Failed to load memory context:", error);
    return "";
  }
}
