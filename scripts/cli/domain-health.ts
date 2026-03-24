/**
 * domain-health.ts
 *
 * CLI wrapper: get domain health rollup for a workspace's sending domains.
 * Usage: node dist/cli/domain-health.js <workspaceSlug>
 *
 * Queries latest BounceSnapshot data per sending domain for the workspace.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";
import { computeDomainRollup } from "@/lib/domain-health/snapshots";

const [, , workspaceSlug] = process.argv;

runWithHarness("domain-health <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");

  // Find all senders for this workspace with email addresses
  const senders = await prisma.sender.findMany({
    where: { workspaceSlug, emailAddress: { not: null } },
    select: { emailAddress: true },
  });

  if (senders.length === 0) {
    return { workspaceSlug, domains: [], message: "No email senders found for workspace" };
  }

  // Extract unique sending domains
  const domains = [...new Set(
    senders
      .map(s => s.emailAddress?.split("@")[1])
      .filter(Boolean) as string[]
  )];

  // Compute rollup for each domain using today's date
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const results = await Promise.all(
    domains.map(async (domain) => {
      const rollup = await computeDomainRollup(domain, today);
      return { domain, ...rollup };
    })
  );

  return { workspaceSlug, date: today.toISOString().slice(0, 10), domains: results };
});
