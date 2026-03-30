import { appendFile, readFile, access } from "fs/promises";
import { constants } from "fs";
import { join } from "path";

const MEMORY_ROOT = ".nova/memory";
const MAX_LINES = 200;

type MemoryFile = "campaigns.md" | "feedback.md" | "learnings.md";

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
    const filePath = join(projectRoot, MEMORY_ROOT, slug, file);

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
