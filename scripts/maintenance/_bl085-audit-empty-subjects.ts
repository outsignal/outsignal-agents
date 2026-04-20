/**
 * BL-085 — audit all 11 email campaigns in Lime + 1210 workspaces for
 * empty-subject sequence steps. Read-only, produces a matrix.
 *
 * Untracked maintenance script (underscore prefix).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface StoredStep {
  position?: number;
  subjectLine?: string | null;
  subjectVariantB?: string | null;
}

function isEmpty(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.trim() === "";
}

async function main() {
  const campaigns = await prisma.campaign.findMany({
    where: {
      workspaceSlug: { in: ["1210-solutions", "lime-recruitment"] },
      channels: { contains: "email" },
      emailSequence: { not: null },
    },
    select: {
      id: true,
      workspaceSlug: true,
      name: true,
      status: true,
      emailSequence: true,
    },
    orderBy: [{ workspaceSlug: "asc" }, { name: "asc" }],
  });

  console.log(
    `\n| campaignId | workspaceSlug | name | status | totalSteps | emptySubjectSteps | empty-subject positions | emptyVariantBSteps |`,
  );
  console.log(
    `|---|---|---|---|---|---|---|---|`,
  );
  for (const c of campaigns) {
    let parsed: StoredStep[] = [];
    const raw = c.emailSequence;
    if (raw == null) continue;
    try {
      if (typeof raw === "string") {
        parsed = JSON.parse(raw);
      } else if (Array.isArray(raw)) {
        parsed = raw as StoredStep[];
      } else {
        parsed = raw as unknown as StoredStep[];
      }
    } catch (e) {
      console.log(
        `| ${c.id} | ${c.workspaceSlug} | ${c.name} | ${c.status} | PARSE_ERROR | - | - | - |`,
      );
      continue;
    }
    const totalSteps = parsed.length;
    const emptySubjectIdxs: number[] = [];
    const emptyVariantBIdxs: number[] = [];
    parsed.forEach((s, i) => {
      const pos = s.position ?? i + 1;
      if (isEmpty(s.subjectLine)) emptySubjectIdxs.push(pos);
      if (s.subjectVariantB !== undefined && isEmpty(s.subjectVariantB))
        emptyVariantBIdxs.push(pos);
    });
    console.log(
      `| ${c.id} | ${c.workspaceSlug} | ${c.name} | ${c.status} | ${totalSteps} | ${emptySubjectIdxs.length} | ${emptySubjectIdxs.join(",") || "-"} | ${emptyVariantBIdxs.length} |`,
    );
  }

  console.log(`\nTotal campaigns scanned: ${campaigns.length}`);
  await prisma.$disconnect();
}

// Prisma.DbNull import workaround
import { Prisma } from "@prisma/client";

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
