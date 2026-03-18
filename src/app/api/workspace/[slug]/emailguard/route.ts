import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { emailguard } from "@/lib/emailguard/client";

type RouteContext = { params: Promise<{ slug: string }> };

// Cache window — only re-fetch if last check was more than 6 hours ago
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types for the response
// ---------------------------------------------------------------------------

interface DomainEmailGuardData {
  domain: string;
  reputation: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  nameserverReputation: Record<string, unknown> | null;
  dmarcInsights: Record<string, unknown> | null;
  dmarcSources: Array<Record<string, unknown>> | null;
  dmarcFailures: Array<Record<string, unknown>> | null;
  lastChecked: string | null;
}

// ---------------------------------------------------------------------------
// GET — fetch EmailGuard data for workspace domains
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: RouteContext) {
  const admin = await requireAdminAuth();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if EmailGuard is configured
  if (!process.env.EMAILGUARD_API_TOKEN) {
    return NextResponse.json({ available: false });
  }

  const { slug } = await ctx.params;

  // Get workspace to verify it exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Get workspace sender domains
  const senders = await prisma.sender.findMany({
    where: { workspaceSlug: slug, emailAddress: { not: null } },
    select: { emailAddress: true },
  });

  const domainSet = new Set<string>();
  for (const s of senders) {
    if (!s.emailAddress) continue;
    const atIdx = s.emailAddress.lastIndexOf("@");
    if (atIdx !== -1) domainSet.add(s.emailAddress.slice(atIdx + 1));
  }

  const domainList = [...domainSet];
  if (domainList.length === 0) {
    return NextResponse.json({ available: true, domains: [] });
  }

  // Get DomainHealth records for cache check
  const domainHealthRecords = await prisma.domainHealth.findMany({
    where: { domain: { in: domainList } },
    select: {
      domain: true,
      emailguardUuid: true,
      updatedAt: true,
    },
  });

  const healthByDomain = new Map(
    domainHealthRecords.map((d) => [d.domain, d]),
  );

  const results: DomainEmailGuardData[] = [];
  const now = Date.now();

  for (const domain of domainList) {
    const health = healthByDomain.get(domain);
    const lastUpdated = health?.updatedAt?.getTime() ?? 0;
    const isCached = now - lastUpdated < CACHE_TTL_MS;

    // If recently checked, skip external API calls — return cached indicator
    if (isCached && health) {
      results.push({
        domain,
        reputation: null,
        context: null,
        nameserverReputation: null,
        dmarcInsights: null,
        dmarcSources: null,
        dmarcFailures: null,
        lastChecked: health.updatedAt.toISOString(),
      });
      continue;
    }

    // Fetch fresh data from EmailGuard
    const entry: DomainEmailGuardData = {
      domain,
      reputation: null,
      context: null,
      nameserverReputation: null,
      dmarcInsights: null,
      dmarcSources: null,
      dmarcFailures: null,
      lastChecked: null,
    };

    try {
      const [reputation, context, nsReputation] = await Promise.allSettled([
        emailguard.checkDomainReputation(domain),
        emailguard.checkDomainContext(domain),
        emailguard.checkNameserverReputation(domain),
      ]);

      if (reputation.status === "fulfilled") entry.reputation = reputation.value;
      if (context.status === "fulfilled") entry.context = context.value;
      if (nsReputation.status === "fulfilled")
        entry.nameserverReputation = nsReputation.value;

      // DMARC insights require the emailguardUuid
      if (health?.emailguardUuid) {
        const [insights, sources, failures] = await Promise.allSettled([
          emailguard.getDmarcInsights(health.emailguardUuid),
          emailguard.getDmarcSources(health.emailguardUuid),
          emailguard.getDmarcFailures(health.emailguardUuid),
        ]);

        if (insights.status === "fulfilled")
          entry.dmarcInsights = insights.value as unknown as Record<string, unknown>;
        if (sources.status === "fulfilled")
          entry.dmarcSources = sources.value as unknown as Array<Record<string, unknown>>;
        if (failures.status === "fulfilled")
          entry.dmarcFailures = failures.value as unknown as Array<Record<string, unknown>>;
      }

      entry.lastChecked = new Date().toISOString();
    } catch (err) {
      // Log but don't fail the entire request for one domain
      console.error(`[emailguard] Error fetching data for ${domain}:`, err);
    }

    results.push(entry);
  }

  return NextResponse.json({ available: true, domains: results });
}
