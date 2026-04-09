/**
 * list-score.ts
 *
 * CLI wrapper: score all unscored people in a target list against ICP criteria.
 * Usage: node dist/cli/list-score.js <listId> <workspaceSlug>
 *
 * Uses Claude Code CLI (`claude -p`) instead of the Anthropic API to avoid
 * API credit costs. The server-side scorer (scorer.ts) remains unchanged
 * for Trigger.dev tasks.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";
import { scorePersonIcpBatch } from "@/lib/icp/scorer";
import { prefetchDomains } from "@/lib/icp/crawl-cache";

const [, , listId, workspaceSlug] = process.argv;

runWithHarness("list-score <listId> <workspaceSlug>", async () => {
  if (!listId) throw new Error("Missing required argument: listId");
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");

  // 1. Validate workspace has ICP criteria
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { icpCriteriaPrompt: true },
  });

  if (!workspace) {
    throw new Error(`Workspace not found: '${workspaceSlug}'`);
  }

  if (!workspace.icpCriteriaPrompt?.trim()) {
    throw new Error(
      `No ICP criteria prompt configured for workspace '${workspaceSlug}'. ` +
        `Use the set_workspace_prompt tool to configure it first.`,
    );
  }

  // 2. Fetch all list members, separate scored vs unscored
  const members = await prisma.targetListPerson.findMany({
    where: { listId },
    include: {
      person: {
        select: {
          id: true,
          workspaces: {
            where: { workspace: workspaceSlug },
            select: { icpScoredAt: true },
          },
        },
      },
    },
  });

  const unscored: string[] = [];
  let skipped = 0;

  for (const member of members) {
    const pw = member.person.workspaces[0];
    if (pw?.icpScoredAt !== null && pw?.icpScoredAt !== undefined) {
      skipped++;
    } else {
      unscored.push(member.person.id);
    }
  }

  console.error(
    `[list-score] ${unscored.length} unscored, ${skipped} already scored`,
  );

  if (unscored.length === 0) {
    return { scored: 0, skipped, failed: 0 };
  }

  // 3. Prefetch website data for unique domains
  const people = await prisma.person.findMany({
    where: { id: { in: unscored } },
    select: { companyDomain: true },
  });
  const domains = people
    .map((p) => p.companyDomain)
    .filter(Boolean) as string[];
  const uniqueDomains = [...new Set(domains)];

  if (uniqueDomains.length > 0) {
    console.error(
      `[list-score] Prefetching website data for ${uniqueDomains.length} unique domains...`,
    );
    const prefetchResult = await prefetchDomains(uniqueDomains);
    console.error(
      `[list-score] Prefetch: ${prefetchResult.cached} cached, ${prefetchResult.crawled} crawled, ${prefetchResult.failed} failed`,
    );
  }

  // 4. Batch score via Claude Code CLI (15 people per call)
  console.error(
    `[list-score] Batch scoring ${unscored.length} people (batch size: 15)...`,
  );
  const result = await scorePersonIcpBatch(unscored, workspaceSlug, {
    batchSize: 15,
  });

  console.error(
    `[list-score] Done: ${result.scored} scored, ${result.failed} failed, ${result.skipped} skipped`,
  );

  return {
    scored: result.scored,
    skipped: skipped + result.skipped,
    failed: result.failed,
  };
});
