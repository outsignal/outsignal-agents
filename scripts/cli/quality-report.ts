/**
 * quality-report.ts
 *
 * CLI wrapper: run post-search quality assessment on staged discovery results.
 * Usage: node dist/cli/quality-report.js --runIds <id1,id2> --slug <workspace>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";
import { assessSearchQuality } from "@/lib/discovery/quality-gate";
import type { DiscoveredPersonResult } from "@/lib/discovery/types";

const args = process.argv.slice(2);
const runIdsIdx = args.indexOf("--runIds");
const slugIdx = args.indexOf("--slug");
const runIdsStr = runIdsIdx !== -1 ? args[runIdsIdx + 1] : undefined;
const slug = slugIdx !== -1 ? args[slugIdx + 1] : undefined;

runWithHarness("quality-report --runIds <id1,id2> --slug <workspace>", async () => {
  if (!runIdsStr) throw new Error("Missing required argument: --runIds <id1,id2,...>");

  const runIds = runIdsStr.split(",").map((s) => s.trim());

  // Fetch staged discovered people for these run IDs
  const discovered = await prisma.discoveredPerson.findMany({
    where: { discoveryRunId: { in: runIds } },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      company: true,
      companyDomain: true,
      linkedinUrl: true,
      phone: true,
      location: true,
    },
  });

  // Optionally load workspace ICP for fit scoring
  let workspaceIcp: { titles?: string[]; locations?: string[]; industries?: string[] } | undefined;
  if (slug) {
    const workspace = await prisma.workspace.findUnique({
      where: { slug },
      select: {
        icpDecisionMakerTitles: true,
        icpCountries: true,
        icpIndustries: true,
      },
    });
    if (workspace) {
      workspaceIcp = {
        titles: workspace.icpDecisionMakerTitles
          ? workspace.icpDecisionMakerTitles.split(",").map((s) => s.trim())
          : undefined,
        locations: workspace.icpCountries
          ? workspace.icpCountries.split(",").map((s) => s.trim())
          : undefined,
        industries: workspace.icpIndustries
          ? workspace.icpIndustries.split(",").map((s) => s.trim())
          : undefined,
      };
    }
  }

  const people: DiscoveredPersonResult[] = discovered.map((d) => ({
    email: d.email ?? undefined,
    firstName: d.firstName ?? undefined,
    lastName: d.lastName ?? undefined,
    jobTitle: d.jobTitle ?? undefined,
    company: d.company ?? undefined,
    companyDomain: d.companyDomain ?? undefined,
    linkedinUrl: d.linkedinUrl ?? undefined,
    phone: d.phone ?? undefined,
    location: d.location ?? undefined,
  }));

  return assessSearchQuality(people, { workspaceIcp });
});
