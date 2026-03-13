import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

// GET /api/deliverability/domains?workspace=slug
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = request.nextUrl.searchParams.get("workspace");

    const domains = await prisma.domainHealth.findMany({
      orderBy: { domain: "asc" },
    });

    if (domains.length === 0) {
      return NextResponse.json([]);
    }

    // Batch count senders per domain using groupBy on extracted domain
    // Sender emailAddress format: "name@domain.com" — extract domain with endsWith filter
    const domainNames = domains.map((d) => d.domain);

    // Build per-domain sender counts with a single grouped query
    const senderWhere = workspace ? { workspaceSlug: workspace } : {};
    const senders = await prisma.sender.findMany({
      where: {
        emailAddress: { not: null },
        ...senderWhere,
      },
      select: { emailAddress: true },
    });

    // Count senders per domain in JS
    const senderCountByDomain = new Map<string, number>();
    for (const domain of domainNames) {
      senderCountByDomain.set(domain, 0);
    }
    for (const sender of senders) {
      if (!sender.emailAddress) continue;
      const atIndex = sender.emailAddress.lastIndexOf("@");
      if (atIndex === -1) continue;
      const senderDomain = sender.emailAddress.slice(atIndex + 1);
      if (senderCountByDomain.has(senderDomain)) {
        senderCountByDomain.set(
          senderDomain,
          (senderCountByDomain.get(senderDomain) ?? 0) + 1
        );
      }
    }

    const result = domains.map((d) => {
      let dkimSelectors: string[] = [];
      let blacklistHits: string[] = [];

      try {
        if (d.dkimSelectors) {
          dkimSelectors = JSON.parse(d.dkimSelectors) as string[];
        }
      } catch {
        // malformed JSON — default to empty
      }

      try {
        if (d.blacklistHits) {
          blacklistHits = JSON.parse(d.blacklistHits) as string[];
        }
      } catch {
        // malformed JSON — default to empty
      }

      return {
        domain: d.domain,
        spfStatus: d.spfStatus,
        dkimStatus: d.dkimStatus,
        dkimSelectors,
        dmarcStatus: d.dmarcStatus,
        dmarcPolicy: d.dmarcPolicy,
        blacklistHits,
        blacklistSeverity: d.blacklistSeverity,
        overallHealth: d.overallHealth,
        lastDnsCheck: d.lastDnsCheck,
        lastBlacklistCheck: d.lastBlacklistCheck,
        activeSenderCount: senderCountByDomain.get(d.domain) ?? 0,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[deliverability/domains] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
