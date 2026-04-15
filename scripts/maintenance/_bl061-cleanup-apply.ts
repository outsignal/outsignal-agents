/**
 * BL-061 follow-up — apply cleanup.
 *
 * REAL WORLD (per inventory):
 *  - lime-recruitment: 6 email campaigns each got 2 duplicate EB drafts (12 drafts total)
 *  - 1210-solutions:   5 email campaigns each got 2 duplicate EB drafts (10 drafts total)
 *  - All 22 EB draft campaigns have leadCount=0, senderCount=0, status=draft
 *  - All corresponding CampaignDeploy rows have status='failed' (422 on sequence step upload)
 *  - All corresponding Campaign DB rows are status='deployed'
 *
 * Actions:
 *  1. Delete all 22 EB draft campaigns one at a time (with leadCount=0 safety re-check)
 *  2. Per DB campaign: wrap in transaction — flip CampaignDeploy.status -> 'rolled_back',
 *     flip Campaign.status deployed -> approved (only if still deployed)
 *
 * Stop on first EB delete failure. Safety: each delete re-verifies leadCount===0
 * immediately before calling DELETE.
 *
 * Flags:
 *   --dry-run    (default: false — LIVE)
 */
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const DRY_RUN = process.argv.includes("--dry-run");

// Hard-coded from inventory (2026-04-15T16:00 run) — fail-loud if state drifts
const DELETE_PLAN: Array<{
  slug: string;
  campaignName: string;
  ebIdsToDelete: number[];       // Draft duplicates to delete
  dbCampaignId: string;          // DB campaign whose status must flip deployed->approved
  deployIds: string[];           // DB CampaignDeploy rows to mark rolled_back
}> = [
  // --- lime-recruitment (6 campaigns, 12 EB drafts) ---
  { slug: "lime-recruitment", campaignName: "Lime Recruitment - Email - E1 - Manufacturing + Warehousing", ebIdsToDelete: [56, 64], dbCampaignId: "cmnpwzv9e010np8itsf3f35oy", deployIds: ["cmo00n0h20001p8j5huj8cjup"] },
  { slug: "lime-recruitment", campaignName: "Lime Recruitment - Email - E2 - Transportation + Logistics", ebIdsToDelete: [57, 66], dbCampaignId: "cmnpwzwi5011sp8itj20w1foq", deployIds: ["cmo00n2hr0004p8j5b3l4yx5g"] },
  { slug: "lime-recruitment", campaignName: "Lime Recruitment - Email - E3 - Engineering",                 ebIdsToDelete: [59, 70], dbCampaignId: "cmnpwzxmg012gp8itxv4dvmyb", deployIds: ["cmo00n3so0007p8j5on092jqa"] },
  { slug: "lime-recruitment", campaignName: "Lime Recruitment - Email - E4 - Factory Manager",             ebIdsToDelete: [58, 67], dbCampaignId: "cmnpwzym5014op8it2cpupfwx", deployIds: ["cmo00n5ev000ap8j5ofavaq62"] },
  { slug: "lime-recruitment", campaignName: "Lime Recruitment - Email - E5 - Shift Manager",               ebIdsToDelete: [60, 71], dbCampaignId: "cmnpx037s01dcp8itzzilfdfb", deployIds: ["cmo00n7wz000dp8j5pnig94cg"] },
  { slug: "lime-recruitment", campaignName: "Lime Recruitment - Email - OOO Welcome Back",                 ebIdsToDelete: [62, 73], dbCampaignId: "cmnq5nivc0001p8534g0k4wr6", deployIds: ["cmo00na6f000gp8j55m9xry36"] },

  // --- 1210-solutions (5 campaigns, 10 EB drafts) ---
  { slug: "1210-solutions", campaignName: "1210 Solutions - Email - Construction - April 2026",         ebIdsToDelete: [61, 72], dbCampaignId: "cmneq92p20000p8p7dhqn8g42", deployIds: ["cmo00nbyq000mp8j5j54fg5vf"] },
  { slug: "1210-solutions", campaignName: "1210 Solutions - Email - Facilities/Cleaning - April 2026",  ebIdsToDelete: [65, 74], dbCampaignId: "cmneqixpv0001p8710bov1fga", deployIds: ["cmo00nd6g000pp8j53qk6h1ky"] },
  { slug: "1210-solutions", campaignName: "1210 Solutions - Email - Green List Priority - April 2026",  ebIdsToDelete: [63, 75], dbCampaignId: "cmneq1sdj0001p8cg97lb9rhd", deployIds: ["cmo00ng33000sp8j5kxklfkro"] },
  { slug: "1210-solutions", campaignName: "1210 Solutions - Email - Healthcare - April 2026",           ebIdsToDelete: [68, 76], dbCampaignId: "cmneqhwo50001p843r5hmsul3", deployIds: ["cmo00ngzf000vp8j5pjg625n9"] },
  { slug: "1210-solutions", campaignName: "1210 Solutions - Email - Industrial/Warehouse - April 2026", ebIdsToDelete: [69, 77], dbCampaignId: "cmneqa5180001p8rkwyrrlkg8", deployIds: ["cmo00nhva000yp8j5nbxqegm7"] },
];

const ROLLBACK_ERROR = "EB duplicate deleted 2026-04-15 — see BL-061 follow-up (buggy deploy path created draft duplicates with 0 leads/senders, all failed 422 mid-upload)";

async function getClient(slug: string): Promise<EmailBisonClient> {
  const ws = await prisma.workspace.findUnique({ where: { slug }, select: { apiToken: true } });
  if (!ws?.apiToken) throw new Error(`No apiToken for workspace ${slug}`);
  return new EmailBisonClient(ws.apiToken);
}

async function main() {
  console.log(`[bl-061-cleanup] DRY_RUN=${DRY_RUN}`);
  console.log(`[bl-061-cleanup] ${DELETE_PLAN.length} DB campaigns, ${DELETE_PLAN.reduce((a, b) => a + b.ebIdsToDelete.length, 0)} EB drafts to delete`);

  const clientCache = new Map<string, EmailBisonClient>();
  const getEb = async (slug: string) => {
    if (!clientCache.has(slug)) clientCache.set(slug, await getClient(slug));
    return clientCache.get(slug)!;
  };

  const results: Array<{ slug: string; ebId: number; action: string; ok: boolean; note?: string }> = [];

  // Step A — delete all EB drafts (serialized, stop on first failure)
  for (const row of DELETE_PLAN) {
    const client = await getEb(row.slug);
    for (const ebId of row.ebIdsToDelete) {
      // Safety re-check: refetch leads, refuse if any exist
      try {
        const leads = await client.getCampaignLeads(ebId, 1, 1);
        const total = leads.meta.total;
        if (total !== 0) {
          console.error(`[FAIL] ${row.slug} ebId=${ebId} has leadCount=${total} — REFUSING delete. Stopping.`);
          results.push({ slug: row.slug, ebId, action: "delete", ok: false, note: `leadCount=${total}` });
          throw new Error("safety guard: non-zero lead count");
        }
      } catch (e: any) {
        if (!String(e.message).includes("safety guard")) {
          console.error(`[FAIL] ${row.slug} ebId=${ebId} pre-check threw: ${e.message}`);
          results.push({ slug: row.slug, ebId, action: "delete", ok: false, note: `precheck: ${e.message}` });
          throw e;
        }
        throw e;
      }

      if (DRY_RUN) {
        console.log(`[DRY] would DELETE /api/campaigns/${ebId} (${row.slug} "${row.campaignName}")`);
        results.push({ slug: row.slug, ebId, action: "delete-dry", ok: true });
        continue;
      }

      try {
        await client.deleteCampaign(ebId);
        // Verify deletion (getCampaignById swallows errors → null when not found)
        const check = await client.getCampaignById(ebId);
        if (check !== null) {
          // EB docs say deletion is queued (background); a still-visible record
          // immediately after DELETE is possible. Log a warning but treat the
          // DELETE call's 2xx as authoritative — we did the deletion.
          console.log(`  ebId=${ebId} DELETEd (verify: still visible, EB queues deletions — OK)`);
          results.push({ slug: row.slug, ebId, action: "delete", ok: true, note: "still visible (EB queues deletions)" });
        } else {
          console.log(`  ebId=${ebId} DELETEd (verify: gone)`);
          results.push({ slug: row.slug, ebId, action: "delete", ok: true });
        }
      } catch (e: any) {
        console.error(`[FAIL] ${row.slug} ebId=${ebId} delete threw: ${e.message}`);
        results.push({ slug: row.slug, ebId, action: "delete", ok: false, note: e.message });
        throw e;
      }
    }
  }

  // Step B — DB cleanup per DB campaign (all EB deletes succeeded if we got here)
  for (const row of DELETE_PLAN) {
    // Double-check current state
    const dbCampaign = await prisma.campaign.findUnique({ where: { id: row.dbCampaignId }, select: { status: true, name: true } });
    if (!dbCampaign) {
      console.error(`[FAIL] DB campaign ${row.dbCampaignId} not found`);
      results.push({ slug: row.slug, ebId: 0, action: "db-campaign-missing", ok: false, note: row.dbCampaignId });
      throw new Error(`DB campaign missing: ${row.dbCampaignId}`);
    }
    if (dbCampaign.status !== "deployed") {
      console.error(`[FAIL] DB campaign ${row.dbCampaignId} status=${dbCampaign.status} (expected 'deployed') — refusing to flip`);
      results.push({ slug: row.slug, ebId: 0, action: "db-status-unexpected", ok: false, note: `status=${dbCampaign.status}` });
      throw new Error(`DB campaign status unexpected: ${dbCampaign.status}`);
    }

    if (DRY_RUN) {
      console.log(`[DRY] would flip Campaign.${row.dbCampaignId} deployed->approved, CampaignDeploy.${row.deployIds.join(",")} -> rolled_back`);
      for (const deployId of row.deployIds) {
        results.push({ slug: row.slug, ebId: 0, action: "db-flip-dry", ok: true, note: `${deployId} / ${row.dbCampaignId}` });
      }
      continue;
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.campaignDeploy.updateMany({
        where: { id: { in: row.deployIds } },
        data: { status: "rolled_back", error: ROLLBACK_ERROR, completedAt: now },
      }),
      prisma.campaign.updateMany({
        where: { id: row.dbCampaignId, status: "deployed" },
        data: { status: "approved" },
      }),
    ]);
    console.log(`  DB: campaign ${row.dbCampaignId} deployed->approved; deploys [${row.deployIds.join(", ")}] -> rolled_back`);
    for (const deployId of row.deployIds) {
      results.push({ slug: row.slug, ebId: 0, action: "db-flipped", ok: true, note: `${deployId} / ${row.dbCampaignId}` });
    }
  }

  // Summary
  console.log(`\n================ SUMMARY ================`);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`Total actions: ${results.length}  (ok=${ok}  fail=${fail})`);
  for (const r of results) {
    console.log(`  ${r.ok ? "OK" : "FAIL"} ${r.slug} action=${r.action} ebId=${r.ebId || "-"} ${r.note ?? ""}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.message ?? e); process.exit(1); });
