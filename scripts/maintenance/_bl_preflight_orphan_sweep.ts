/**
 * BL pre-flight EB orphan sweep (2026-04-16) — READ-ONLY.
 *
 * Purpose
 * -------
 * For every EB-connected workspace (Workspace.apiToken IS NOT NULL), fetch
 * the complete list of campaigns from EmailBison and cross-reference against
 * every Campaign row in our DB (by `emailBisonCampaignId`). Any EB campaign
 * ID NOT referenced by our DB is an **orphan** — residual state from a
 * prior failed deploy or manual cleanup gap.
 *
 * Rules observed
 *   - api-client-rules.md: uses EmailBisonClient (never raw fetch).
 *   - live-data-rules.md: workspace list is queried from the DB, not
 *     hardcoded.
 *   - READ-ONLY: no EB mutations, no DB writes.
 *
 * The canary campaign `cmneqixpv` is NOT interrogated directly. It WILL
 * appear in its workspace's EB list (as whatever EB ID the active canary
 * push has assigned) — if its EB ID is found in the DB (which it should be
 * since the canary is iterating), it will not be flagged as an orphan.
 *
 * Output
 * ------
 *   /tmp/eb-preflight-orphans-2026-04-16.json
 *   [{ workspace, totalCampaigns, draftCount, activeCount, pausedCount,
 *      completedCount, campaignIds, orphanIds, orphanDetails }]
 */
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Campaign as EbCampaign } from "@/lib/emailbison/types";
import { writeFileSync } from "fs";

type WorkspaceSweep = {
  workspace: string;
  ebError: string | null;
  totalCampaigns: number;
  byStatus: Record<string, number>;
  orphanIds: number[];
  orphanDetails: Array<{
    ebId: number;
    name: string;
    status: string;
    created_at: string;
    emails_sent: number;
    total_leads: number;
  }>;
};

async function sweepWorkspace(
  slug: string,
  apiToken: string,
  knownEbIds: Set<number>,
): Promise<WorkspaceSweep> {
  const client = new EmailBisonClient(apiToken);
  try {
    const campaigns: EbCampaign[] = await client.getCampaigns();
    const byStatus: Record<string, number> = {};
    for (const c of campaigns) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    }
    const orphans = campaigns.filter((c) => !knownEbIds.has(c.id));
    return {
      workspace: slug,
      ebError: null,
      totalCampaigns: campaigns.length,
      byStatus,
      orphanIds: orphans.map((c) => c.id),
      orphanDetails: orphans.map((c) => ({
        ebId: c.id,
        name: c.name,
        status: c.status,
        created_at: c.created_at,
        emails_sent: c.emails_sent,
        total_leads: c.total_leads,
      })),
    };
  } catch (err) {
    return {
      workspace: slug,
      ebError: err instanceof Error ? err.message.slice(0, 400) : String(err),
      totalCampaigns: 0,
      byStatus: {},
      orphanIds: [],
      orphanDetails: [],
    };
  }
}

async function main(): Promise<void> {
  // Live query — don't hardcode workspaces (live-data-rules.md).
  const workspaces = await prisma.workspace.findMany({
    where: { apiToken: { not: null } },
    select: { slug: true, apiToken: true, name: true },
    orderBy: { slug: "asc" },
  });

  console.log(`[info] EB-connected workspaces: ${workspaces.length}`);
  workspaces.forEach((w) => console.log(`  - ${w.slug} (${w.name})`));

  // Build the set of EB IDs that OUR DB claims ownership of (across ALL
  // workspaces — EB IDs are globally unique per tenant, but our
  // `emailBisonCampaignId` has a @unique constraint so the superset is
  // what we want to cross-reference against each workspace's EB list).
  const knownCampaigns = await prisma.campaign.findMany({
    where: { emailBisonCampaignId: { not: null } },
    select: {
      id: true,
      workspaceSlug: true,
      emailBisonCampaignId: true,
      status: true,
      name: true,
    },
  });
  console.log(
    `[info] DB campaigns with emailBisonCampaignId set: ${knownCampaigns.length}`,
  );

  // Per-workspace set of EB IDs OUR DB owns (scope cross-ref to same slug).
  const knownByWorkspace = new Map<string, Set<number>>();
  for (const c of knownCampaigns) {
    if (c.emailBisonCampaignId == null) continue;
    const set = knownByWorkspace.get(c.workspaceSlug) ?? new Set<number>();
    set.add(c.emailBisonCampaignId);
    knownByWorkspace.set(c.workspaceSlug, set);
  }

  const sweeps: WorkspaceSweep[] = [];
  for (const ws of workspaces) {
    if (!ws.apiToken) continue;
    const knownSet = knownByWorkspace.get(ws.slug) ?? new Set<number>();
    console.log(
      `\n[sweep] ${ws.slug} (known DB ebIds: ${knownSet.size})...`,
    );
    const r = await sweepWorkspace(ws.slug, ws.apiToken, knownSet);
    if (r.ebError) {
      console.log(`  ERROR: ${r.ebError}`);
    } else {
      console.log(
        `  total=${r.totalCampaigns} status=${JSON.stringify(r.byStatus)} orphans=${r.orphanIds.length}`,
      );
      r.orphanDetails.forEach((o) => {
        console.log(
          `    orphan: eb#${o.ebId} [${o.status}] "${o.name.slice(0, 60)}" sent=${o.emails_sent}`,
        );
      });
    }
    sweeps.push(r);
  }

  const outPath = "/tmp/eb-preflight-orphans-2026-04-16.json";
  writeFileSync(outPath, JSON.stringify(sweeps, null, 2));
  console.log(`\n[ok] wrote ${outPath}`);

  const totalOrphans = sweeps.reduce((s, x) => s + x.orphanIds.length, 0);
  const wsWithOrphans = sweeps.filter((s) => s.orphanIds.length > 0).length;
  console.log(
    `\n=== ORPHAN SWEEP SUMMARY: ${totalOrphans} orphan(s) across ${wsWithOrphans} workspace(s) ===`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
