/**
 * Sync Insights to Memory Files
 *
 * Reads recent Insight rows from DB (stored by Trigger.dev weekly cron)
 * and writes them to local memory files via appendToMemory/appendToGlobalMemory.
 *
 * Enables hybrid workflow: Trigger.dev stores analysis in DB remotely,
 * this script syncs results to local .nova/memory/ files.
 *
 * Usage:
 *   npx tsx scripts/sync-insights-to-memory.ts
 */

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "@prisma/client";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import {
  appendToMemory,
  appendToGlobalMemory,
} from "../src/lib/agents/memory";

const prisma = new PrismaClient();
const SYNC_MARKER = join(
  process.env.PROJECT_ROOT ?? process.cwd(),
  ".nova/memory/.last-sync",
);

async function getLastSyncDate(): Promise<Date> {
  try {
    const content = await readFile(SYNC_MARKER, "utf8");
    return new Date(content.trim());
  } catch {
    // No marker -- sync last 30 days
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }
}

async function main() {
  const lastSync = await getLastSyncDate();
  console.log(`Last sync: ${lastSync.toISOString()}`);

  // Query weekly_analysis insights since last sync
  const insights = await prisma.insight.findMany({
    where: {
      dedupKey: { startsWith: "weekly_analysis:" },
      createdAt: { gte: lastSync },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${insights.length} insight rows since last sync\n`);

  let globalCount = 0;
  let workspaceCount = 0;

  for (const row of insights) {
    try {
      const parsed = JSON.parse(row.evidence) as {
        globalInsights?: string[];
        workspaceInsights?: string[];
      };

      // Write workspace insights
      if (parsed.workspaceInsights) {
        for (const insight of parsed.workspaceInsights) {
          const written = await appendToMemory(
            row.workspaceSlug,
            "campaigns.md",
            insight,
          );
          if (written) workspaceCount++;
        }
      }

      // Write global insights
      if (parsed.globalInsights) {
        for (const insight of parsed.globalInsights) {
          const written = await appendToGlobalMemory(insight);
          if (written) globalCount++;
        }
      }
    } catch (err) {
      console.warn(`Skipping unparseable insight ${row.id}:`, err);
    }
  }

  // Update sync marker
  await writeFile(SYNC_MARKER, new Date().toISOString(), "utf8");

  console.log(
    `Synced ${globalCount} global + ${workspaceCount} workspace insights from DB to memory files`,
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Sync failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
