/**
 * batch-icp-score-cc.ts
 *
 * Two modes:
 *   1. Fetch unscored leads:
 *      npx tsx scripts/batch-icp-score-cc.ts --workspace <slug> --listId <id> [--batchSize 25] [--dry-run]
 *
 *   2. Apply scores from file:
 *      npx tsx scripts/batch-icp-score-cc.ts --apply-scores --file <path>
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = raw[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Mode 2: Apply scores
// ---------------------------------------------------------------------------

async function applyScores(filePath: string) {
  const fs = await import("fs");
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as {
    scores: Array<{
      personWorkspaceId: string;
      score: number;
      reasoning: string;
      confidence: string;
    }>;
  };

  let applied = 0;
  let failed = 0;

  for (const entry of data.scores) {
    try {
      await prisma.personWorkspace.update({
        where: { id: entry.personWorkspaceId },
        data: {
          icpScore: entry.score,
          icpReasoning: entry.reasoning,
          icpConfidence: entry.confidence,
          icpScoredAt: new Date(),
        },
      });
      applied++;
    } catch (err: any) {
      process.stderr.write(
        `Failed to update ${entry.personWorkspaceId}: ${err.message}\n`
      );
      failed++;
    }
  }

  process.stderr.write(`Applied ${applied} scores, ${failed} failed\n`);
}

// ---------------------------------------------------------------------------
// Mode 1: Fetch unscored leads
// ---------------------------------------------------------------------------

async function fetchUnscored(
  workspaceSlug: string,
  listId: string,
  batchSize: number,
  dryRun: boolean
) {
  // 1. Load workspace
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true, slug: true, icpCriteriaPrompt: true },
  });

  if (!workspace) {
    process.stderr.write(`Error: Workspace '${workspaceSlug}' not found\n`);
    process.exit(1);
  }

  if (!workspace.icpCriteriaPrompt) {
    process.stderr.write(
      `Error: Workspace '${workspaceSlug}' has no icpCriteriaPrompt set\n`
    );
    process.exit(1);
  }

  // 2. Find person IDs in the target list
  const targetListPeople = await prisma.targetListPerson.findMany({
    where: { listId },
    select: { personId: true },
  });

  if (targetListPeople.length === 0) {
    process.stderr.write(
      `Error: No people found in target list '${listId}'\n`
    );
    process.exit(1);
  }

  const personIdsInList = targetListPeople.map((tlp) => tlp.personId);

  // 3. Query PersonWorkspace records that are unscored and in the target list
  const personWorkspaces = await prisma.personWorkspace.findMany({
    where: {
      workspace: workspaceSlug,
      icpScore: null,
      personId: { in: personIdsInList },
    },
    take: batchSize,
    include: {
      person: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          company: true,
          linkedinUrl: true,
          location: true,
          enrichmentData: true,
          companyDomain: true,
        },
      },
    },
  });

  if (dryRun) {
    process.stderr.write(
      `Dry run: ${personWorkspaces.length} unscored leads found (of ${personIdsInList.length} in list)\n`
    );
    return;
  }

  if (personWorkspaces.length === 0) {
    process.stderr.write("No unscored leads found matching criteria\n");
    return;
  }

  process.stderr.write(
    `Found ${personWorkspaces.length} unscored leads, fetching company data...\n`
  );

  // 4. Collect unique company domains for batch company lookup
  const companyDomains = [
    ...new Set(
      personWorkspaces
        .map((pw) => pw.person.companyDomain)
        .filter((d): d is string => !!d)
    ),
  ];

  const companies =
    companyDomains.length > 0
      ? await prisma.company.findMany({
          where: { domain: { in: companyDomains } },
          select: {
            domain: true,
            name: true,
            industry: true,
            headcount: true,
            description: true,
            yearFounded: true,
            crawlMarkdown: true,
          },
        })
      : [];

  const companyMap = new Map(companies.map((c) => [c.domain, c]));

  // 5. Build output
  const leads = personWorkspaces.map((pw) => {
    const person = pw.person;
    const enrichment = person.enrichmentData
      ? (() => {
          try {
            return typeof person.enrichmentData === "string"
              ? JSON.parse(person.enrichmentData)
              : person.enrichmentData;
          } catch {
            return null;
          }
        })()
      : null;

    const company = person.companyDomain
      ? companyMap.get(person.companyDomain) ?? null
      : null;

    return {
      personWorkspaceId: pw.id,
      personId: person.id,
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      company: person.company,
      location: person.location,
      seniority:
        enrichment?.seniority || enrichment?.level || null,
      companyData: company
        ? {
            domain: company.domain,
            name: company.name,
            industry: company.industry,
            headcount: company.headcount,
            description: company.description,
            yearFounded: company.yearFounded,
          }
        : null,
      websiteMarkdown: company?.crawlMarkdown
        ? company.crawlMarkdown.slice(0, 3000)
        : null,
    };
  });

  const output = {
    workspace: workspaceSlug,
    icpCriteriaPrompt: workspace.icpCriteriaPrompt,
    leads,
  };

  console.log(JSON.stringify(output, null, 2));

  process.stderr.write(`Output ${leads.length} leads to stdout\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  try {
    if (args["apply-scores"]) {
      const filePath = args["file"] as string | undefined;
      if (!filePath) {
        process.stderr.write(
          "Error: --file <path> is required with --apply-scores\n"
        );
        process.exit(1);
      }
      await applyScores(filePath);
    } else {
      const workspaceSlug = args["workspace"] as string | undefined;
      const listId = args["listId"] as string | undefined;
      const batchSize = args["batchSize"]
        ? parseInt(args["batchSize"] as string, 10)
        : 25;
      const dryRun = !!args["dry-run"];

      if (!workspaceSlug) {
        process.stderr.write("Error: --workspace <slug> is required\n");
        process.exit(1);
      }
      if (!listId) {
        process.stderr.write("Error: --listId <id> is required\n");
        process.exit(1);
      }

      await fetchUnscored(workspaceSlug, listId, batchSize, dryRun);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  prisma.$disconnect();
  process.exit(1);
});
