/**
 * Monty Memory CLI -- Seed topic-based memory files for the Monty agent team.
 *
 * Usage:
 *   npx tsx scripts/monty-memory.ts          -- seed all memory files
 *
 * Memory files created:
 *   .monty/memory/backlog.json       -- structured task backlog
 *   .monty/memory/decisions.md       -- governance decisions log
 *   .monty/memory/incidents.md       -- incidents and QA findings
 *   .monty/memory/architecture.md    -- architecture patterns
 *   .monty/memory/security.md        -- security findings
 */

import { mkdir, writeFile, access } from "fs/promises";
import { constants } from "fs";
import { join } from "path";

const MEMORY_ROOT = ".monty/memory";

// ---- Helpers ----------------------------------------------------------------

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isoDate(): string {
  return new Date().toISOString().split("T")[0];
}

// ---- Seed file definitions --------------------------------------------------

interface SeedFile {
  name: string;
  content: string;
}

function buildSeedFiles(): SeedFile[] {
  const date = isoDate();

  return [
    {
      name: "backlog.json",
      content: JSON.stringify({ version: 1, items: [] }, null, 2) + "\n",
    },
    {
      name: "decisions.md",
      content: `<!-- decisions.md | monty | seeded: ${date} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty -- Decisions Log

<!-- Append entries as: [ISO date] -- [decision summary] -->

(No decisions recorded yet)
`,
    },
    {
      name: "incidents.md",
      content: `<!-- incidents.md | monty | seeded: ${date} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty -- Incidents & QA Findings

<!-- Append entries as: [ISO date] -- [incident or finding] -->

(No incidents recorded yet)
`,
    },
    {
      name: "architecture.md",
      content: `<!-- architecture.md | monty | seeded: ${date} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty -- Architecture Patterns

<!-- Append entries as: [ISO date] -- [pattern or observation] -->

(No architecture patterns recorded yet)
`,
    },
    {
      name: "security.md",
      content: `<!-- security.md | monty | seeded: ${date} -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty -- Security Findings

<!-- Append entries as: [ISO date] -- [finding or recommendation] -->

(No security findings recorded yet)
`,
    },
  ];
}

// ---- Seed -------------------------------------------------------------------

async function seed(): Promise<void> {
  await mkdir(MEMORY_ROOT, { recursive: true });

  const files = buildSeedFiles();

  for (const file of files) {
    const filePath = join(MEMORY_ROOT, file.name);
    if (await fileExists(filePath)) {
      console.log(`  ${file.name} (skipped -- already exists)`);
    } else {
      await writeFile(filePath, file.content, "utf8");
      console.log(`  ${file.name} (created)`);
    }
  }
}

// ---- Main -------------------------------------------------------------------

async function main() {
  console.log(`Seeding Monty memory at ${MEMORY_ROOT}/...\n`);
  await seed();
  console.log(`\nDone. ${MEMORY_ROOT}/ seeded.`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
