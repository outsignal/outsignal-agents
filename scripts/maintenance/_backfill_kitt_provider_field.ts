/**
 * Backfill the canonical emailVerificationProvider field for legacy Kitt rows.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_backfill_kitt_provider_field.ts
 *   npx tsx scripts/maintenance/_backfill_kitt_provider_field.ts --apply
 *   npx tsx scripts/maintenance/_backfill_kitt_provider_field.ts --workspace lime-recruitment
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOG_PREFIX = "[backfill-kitt-provider-field]";
const APPLY = process.argv.includes("--apply");

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseEnrichmentData(enrichmentData: string | null): Record<string, unknown> | null {
  if (!enrichmentData) return null;
  try {
    const parsed = JSON.parse(enrichmentData);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasProvider(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

async function main() {
  const workspaceFilter = readArg("--workspace");

  console.log(
    `${LOG_PREFIX} mode=${APPLY ? "apply" : "dry-run"}${workspaceFilter ? ` workspace=${workspaceFilter}` : ""}`,
  );

  const people = await prisma.person.findMany({
    where: {
      enrichmentData: { contains: "\"emailVerifiedBy\":\"kitt\"" },
      ...(workspaceFilter
        ? {
            workspaces: {
              some: { workspace: workspaceFilter },
            },
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      enrichmentData: true,
      workspaces: {
        select: { workspace: true },
      },
    },
  });

  const candidates = people
    .map((person) => {
      const parsed = parseEnrichmentData(person.enrichmentData);
      if (!parsed) return null;
      if (parsed.emailVerifiedBy !== "kitt") return null;
      if (hasProvider(parsed.emailVerificationProvider)) return null;
      return { person, parsed };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        person: (typeof people)[number];
        parsed: Record<string, unknown>;
      } => candidate !== null,
    );

  const perWorkspace = new Map<string, number>();
  for (const candidate of candidates) {
    const workspaces = workspaceFilter
      ? candidate.person.workspaces.filter(
          (workspace) => workspace.workspace === workspaceFilter,
        )
      : candidate.person.workspaces;
    for (const workspace of workspaces) {
      perWorkspace.set(
        workspace.workspace,
        (perWorkspace.get(workspace.workspace) ?? 0) + 1,
      );
    }
  }

  console.log(`${LOG_PREFIX} candidates=${candidates.length}`);
  if (perWorkspace.size > 0) {
    console.log(`${LOG_PREFIX} per-workspace:`);
    for (const [workspace, count] of [...perWorkspace.entries()].sort()) {
      console.log(`  - ${workspace}: ${count}`);
    }
  }

  if (candidates.length > 0) {
    console.log(`${LOG_PREFIX} sample emails:`);
    for (const candidate of candidates.slice(0, 10)) {
      console.log(`  - ${candidate.person.email ?? "(no email)"} (${candidate.person.id})`);
    }
  }

  if (!APPLY) {
    console.log(
      `${LOG_PREFIX} dry-run complete. Re-run with --apply to populate emailVerificationProvider on ${candidates.length} row(s).`,
    );
    return;
  }

  for (const candidate of candidates) {
    await prisma.person.update({
      where: { id: candidate.person.id },
      data: {
        enrichmentData: JSON.stringify({
          ...candidate.parsed,
          emailVerificationProvider: "kitt",
        }),
      },
    });
  }

  console.log(
    `${LOG_PREFIX} applied provider backfill to ${candidates.length} row(s).`,
  );
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} fatal:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
