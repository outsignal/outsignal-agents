/**
 * Deploy rebuild Phase 6a — preflight checks (read-only).
 *
 * Verifies the two canary campaigns (1210 Email + 1210 LinkedIn Facilities/Cleaning)
 * are in a clean, deployable state before firing the LIVE deploy CLI.
 *
 * Checks per campaign:
 *   - Campaign.status === 'approved'
 *   - Campaign.contentApproved === true
 *   - Campaign.leadsApproved === true
 *   - Campaign.emailBisonCampaignId === null
 *   - Campaign.deployedAt === null
 *   - Campaign.targetListId non-null AND TargetList._count.people > 0
 *   - Campaign.emailSequence (email canary) or linkedinSequence (LinkedIn canary)
 *     present + parseable JSON with >=1 step
 *   - Workspace.enabledModules includes the relevant channel
 *   - Workspace has at least one active sender for the channel
 *
 * Usage:
 *   npx tsx scripts/maintenance/_phase6a-preflight.ts
 *
 * Exits 0 when ALL checks pass for both canaries. Exits 1 otherwise (and prints
 * the failing check per campaign). Read-only — never mutates.
 */
import { prisma } from "@/lib/db";

interface CanarySpec {
  id: string;
  expectedChannel: "email" | "linkedin";
  expectedLeadCount: number;
}

const CANARIES: CanarySpec[] = [
  {
    id: "cmneqixpv0001p8710bov1fga",
    expectedChannel: "email",
    expectedLeadCount: 44,
  },
  {
    id: "cmneqixvz0003p871m8sw9u7o",
    expectedChannel: "linkedin",
    expectedLeadCount: 27,
  },
];

interface CheckRow {
  check: string;
  pass: boolean;
  value: string;
}

function parseJsonArray(raw: string | null): unknown[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSequence(raw: string | null): { steps: unknown[] } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Accept either { steps: [...] } or a bare array.
    if (Array.isArray(parsed)) return { steps: parsed };
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).steps)) {
      return parsed as { steps: unknown[] };
    }
    return null;
  } catch {
    return null;
  }
}

async function preflightCampaign(spec: CanarySpec): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];

  const campaign = await prisma.campaign.findUnique({
    where: { id: spec.id },
    include: {
      targetList: {
        include: {
          _count: { select: { people: true } },
        },
      },
      workspace: true,
    },
  });

  if (!campaign) {
    rows.push({ check: "campaign-exists", pass: false, value: "NOT FOUND" });
    return rows;
  }

  rows.push({ check: "campaign-exists", pass: true, value: campaign.name });

  rows.push({
    check: "status=approved",
    pass: campaign.status === "approved",
    value: campaign.status,
  });

  rows.push({
    check: "contentApproved=true",
    pass: campaign.contentApproved === true,
    value: String(campaign.contentApproved),
  });

  rows.push({
    check: "leadsApproved=true",
    pass: campaign.leadsApproved === true,
    value: String(campaign.leadsApproved),
  });

  rows.push({
    check: "emailBisonCampaignId=null",
    pass: campaign.emailBisonCampaignId === null,
    value: String(campaign.emailBisonCampaignId),
  });

  rows.push({
    check: "deployedAt=null",
    pass: campaign.deployedAt === null,
    value: campaign.deployedAt ? campaign.deployedAt.toISOString() : "null",
  });

  rows.push({
    check: "targetListId non-null",
    pass: campaign.targetListId !== null,
    value: campaign.targetListId ?? "null",
  });

  const peopleCount = campaign.targetList?._count.people ?? 0;
  rows.push({
    check: `targetList.people >0 (expect ${spec.expectedLeadCount})`,
    pass: peopleCount > 0,
    value: `${peopleCount} people`,
  });

  // Channel-specific sequence check.
  if (spec.expectedChannel === "email") {
    const seq = parseSequence(campaign.emailSequence);
    const stepCount = seq?.steps.length ?? 0;
    rows.push({
      check: "emailSequence parseable + steps>0",
      pass: seq !== null && stepCount > 0,
      value: seq === null ? "unparseable" : `${stepCount} steps`,
    });
  } else {
    const seq = parseSequence(campaign.linkedinSequence);
    const stepCount = seq?.steps.length ?? 0;
    rows.push({
      check: "linkedinSequence parseable + steps>0",
      pass: seq !== null && stepCount > 0,
      value: seq === null ? "unparseable" : `${stepCount} steps`,
    });
  }

  // Channel array.
  const channels = parseJsonArray(campaign.channels) as string[] | null;
  const channelsOk = Array.isArray(channels) && channels.includes(spec.expectedChannel);
  rows.push({
    check: `channels includes '${spec.expectedChannel}'`,
    pass: channelsOk,
    value: channels?.join(",") ?? "unparseable",
  });

  // Workspace enabledModules.
  const modules = parseJsonArray(campaign.workspace.enabledModules) as string[] | null;
  // Module naming: "email" / "linkedin" (base) — or "email-signals"/"linkedin-signals".
  const moduleOk =
    Array.isArray(modules) &&
    modules.some((m) => m === spec.expectedChannel || m.startsWith(`${spec.expectedChannel}-`));
  rows.push({
    check: `workspace.enabledModules has '${spec.expectedChannel}'`,
    pass: moduleOk,
    value: modules?.join(",") ?? "unparseable",
  });

  // Sender check.
  if (spec.expectedChannel === "email") {
    const senders = await prisma.sender.findMany({
      where: {
        workspaceSlug: campaign.workspaceSlug,
        channel: { in: ["email", "both"] },
        status: "active",
      },
      select: {
        id: true,
        emailAddress: true,
        healthStatus: true,
        emailBounceStatus: true,
      },
    });
    const healthy = senders.filter(
      (s) =>
        (s.healthStatus === "healthy" || s.healthStatus === "warning") &&
        s.emailBounceStatus !== "critical",
    );
    rows.push({
      check: "email senders active+healthy>=1",
      pass: healthy.length >= 1,
      value: `${senders.length} active / ${healthy.length} healthy`,
    });
  } else {
    // LinkedIn: channel in (linkedin, both), status=active, sessionStatus=active.
    const senders = await prisma.sender.findMany({
      where: {
        workspaceSlug: campaign.workspaceSlug,
        channel: { in: ["linkedin", "both"] },
        status: "active",
      },
      select: {
        id: true,
        linkedinEmail: true,
        sessionStatus: true,
        healthStatus: true,
      },
    });
    const healthy = senders.filter(
      (s) =>
        s.sessionStatus === "active" &&
        (s.healthStatus === "healthy" || s.healthStatus === "warning"),
    );
    rows.push({
      check: "linkedin senders active+healthy>=1",
      pass: healthy.length >= 1,
      value: `${senders.length} active / ${healthy.length} healthy`,
    });
  }

  return rows;
}

function renderRow(row: CheckRow): string {
  const status = row.pass ? "PASS" : "FAIL";
  return `  [${status}] ${row.check.padEnd(50)} ${row.value}`;
}

async function main() {
  console.log("=".repeat(100));
  console.log("PHASE 6a — CANARY PREFLIGHT");
  console.log("=".repeat(100));

  let allPass = true;
  const summary: Array<{ id: string; name: string; pass: boolean; fails: string[] }> = [];

  for (const spec of CANARIES) {
    console.log(`\n---- Canary: ${spec.id} (${spec.expectedChannel}) ----`);
    const rows = await preflightCampaign(spec);
    let campaignName = "<unknown>";
    const firstCheck = rows[0];
    if (firstCheck && firstCheck.check === "campaign-exists" && firstCheck.pass) {
      campaignName = firstCheck.value;
    }
    for (const row of rows) {
      console.log(renderRow(row));
    }
    const fails = rows.filter((r) => !r.pass).map((r) => r.check);
    const campaignPass = fails.length === 0;
    summary.push({ id: spec.id, name: campaignName, pass: campaignPass, fails });
    if (!campaignPass) allPass = false;
  }

  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  for (const s of summary) {
    const verdict = s.pass ? "READY" : "BLOCKED";
    console.log(`  ${verdict.padEnd(8)} ${s.id} — ${s.name}`);
    if (s.fails.length > 0) {
      console.log(`           FAILS: ${s.fails.join(", ")}`);
    }
  }

  console.log("\n" + (allPass ? "GO — all canary preflight checks pass." : "STOP — one or more canary preflight checks failed."));
  process.exit(allPass ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("Preflight error:", err);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
