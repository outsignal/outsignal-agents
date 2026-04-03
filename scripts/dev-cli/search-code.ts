/**
 * search-code.ts
 *
 * Code search with result limiting.
 * Usage: search-code --pattern <regex> [--glob <fileglob>] [--limit N]
 * Output: { pattern, glob, matches: [{file, line, content}], matchCount, truncated }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const pattern = getArg("--pattern");
const glob = getArg("--glob");
const limitStr = getArg("--limit");
const limit = limitStr ? parseInt(limitStr, 10) : 50;

runWithHarness(
  "search-code --pattern <regex> [--glob <fileglob>] [--limit N]",
  async () => {
    if (!pattern) {
      throw new Error("Missing required --pattern argument");
    }

    const excludes = [
      "--exclude-dir=node_modules",
      "--exclude-dir=dist",
      "--exclude-dir=.next",
      "--exclude-dir=.git",
      "--exclude-dir=.trigger",
    ];

    const includeFlag = glob ? `--include=${JSON.stringify(glob)}` : "";

    const cmd = `grep -rn --max-count=5 ${excludes.join(" ")} ${includeFlag} -e ${JSON.stringify(pattern)} . 2>/dev/null || true`;

    const raw = execSync(cmd, { cwd, maxBuffer, encoding: "utf-8" }).trim();

    const allMatches = raw
      ? raw.split("\n").map((line) => {
          const firstColon = line.indexOf(":");
          const secondColon = line.indexOf(":", firstColon + 1);
          return {
            file: line.substring(0, firstColon),
            line: parseInt(line.substring(firstColon + 1, secondColon), 10),
            content: line.substring(secondColon + 1),
          };
        })
      : [];

    const truncated = allMatches.length > limit;
    const matches = allMatches.slice(0, limit);

    return {
      pattern,
      glob: glob || null,
      matches,
      matchCount: matches.length,
      truncated,
    };
  }
);
