/**
 * BL-079/Lime bundle — Task B pre-flight probe (READ-ONLY).
 *
 * Purpose: confirm the AVAILABLE inbox pool for Lime E1-E5 allocation before
 * editing the allocation map in src/lib/channels/email-adapter.ts.
 *
 * Exclusion set (PM brief): EB campaign IDs 31, 42, 43, 44, 45 — senders
 * attached to these MUST NOT be reused on the new E1-E5 cohort.
 *
 * Flow:
 *   1. Load lime-recruitment Workspace + apiToken via Prisma.
 *   2. For each excluded EB campaign, GET /campaigns/{id}/sender-emails to
 *      enumerate attached sender IDs. Union → UNAVAILABLE.
 *   3. GET /sender-emails (paginated) to enumerate the full Lime sender pool.
 *   4. Intersect (pool ∩ ¬UNAVAILABLE) → AVAILABLE.
 *   5. Print capacity check. Required: AVAILABLE ≥ 50 (5 campaigns × ~10 each).
 *   6. Print a proposed round-robin allocation bucket layout for E1-E5.
 *
 * Dumps JSON to /tmp/_bl-lime-allocation-probe.json for the allocation map
 * code-edit step to consume directly.
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { writeFileSync } from "node:fs";

const WORKSPACE_SLUG = "lime-recruitment";
const EXCLUDED_EB_CAMPAIGN_IDS = [31, 42, 43, 44, 45];

async function main() {
  const ws = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { slug: true, name: true, apiToken: true },
  });
  if (!ws) {
    throw new Error(`Workspace '${WORKSPACE_SLUG}' not found`);
  }
  if (!ws.apiToken) {
    throw new Error(`Workspace '${WORKSPACE_SLUG}' has no apiToken`);
  }

  const client = new EmailBisonClient(ws.apiToken);

  console.log(`\n=== Lime allocation probe — ${new Date().toISOString()} ===`);

  // --- 1. Excluded-campaign sender enumeration --------------------------
  console.log(`\n[1/4] Enumerate senders attached to excluded EB campaigns:`);
  const unavailableBySource = new Map<number, number[]>();
  const unavailable = new Set<number>();
  for (const ebId of EXCLUDED_EB_CAMPAIGN_IDS) {
    try {
      const senders = await client.getCampaignSenderEmails(ebId);
      const ids = senders.map((s) => s.id);
      unavailableBySource.set(ebId, ids);
      for (const id of ids) unavailable.add(id);
      console.log(`  EB ${ebId}: ${ids.length} senders [${ids.slice(0, 20).join(",")}${ids.length > 20 ? `,…+${ids.length - 20}` : ""}]`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  EB ${ebId}: ERROR ${msg}`);
      // Per brief: don't block on edge cases.
      unavailableBySource.set(ebId, []);
    }
  }
  console.log(`  UNAVAILABLE union size: ${unavailable.size}`);

  // --- 2. Lime sender pool ---------------------------------------------
  console.log(`\n[2/4] Enumerate all Lime senders via /sender-emails:`);
  const allSenders = await client.getSenderEmails();
  console.log(`  total: ${allSenders.length}`);
  // Sort by id ascending for deterministic allocation later.
  const sortedIds = allSenders.map((s) => s.id).sort((a, b) => a - b);

  // --- 3. AVAILABLE = pool ∩ ¬UNAVAILABLE ------------------------------
  console.log(`\n[3/4] Compute AVAILABLE set:`);
  const availableIds = sortedIds.filter((id) => !unavailable.has(id));
  console.log(`  AVAILABLE count: ${availableIds.length}`);
  console.log(`  first 20: [${availableIds.slice(0, 20).join(",")}]`);
  console.log(`  last 10:  [${availableIds.slice(-10).join(",")}]`);

  // Capacity check — brief requires >= 50.
  const REQUIRED_CAPACITY = 50;
  if (availableIds.length < REQUIRED_CAPACITY) {
    console.log(
      `\n[BLOCKER] AVAILABLE (${availableIds.length}) < required capacity (${REQUIRED_CAPACITY}). ESCALATE to PM.`,
    );
    // Intentionally still write the dump so operators can inspect.
  } else {
    console.log(
      `\n[OK] Capacity check passed: ${availableIds.length} ≥ ${REQUIRED_CAPACITY}.`,
    );
  }

  // --- 4. Proposed round-robin allocation for E1-E5 --------------------
  console.log(`\n[4/4] Proposed round-robin allocation for E1..E5 (bucket = idx % 5):`);
  const buckets: number[][] = [[], [], [], [], []];
  availableIds.forEach((id, idx) => {
    buckets[idx % 5].push(id);
  });
  for (let i = 0; i < 5; i++) {
    console.log(`  bucket ${i} (E${i + 1}): ${buckets[i].length} senders — [${buckets[i].join(",")}]`);
  }

  // Cross-check sender details for the snapshot so the allocation map
  // comment in email-adapter.ts can cite provider/count.
  const byId = new Map(allSenders.map((s) => [s.id, s]));
  const providerSummary: Record<string, number> = {};
  for (const id of availableIds) {
    const s = byId.get(id);
    const dom = (s?.email ?? "").split("@")[1] ?? "?";
    providerSummary[dom] = (providerSummary[dom] ?? 0) + 1;
  }
  console.log(
    `\n  AVAILABLE by domain: ${JSON.stringify(providerSummary, null, 2)}`,
  );

  const dump = {
    timestamp: new Date().toISOString(),
    workspaceSlug: WORKSPACE_SLUG,
    excludedEbCampaignIds: EXCLUDED_EB_CAMPAIGN_IDS,
    unavailableBySource: Object.fromEntries(unavailableBySource),
    unavailableUnion: [...unavailable].sort((a, b) => a - b),
    poolSize: sortedIds.length,
    poolIds: sortedIds,
    availableSize: availableIds.length,
    availableIds,
    buckets: buckets.map((b, i) => ({ label: `E${i + 1}`, ids: b })),
    capacityCheck: {
      required: REQUIRED_CAPACITY,
      actual: availableIds.length,
      pass: availableIds.length >= REQUIRED_CAPACITY,
    },
    providerSummary,
  };
  const outPath = "/tmp/_bl-lime-allocation-probe.json";
  writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(`\n[DUMP] Wrote ${outPath}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  await prisma.$disconnect();
  process.exit(1);
});
