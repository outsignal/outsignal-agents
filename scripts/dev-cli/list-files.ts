/**
 * list-files.ts
 *
 * Returns directory listing with glob support.
 * Usage: list-files [--pattern <glob>] [--path <dir>]
 * Output: { pattern, directory, files: string[], count }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const pattern = getArg("--pattern") || "*";
const dir = getArg("--path") || ".";

runWithHarness("list-files [--pattern <glob>] [--path <dir>]", async () => {
  const searchDir = dir.startsWith("/") ? dir : `${cwd}/${dir}`;

  const excludes = [
    "-not", "-path", "*/node_modules/*",
    "-not", "-path", "*/dist/*",
    "-not", "-path", "*/.next/*",
    "-not", "-path", "*/.git/*",
    "-not", "-path", "*/.trigger/*",
  ];

  const raw = execSync(
    `find ${JSON.stringify(searchDir)} -name ${JSON.stringify(pattern)} ${excludes.join(" ")} -type f 2>/dev/null | head -500`,
    { cwd, maxBuffer, encoding: "utf-8" }
  ).trim();

  const files = raw ? raw.split("\n") : [];

  return {
    pattern,
    directory: dir,
    files,
    count: files.length,
  };
});
