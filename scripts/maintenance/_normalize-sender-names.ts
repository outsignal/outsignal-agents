/**
 * Normalize Sender.name by trimming leading/trailing whitespace.
 *
 * Safety:
 * - Dry-run by default. Pass --apply to write.
 * - Snapshot is written before any mutation.
 * - Each mutation writes an AuditLog row with before/after values.
 * - Idempotent: once all rows are trimmed, re-running finds nothing to do.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_normalize-sender-names.ts
 *   npx tsx scripts/maintenance/_normalize-sender-names.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { writeFileSync } from "fs";
import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");
const LOG_PREFIX = "[normalize-sender-names]";
const SAMPLE_LIMIT = 25;

type SenderRow = {
  id: string;
  workspaceSlug: string;
  name: string;
  status: string;
  channel: string;
  emailAddress: string | null;
  updatedAt: Date;
};

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatWhitespaceDelta(before: string, after: string): string {
  return `${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
}

async function main() {
  console.log(`${LOG_PREFIX} mode=${APPLY ? "apply" : "dry-run"}`);

  const rows = await prisma.sender.findMany({
    select: {
      id: true,
      workspaceSlug: true,
      name: true,
      status: true,
      channel: true,
      emailAddress: true,
      updatedAt: true,
    },
    orderBy: [{ workspaceSlug: "asc" }, { name: "asc" }, { updatedAt: "desc" }],
  });

  const affected = rows
    .map((row) => ({
      ...row,
      trimmedName: row.name.trim(),
    }))
    .filter((row) => row.name !== row.trimmedName);

  console.log(`${LOG_PREFIX} scanned=${rows.length} affected=${affected.length}`);

  if (affected.length === 0) {
    console.log(`${LOG_PREFIX} nothing to do.`);
    return;
  }

  const invalid = affected.filter((row) => row.trimmedName.length === 0);
  if (invalid.length > 0) {
    console.error(
      `${LOG_PREFIX} refusing to normalize ${invalid.length} row(s) because trimming would produce an empty name.`,
    );
    console.table(
      invalid.map((row) => ({
        id: row.id,
        workspace: row.workspaceSlug,
        channel: row.channel,
        status: row.status,
        email: row.emailAddress ?? "",
        before: JSON.stringify(row.name),
      })),
    );
    process.exitCode = 1;
    return;
  }

  const byWorkspace = new Map<string, number>();
  for (const row of affected) {
    byWorkspace.set(
      row.workspaceSlug,
      (byWorkspace.get(row.workspaceSlug) ?? 0) + 1,
    );
  }

  console.log(
    `${LOG_PREFIX} per-workspace=${JSON.stringify(Object.fromEntries(byWorkspace), null, 2)}`,
  );

  console.table(
    affected.slice(0, SAMPLE_LIMIT).map((row) => ({
      id: row.id,
      workspace: row.workspaceSlug,
      channel: row.channel,
      status: row.status,
      email: row.emailAddress ?? "",
      before: JSON.stringify(row.name),
      after: JSON.stringify(row.trimmedName),
      updatedAt: row.updatedAt.toISOString(),
    })),
  );

  if (affected.length > SAMPLE_LIMIT) {
    console.log(
      `${LOG_PREFIX} showing ${SAMPLE_LIMIT}/${affected.length} affected rows`,
    );
  }

  if (!APPLY) {
    console.log(
      `${LOG_PREFIX} dry-run only. Re-run with --apply to trim ${affected.length} sender name(s).`,
    );
    return;
  }

  const snapshotPath = `/tmp/sender-name-normalize-snapshot-${timestampForFilename()}.json`;
  writeFileSync(
    snapshotPath,
    JSON.stringify(
      affected.map((row) => ({
        id: row.id,
        workspaceSlug: row.workspaceSlug,
        emailAddress: row.emailAddress,
        status: row.status,
        channel: row.channel,
        before: row.name,
        after: row.trimmedName,
        updatedAt: row.updatedAt.toISOString(),
      })),
      null,
      2,
    ),
  );
  console.log(`${LOG_PREFIX} snapshot=${snapshotPath}`);

  let updated = 0;
  for (const row of affected) {
    await prisma.$transaction(async (tx) => {
      await tx.sender.update({
        where: { id: row.id },
        data: { name: row.trimmedName },
      });

      await tx.auditLog.create({
        data: {
          action: "sender.name_normalize",
          entityType: "Sender",
          entityId: row.id,
          adminEmail: "system",
          metadata: {
            workspaceSlug: row.workspaceSlug,
            channel: row.channel,
            emailAddress: row.emailAddress,
            before: row.name,
            after: row.trimmedName,
          },
        },
      });
    });

    updated++;
    console.log(
      `${LOG_PREFIX} normalized ${row.id} (${row.workspaceSlug}) ${formatWhitespaceDelta(
        row.name,
        row.trimmedName,
      )}`,
    );
  }

  const readback = await prisma.sender.findMany({
    where: { id: { in: affected.map((row) => row.id) } },
    select: { id: true, name: true },
  });
  const mismatches = readback.filter((row) => row.name !== row.name.trim());
  if (mismatches.length > 0) {
    throw new Error(
      `readback verification failed for ${mismatches.length} row(s): ${mismatches
        .map((row) => row.id)
        .join(", ")}`,
    );
  }

  console.log(`${LOG_PREFIX} applied=${updated} verified=${readback.length}`);
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAILED`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

