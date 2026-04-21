/**
 * client-sweep.ts
 *
 * Comprehensive workspace investigation script.
 * Checks DB records, local files, memory, docs, scripts, and KB
 * to give the full picture before any workspace work begins.
 *
 * Usage: npx tsx scripts/cli/client-sweep.ts <workspace-slug>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { globSync } from "glob";

const [, , slug] = process.argv;

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();

function fileSize(path: string): string {
  try {
    const bytes = statSync(path).size;
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  } catch {
    return "?";
  }
}

function readFirstLines(path: string, n: number): string[] {
  try {
    const content = readFileSync(path, "utf8");
    return content.split("\n").slice(0, n);
  } catch {
    return [];
  }
}

function hasRealEntries(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8").trim();
    // Seed-only files have only comments, headers, and placeholder text
    const lines = content.split("\n").filter(
      (l) =>
        l.trim() &&
        !l.trim().startsWith("<!--") &&
        !l.trim().startsWith("#") &&
        !l.trim().startsWith("---") &&
        !l.trim().startsWith("|") &&
        !l.trim().startsWith("(No ") &&
        !l.trim().startsWith("Not configured") &&
        !l.trim().startsWith("Active:") &&
        !l.trim().startsWith("seeded:")
    );
    // Check for ISO-date entries (the append format used by agents)
    const dateEntries = content.match(/\[\d{4}-\d{2}-\d{2}/g);
    return (dateEntries && dateEntries.length > 0) || lines.length > 10;
  } catch {
    return false;
  }
}

runWithHarness("client-sweep <slug>", async () => {
  if (!slug) throw new Error("Missing required argument: workspace slug");

  const report: Record<string, unknown> = { slug };

  // 1. Workspace record
  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) throw new Error(`Workspace '${slug}' not found`);

  report.workspace = {
    name: ws.name,
    slug: ws.slug,
    vertical: ws.vertical ?? null,
    package: ws.package,
    status: ws.status,
    website: ws.website ?? null,
    monitoringEnabled: ws.monitoringEnabled,
    onboardingNotes: ws.onboardingNotes ?? null,
    description: ws.differentiators ? "has differentiators" : null,
    enabledModules: ws.enabledModules,
    monthlyLeadQuota: ws.monthlyLeadQuota,
    monthlyCampaignAllowance: ws.monthlyCampaignAllowance,
    icpConfigured: !!(ws.icpIndustries || ws.icpCountries || ws.icpDecisionMakerTitles),
    coreOffers: ws.coreOffers ? ws.coreOffers.slice(0, 200) + (ws.coreOffers.length > 200 ? "..." : "") : null,
    outreachTonePrompt: ws.outreachTonePrompt ?? null,
  };

  // 2. Senders
  // INTENTIONAL-BROAD: diagnostic sweep must show every sender row, including
  // email-only fan-out and stale placeholders, so operators can inspect drift.
  const senders = await prisma.sender.findMany({
    where: { workspaceSlug: slug },
    select: {
      id: true,
      name: true,
      emailAddress: true,
      linkedinProfileUrl: true,
      channel: true,
      status: true,
      healthStatus: true,
      sessionStatus: true,
      warmupDay: true,
      warmupStartedAt: true,
      emailBounceStatus: true,
    },
  });

  const emailSenders = senders.filter((s) => s.channel === "email" || s.channel === "both");
  const linkedinSenders = senders.filter((s) => s.channel === "linkedin" || s.channel === "both");
  const unhealthySenders = senders.filter(
    (s) => s.healthStatus !== "healthy" || s.sessionStatus === "expired" || s.emailBounceStatus !== "healthy"
  );

  report.senders = {
    total: senders.length,
    email: emailSenders.length,
    linkedin: linkedinSenders.length,
    byStatus: senders.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    flagged: unhealthySenders.map((s) => ({
      name: s.name,
      email: s.emailAddress,
      channel: s.channel,
      healthStatus: s.healthStatus,
      sessionStatus: s.sessionStatus,
      emailBounceStatus: s.emailBounceStatus,
    })),
  };

  // 3. Campaigns
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceSlug: slug },
    select: {
      id: true,
      name: true,
      status: true,
      channels: true,
      copyStrategy: true,
      type: true,
      targetListId: true,
      createdAt: true,
      _count: { select: { deploys: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  report.campaigns = {
    total: campaigns.length,
    items: campaigns.map((c) => ({
      name: c.name,
      status: c.status,
      channels: c.channels,
      strategy: c.copyStrategy ?? "n/a",
      type: c.type,
      hasTargetList: !!c.targetListId,
      deploys: c._count.deploys,
      created: c.createdAt.toISOString().split("T")[0],
    })),
  };

  // 4. People
  const personCount = await prisma.personWorkspace.count({
    where: { workspace: slug },
  });

  report.people = {
    inWorkspace: personCount,
  };

  // 5. Target lists
  const targetLists = await prisma.targetList.findMany({
    where: { workspaceSlug: slug },
    select: {
      id: true,
      name: true,
      description: true,
      _count: { select: { people: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  report.targetLists = {
    total: targetLists.length,
    items: targetLists.map((l) => ({
      name: l.name,
      description: l.description,
      people: l._count.people,
      created: l.createdAt.toISOString().split("T")[0],
    })),
  };

  // 6. Replies
  const replyCount = await prisma.reply.count({
    where: { workspaceSlug: slug },
  });

  let replyBreakdown: Record<string, number> = {};
  if (replyCount > 0) {
    const intentGroups = await prisma.reply.groupBy({
      by: ["intent"],
      where: { workspaceSlug: slug },
      _count: true,
    });
    replyBreakdown = intentGroups.reduce((acc, g) => {
      acc[g.intent ?? "unclassified"] = g._count;
      return acc;
    }, {} as Record<string, number>);
  }

  report.replies = {
    total: replyCount,
    byIntent: replyBreakdown,
  };

  // 7. Data files
  const dataDir = join(PROJECT_ROOT, "data");
  const dataFiles: { name: string; size: string }[] = [];
  if (existsSync(dataDir)) {
    try {
      const files = readdirSync(dataDir).filter(
        (f) => f.startsWith(`${slug}-`) || f.includes(slug)
      );
      for (const f of files) {
        dataFiles.push({ name: f, size: fileSize(join(dataDir, f)) });
      }
    } catch {
      // ignore read errors
    }
  }
  report.dataFiles = dataFiles.length > 0 ? dataFiles : "none";

  // 8. Client docs
  const clientDocPath = join(PROJECT_ROOT, "docs", "clients", `${slug}.md`);
  if (existsSync(clientDocPath)) {
    const firstLines = readFirstLines(clientDocPath, 5);
    report.clientDoc = {
      exists: true,
      path: clientDocPath,
      preview: firstLines,
    };
  } else {
    report.clientDoc = { exists: false };
  }

  // 9. Memory files
  const memoryDir = join(PROJECT_ROOT, ".nova", "memory", slug);
  const memoryFiles = ["profile.md", "learnings.md", "campaigns.md", "feedback.md"];
  const memoryStatus: Record<string, { exists: boolean; hasRealEntries: boolean }> = {};

  for (const mf of memoryFiles) {
    const mfPath = join(memoryDir, mf);
    if (existsSync(mfPath)) {
      memoryStatus[mf] = { exists: true, hasRealEntries: hasRealEntries(mfPath) };
    } else {
      memoryStatus[mf] = { exists: false, hasRealEntries: false };
    }
  }
  report.memory = memoryStatus;

  // 10. Knowledge base
  const wsName = ws.name.toLowerCase();
  const kbCount = await prisma.knowledgeDocument.count({
    where: {
      OR: [
        { title: { contains: wsName, mode: "insensitive" } },
        { title: { contains: slug, mode: "insensitive" } },
        { tags: { contains: slug, mode: "insensitive" } },
      ],
    },
  });
  report.knowledgeBase = { documentsMatchingWorkspace: kbCount };

  // 11. Scripts
  const scriptsDir = join(PROJECT_ROOT, "scripts");
  const clientScripts: string[] = [];
  if (existsSync(scriptsDir)) {
    try {
      const allScripts = readdirSync(scriptsDir);
      const matches = allScripts.filter(
        (f) => f.includes(slug) && (f.endsWith(".ts") || f.endsWith(".js"))
      );
      clientScripts.push(...matches);
    } catch {
      // ignore
    }
  }
  report.scripts = clientScripts.length > 0 ? clientScripts : "none";

  // 12. Website analyses
  const waCount = await prisma.websiteAnalysis.count({
    where: { workspaceSlug: slug },
  });
  let latestWa: Date | null = null;
  if (waCount > 0) {
    const latest = await prisma.websiteAnalysis.findFirst({
      where: { workspaceSlug: slug },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    latestWa = latest?.createdAt ?? null;
  }
  report.websiteAnalyses = {
    count: waCount,
    latest: latestWa?.toISOString().split("T")[0] ?? null,
  };

  // 13. Agent runs
  const agentRuns = await prisma.agentRun.findMany({
    where: { workspaceSlug: slug },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      agent: true,
      status: true,
      createdAt: true,
      durationMs: true,
    },
  });
  report.recentAgentRuns = agentRuns.map((r) => ({
    agent: r.agent,
    status: r.status,
    date: r.createdAt.toISOString().split("T")[0],
    durationMs: r.durationMs,
  }));

  // 14. Campaign preferences
  const campaignPrefsPath = resolve(
    "/Users/jjay/.claude/projects/-Users-jjay-programs/memory/campaign-preferences.md"
  );
  let campaignPrefs: string | null = null;
  if (existsSync(campaignPrefsPath)) {
    try {
      const content = readFileSync(campaignPrefsPath, "utf8");
      // Extract section for this slug
      const slugPattern = new RegExp(
        `## [^\\n]*\\(slug: \`${slug}\`\\)[\\s\\S]*?(?=\\n## |$)`,
        "i"
      );
      const match = content.match(slugPattern);
      campaignPrefs = match ? match[0].trim() : null;
    } catch {
      // ignore
    }
  }
  report.campaignPreferences = campaignPrefs ?? "not found";

  // 15. Onboarding data
  report.onboardingData = {
    notes: ws.onboardingNotes ?? null,
    senderFullName: ws.senderFullName ?? null,
    senderJobTitle: ws.senderJobTitle ?? null,
    senderPhone: ws.senderPhone ?? null,
    website: ws.website ?? null,
    linkedinUsername: ws.linkedinUsername ? "configured" : null,
  };

  return report;
});
