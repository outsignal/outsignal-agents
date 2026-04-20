/**
 * Independent verification of BL-054 backfill APPLY (throwaway).
 *
 * 1. Confirm the 14 target IDs are all status='cancelled' with the
 *    correct cancellationReason.
 * 2. Count total rows cancelled with that reason — must equal 14.
 * 3. Confirm no rows outside our 14-ID set got touched.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_IDS = [
  "cmnzpyn8k0005jr04ksf0jwxy",
  "cmnzpyn930009jr04e36pbpho",
  "cmnzpyna0000hjr04hfghpj2j",
  "cmnzpynbe0005i80437p1bxgf",
  "cmnzpyncl000hi8049bb9qca6",
  "cmnzpyndb000pi8044c92xvh5",
  "cmnzpyne2000xi804zyxnuiu5",
  "cmnzpynad000ljr04e44w1bof",
  "cmnzpynbq0009i804nagymbfj",
  "cmnzpyn9g000djr04a74ku736",
  "cmnzpyndo000ti80430bjoqfm",
  "cmnzpyncy000li804o6hysnfj",
  "cmnzpync6000di8045g8pzyoa",
  "cmnzpynap000pjr04azuk6f25",
];

const REASON = "already-invited-cooldown-backfill";

async function main() {
  // 1. Re-fetch each target ID.
  const rows = await prisma.linkedInAction.findMany({
    where: { id: { in: TARGET_IDS } },
    select: { id: true, status: true, result: true, workspaceSlug: true },
  });

  console.log(`Target IDs found: ${rows.length}/${TARGET_IDS.length}`);

  let ok = 0;
  let bad = 0;
  for (const r of rows) {
    if (r.status !== "cancelled") {
      console.log(`BAD: ${r.id} status=${r.status}`);
      bad++;
      continue;
    }
    let parsedReason: string | undefined;
    try {
      const parsed = r.result ? JSON.parse(r.result) : null;
      parsedReason = parsed?.cancellationReason;
    } catch {
      /* noop */
    }
    if (parsedReason !== REASON) {
      console.log(`BAD reason: ${r.id} reason=${parsedReason ?? "MISSING"}`);
      bad++;
      continue;
    }
    ok++;
  }
  console.log(`Verification: ok=${ok} bad=${bad}`);

  // 2. Count ALL rows with this cancellation reason in DB.
  const withReason = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM "LinkedInAction"
    WHERE status = 'cancelled'
      AND result::jsonb ->> 'cancellationReason' = ${REASON}
  `;
  const totalWithReason = Number(withReason[0].count);
  console.log(`Total rows cancelled with reason=${REASON}: ${totalWithReason}`);

  if (totalWithReason !== 14) {
    console.error(
      `MISMATCH: expected 14 rows with this reason, got ${totalWithReason}`,
    );
  }

  // 3. Confirm the 14 rows match our target set exactly (no strays).
  const reasonRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "LinkedInAction"
    WHERE status = 'cancelled'
      AND result::jsonb ->> 'cancellationReason' = ${REASON}
  `;
  const reasonIds = new Set(reasonRows.map((r) => r.id));
  const targetIds = new Set(TARGET_IDS);
  const extra = [...reasonIds].filter((id) => !targetIds.has(id));
  const missing = [...targetIds].filter((id) => !reasonIds.has(id));
  console.log(`extra=${extra.length} missing=${missing.length}`);
  if (extra.length) console.log("extra ids:", extra);
  if (missing.length) console.log("missing ids:", missing);

  // 4. For paranoia: make sure no other backfill reasons were created
  //    this session. Look at distinct reasons for cancelled rows updated
  //    in the last hour.
  const recentReasons = await prisma.$queryRaw<
    Array<{ reason: string | null; count: bigint }>
  >`
    SELECT result::jsonb ->> 'cancellationReason' AS reason, COUNT(*)::bigint AS count
    FROM "LinkedInAction"
    WHERE status = 'cancelled'
      AND "updatedAt" > NOW() - INTERVAL '1 hour'
    GROUP BY result::jsonb ->> 'cancellationReason'
    ORDER BY count DESC
  `;
  console.log("Cancelled rows updated in last 1h by reason:");
  console.table(
    recentReasons.map((r) => ({
      reason: r.reason ?? "(null)",
      count: Number(r.count),
    })),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
