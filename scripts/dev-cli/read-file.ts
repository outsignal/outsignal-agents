/**
 * read-file.ts
 *
 * Returns file content with metadata as structured JSON.
 * Usage: read-file --path <filepath> [--start-line N] [--end-line N]
 * Output: { path, content, lineCount, sizeBytes }
 */

import { runWithHarness } from "./_cli-harness";
import fs from "fs";
import path from "path";

const cwd = process.env.PROJECT_ROOT || process.cwd();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const filePath = getArg("--path");
const startLine = getArg("--start-line");
const endLine = getArg("--end-line");

runWithHarness("read-file --path <filepath> [--start-line N] [--end-line N]", async () => {
  if (!filePath) {
    throw new Error("Missing required --path argument");
  }

  const resolved = path.resolve(cwd, filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  const raw = fs.readFileSync(resolved, "utf-8");
  const lines = raw.split("\n");

  let content = raw;
  let lineCount = lines.length;

  if (startLine || endLine) {
    const start = startLine ? Math.max(1, parseInt(startLine, 10)) : 1;
    const end = endLine ? Math.min(lines.length, parseInt(endLine, 10)) : lines.length;
    const slice = lines.slice(start - 1, end);
    content = slice.join("\n");
    lineCount = slice.length;
  }

  return {
    path: filePath,
    content,
    lineCount,
    sizeBytes: stat.size,
  };
});
