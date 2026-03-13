import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

// GET /api/deliverability/summary?workspace=slug
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = request.nextUrl.searchParams.get("workspace");

    // Build sender where clause for workspace filter
    const senderWhere = {
      emailAddress: { not: null as null },
      ...(workspace ? { workspaceSlug: workspace } : {}),
    };

    // Get all domains relevant to this workspace (or all domains)
    let domainHealthRecords;
    if (workspace) {
      // Get distinct sender domains for this workspace
      const senders = await prisma.sender.findMany({
        where: senderWhere,
        select: { emailAddress: true },
      });
      const domainSet = new Set<string>();
      for (const s of senders) {
        const parts = s.emailAddress?.split("@");
        if (parts && parts.length === 2 && parts[1]) {
          domainSet.add(parts[1]);
        }
      }
      const domains = Array.from(domainSet);
      domainHealthRecords = await prisma.domainHealth.findMany({
        where: { domain: { in: domains } },
      });
    } else {
      domainHealthRecords = await prisma.domainHealth.findMany();
    }

    // Count healthy vs at-risk
    const totalDomains = domainHealthRecords.length;
    const healthyDomains = domainHealthRecords.filter(
      (d) => d.overallHealth === "healthy"
    ).length;
    const atRiskDomains = domainHealthRecords.filter(
      (d) => d.overallHealth === "warning" || d.overallHealth === "critical"
    ).length;

    // Find worst domain: critical first, then highest blacklistSeverity, fallback to warning
    const criticalDomains = domainHealthRecords.filter(
      (d) => d.overallHealth === "critical"
    );
    const warningDomains = domainHealthRecords.filter(
      (d) => d.overallHealth === "warning"
    );

    let worstDomain: { domain: string; overallHealth: string } | null = null;
    if (criticalDomains.length > 0) {
      // Prefer domains with blacklist hits
      const withBlacklist = criticalDomains.filter(
        (d) => d.blacklistSeverity === "critical"
      );
      const candidate = withBlacklist[0] ?? criticalDomains[0];
      worstDomain = { domain: candidate.domain, overallHealth: candidate.overallHealth };
    } else if (warningDomains.length > 0) {
      const withBlacklist = warningDomains.filter(
        (d) => d.blacklistSeverity === "warning" || d.blacklistSeverity === "critical"
      );
      const candidate = withBlacklist[0] ?? warningDomains[0];
      worstDomain = { domain: candidate.domain, overallHealth: candidate.overallHealth };
    }

    // Count senders by emailBounceStatus
    const senderHealthGroups = await prisma.sender.groupBy({
      by: ["emailBounceStatus"],
      _count: true,
      where: senderWhere,
    });

    const senderTotal = senderHealthGroups.reduce((sum, g) => sum + g._count, 0);
    const senderHealthy =
      senderHealthGroups.find((g) => g.emailBounceStatus === "healthy")?._count ?? 0;
    const senderElevated =
      senderHealthGroups.find((g) => g.emailBounceStatus === "elevated")?._count ?? 0;
    const senderWarning =
      senderHealthGroups.find((g) => g.emailBounceStatus === "warning")?._count ?? 0;
    const senderCritical =
      senderHealthGroups.find((g) => g.emailBounceStatus === "critical")?._count ?? 0;

    // Recent events (quick preview)
    const eventWhere = workspace ? { workspaceSlug: workspace } : {};
    const recentEvents = await prisma.emailHealthEvent.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      where: eventWhere,
    });

    return NextResponse.json({
      domains: {
        total: totalDomains,
        healthy: healthyDomains,
        atRisk: atRiskDomains,
        worst: worstDomain,
      },
      senders: {
        total: senderTotal,
        healthy: senderHealthy,
        elevated: senderElevated,
        warning: senderWarning,
        critical: senderCritical,
      },
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        senderEmail: e.senderEmail,
        senderDomain: e.senderDomain,
        workspaceSlug: e.workspaceSlug,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        reason: e.reason,
        bouncePct: e.bouncePct,
        detail: e.detail,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    console.error("[deliverability/summary] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
