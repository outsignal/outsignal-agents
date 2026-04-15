/**
 * BL-061 follow-up — READ-ONLY inventory of duplicate EB campaigns created
 * by the buggy `scripts/cli/campaign-deploy.ts` run at 2026-04-15 ~12:17-12:18 UTC
 * in lime-recruitment (7) and 1210-solutions (10).
 *
 * Does NOT mutate anything. Produces a JSON + human-readable plan used by the
 * deletion script.
 */
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACES = ["lime-recruitment", "1210-solutions"] as const;
const WINDOW_START = new Date("2026-04-15T11:00:00Z");
const WINDOW_END = new Date("2026-04-15T13:00:00Z");

interface Pair {
  campaignName: string;
  originalEbId: number | null;
  originalLeadCount: number | null;
  originalCreatedAt: string | null;
  duplicateEbId: number;
  duplicateLeadCount: number | null;
  duplicateCreatedAt: string | null;
  ourDbCampaignId: string;
  ourDbCampaignStatus: string;
  ourDbDeployId: string;
  ourDbDeployStatus: string;
}

async function inventoryWorkspace(slug: string): Promise<{ slug: string; pairs: Pair[]; issues: string[] }> {
  const issues: string[] = [];
  const pairs: Pair[] = [];

  const ws = await prisma.workspace.findUnique({ where: { slug }, select: { slug: true, apiToken: true } });
  if (!ws?.apiToken) {
    issues.push(`workspace ${slug} has no apiToken`);
    return { slug, pairs, issues };
  }
  const client = new EmailBisonClient(ws.apiToken);

  // DB: Monty's deploy records in the incident window
  const deploys = await prisma.campaignDeploy.findMany({
    where: {
      workspaceSlug: slug,
      createdAt: { gte: WINDOW_START, lte: WINDOW_END },
    },
    include: { campaign: { select: { id: true, name: true, status: true } } },
  });

  console.log(`[${slug}] Found ${deploys.length} deploy record(s) in window ${WINDOW_START.toISOString()}..${WINDOW_END.toISOString()}`);

  // EB: all campaigns
  const ebCampaigns = await client.getCampaigns();
  console.log(`[${slug}] EB has ${ebCampaigns.length} campaigns total`);

  // Group EB campaigns by name (case-insensitive, trimmed)
  const byName = new Map<string, any[]>();
  for (const c of ebCampaigns) {
    const key = (c.name ?? "").trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(c);
  }

  for (const dep of deploys) {
    if (!dep.emailBisonCampaignId) {
      issues.push(`deploy ${dep.id} has no emailBisonCampaignId; skipping`);
      continue;
    }
    const ebId = dep.emailBisonCampaignId;
    const name = dep.campaignName;

    // Fetch duplicate detail
    const dup = ebCampaigns.find((c) => c.id === ebId);
    if (!dup) {
      issues.push(`[${slug}] deploy ${dep.id} claims ebId=${ebId} but not in EB getCampaigns()`);
    }
    const dupLeads = await client.getCampaignLeads(ebId, 1, 1).catch((e) => {
      issues.push(`[${slug}] ebId=${ebId} getCampaignLeads threw: ${e?.message ?? e}`);
      return null;
    });
    const dupLeadTotal = dupLeads?.meta?.total ?? null;

    // Find candidate original: same name, different EB id, leadCount > 0
    const nameKey = (name ?? "").trim().toLowerCase();
    const candidates = byName.get(nameKey) ?? [];
    const others = candidates.filter((c) => c.id !== ebId);

    let originalEbId: number | null = null;
    let originalLeads: number | null = null;
    let originalCreatedAt: string | null = null;

    if (others.length === 0) {
      issues.push(`[${slug}] ebId=${ebId} name=${JSON.stringify(name)}: NO other EB campaign with same name — cannot confirm original`);
    } else if (others.length > 1) {
      issues.push(`[${slug}] ebId=${ebId} name=${JSON.stringify(name)}: ${others.length} candidates with same name — ambiguous, requires manual review`);
      // Show all candidates
      for (const o of others) {
        const oLeads = await client.getCampaignLeads(o.id, 1, 1).catch(() => null);
        issues.push(`    candidate ebId=${o.id} leads=${oLeads?.meta?.total ?? "?"} created_at=${(o as any).created_at ?? "?"}`);
      }
    } else {
      const orig = others[0];
      const origLeads = await client.getCampaignLeads(orig.id, 1, 1).catch((e) => {
        issues.push(`[${slug}] ebId=${orig.id} (original candidate) getCampaignLeads threw: ${e?.message ?? e}`);
        return null;
      });
      originalEbId = orig.id;
      originalLeads = origLeads?.meta?.total ?? null;
      originalCreatedAt = (orig as any).created_at ?? null;

      // Sanity: duplicate should have 0 leads and be the newer of the two
      if (dupLeadTotal !== 0) {
        issues.push(`[${slug}] ebId=${ebId} (duplicate) has leadCount=${dupLeadTotal} (expected 0) — REFUSING to flag as safe-to-delete`);
      }
      const dupCreated = (dup as any)?.created_at ?? null;
      if (dupCreated && originalCreatedAt && dupCreated < originalCreatedAt) {
        issues.push(`[${slug}] ebId=${ebId} is OLDER than candidate original ${originalEbId} (${dupCreated} < ${originalCreatedAt}) — name collision not a simple duplicate`);
      }
    }

    pairs.push({
      campaignName: name,
      originalEbId,
      originalLeadCount: originalLeads,
      originalCreatedAt,
      duplicateEbId: ebId,
      duplicateLeadCount: dupLeadTotal,
      duplicateCreatedAt: (dup as any)?.created_at ?? null,
      ourDbCampaignId: dep.campaignId,
      ourDbCampaignStatus: dep.campaign?.status ?? "(unknown)",
      ourDbDeployId: dep.id,
      ourDbDeployStatus: dep.status,
    });
  }

  return { slug, pairs, issues };
}

async function main() {
  const results = [];
  for (const slug of WORKSPACES) {
    const r = await inventoryWorkspace(slug);
    results.push(r);
  }

  console.log("\n================ INVENTORY REPORT ================");
  for (const r of results) {
    console.log(`\n### ${r.slug} — ${r.pairs.length} pair(s)`);
    console.table(
      r.pairs.map((p) => ({
        name: p.campaignName,
        origEb: p.originalEbId,
        origLeads: p.originalLeadCount,
        dupEb: p.duplicateEbId,
        dupLeads: p.duplicateLeadCount,
        dbCampaign: p.ourDbCampaignId.slice(0, 10),
        dbStatus: p.ourDbCampaignStatus,
        deployId: p.ourDbDeployId.slice(0, 10),
      }))
    );
    if (r.issues.length) {
      console.log("  ISSUES:");
      for (const i of r.issues) console.log("    -", i);
    }
  }
  console.log("\n(raw JSON follows)\n");
  console.log(JSON.stringify(results, null, 2));

  // Exit summary
  const total = results.reduce((a, b) => a + b.pairs.length, 0);
  const expected = { "lime-recruitment": 7, "1210-solutions": 10 };
  for (const r of results) {
    const exp = (expected as any)[r.slug];
    if (r.pairs.length !== exp) {
      console.error(`\n[FAIL] ${r.slug}: expected ${exp} pairs, got ${r.pairs.length}`);
    }
  }
  console.log(`\nTotal pairs: ${total}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
