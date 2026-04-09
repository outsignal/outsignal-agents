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
import { buildScoringPrompt, IcpScoreSchema } from "@/lib/icp/scorer";
import { getCrawlMarkdown } from "@/lib/icp/crawl-cache";
import { writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { randomUUID } from "crypto";

// --- JSON extraction from Claude output ---

function extractJSON(text: string): unknown {
  // Try raw parse first
  try {
    return JSON.parse(text);
  } catch {
    // noop
  }

  // Try extracting from ```json code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // noop
    }
  }

  // Try finding a JSON object in surrounding text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // noop
    }
  }

  return null;
}

// --- Score a single person via Claude Code CLI ---

async function scorePersonViaCli(
  personId: string,
  workspaceSlug: string,
  icpCriteriaPrompt: string,
): Promise<{ score: number; reasoning: string; confidence: "high" | "medium" | "low" }> {
  // 1. Fetch person data
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId },
  });

  // 2. Get company homepage markdown (from cache or Firecrawl)
  const websiteMarkdown = person.companyDomain
    ? await getCrawlMarkdown(person.companyDomain, false)
    : null;

  // 3. Fetch company record
  const company = person.companyDomain
    ? await prisma.company.findUnique({ where: { domain: person.companyDomain } })
    : null;

  // 4. Build scoring prompt (same function as the API scorer)
  const scoringPrompt = buildScoringPrompt({
    person: {
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      company: person.company,
      vertical: person.vertical,
      location: person.location,
      enrichmentData: person.enrichmentData,
    },
    company: company
      ? {
          headcount: company.headcount,
          industry: company.industry,
          description: company.description,
          yearFounded: company.yearFounded,
        }
      : null,
    websiteMarkdown,
  });

  // 5. Build full prompt with system instructions
  const fullPrompt = [
    "You are an ICP scoring assistant. Here are the workspace ICP criteria:\n",
    icpCriteriaPrompt,
    "\n---\n",
    scoringPrompt,
    "\n---\n",
    "Return ONLY a raw JSON object with these fields: score (number 0-100), reasoning (string, 1-3 sentences), confidence (\"high\"|\"medium\"|\"low\"). No markdown, no explanation, no code fences.",
  ].join("\n");

  // 6. Write prompt to temp file and call Claude Code CLI
  const promptPath = `/tmp/icp-score-${randomUUID()}.txt`;

  try {
    writeFileSync(promptPath, fullPrompt);

    const output = execSync(
      `npx -y @anthropic-ai/claude-code -p "$(cat '${promptPath}')" --output-format json --model claude-haiku-4-5`,
      {
        timeout: 60_000,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    // Parse Claude's output — it wraps in a JSON envelope with "result" field
    let rawText = output;
    try {
      const envelope = JSON.parse(output);
      if (envelope.result) {
        rawText = envelope.result;
      }
    } catch {
      // Not a JSON envelope, use raw output
    }

    const parsed = extractJSON(rawText);
    if (!parsed) {
      throw new Error("Could not extract JSON from Claude output");
    }

    const validated = IcpScoreSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`Invalid score format: ${validated.error.message}`);
    }

    return validated.data;
  } finally {
    try {
      unlinkSync(promptPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

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
    return {
      scored: 0,
      skipped,
      failed: 0,
      results: [],
    };
  }

  // 3. Score each person sequentially via Claude Code CLI
  //    (sequential because claude -p is a local process, not an API call)
  const results: Array<{ personId: string; score: number; reasoning: string }> = [];
  let failed = 0;

  for (let i = 0; i < unscored.length; i++) {
    const personId = unscored[i];
    console.error(
      `[list-score] Scoring ${i + 1}/${unscored.length}: ${personId}`,
    );

    try {
      const result = await scorePersonViaCli(
        personId,
        workspaceSlug,
        workspace.icpCriteriaPrompt,
      );

      // Persist score on PersonWorkspace
      await prisma.personWorkspace.update({
        where: {
          personId_workspace: {
            personId,
            workspace: workspaceSlug,
          },
        },
        data: {
          icpScore: result.score,
          icpReasoning: result.reasoning,
          icpConfidence: result.confidence,
          icpScoredAt: new Date(),
        },
      });

      results.push({
        personId,
        score: result.score,
        reasoning: result.reasoning,
      });
    } catch (err) {
      failed++;
      console.error(
        `[list-score] Failed to score person ${personId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    scored: results.length,
    skipped,
    failed,
    results,
  };
});
