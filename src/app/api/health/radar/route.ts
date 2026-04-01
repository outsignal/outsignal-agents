import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // --- Auth (same pattern as /api/people/enrich) ---
  const secret =
    process.env.INGEST_WEBHOOK_SECRET ?? process.env.CLAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook authentication not configured" },
      { status: 401 },
    );
  }

  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  const apiKeyBuf = Buffer.from(apiKey);
  const secretBuf = Buffer.from(secret);
  if (
    apiKeyBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(apiKeyBuf, secretBuf)
  ) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  // --- Query active workspaces (skip monitoringEnabled=false) ---
  const workspaces = await prisma.workspace.findMany({
    where: { status: "active", monitoringEnabled: true },
    select: { slug: true, name: true, status: true },
  });

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const workspaceResults = await Promise.all(
    workspaces.map(async (ws) => {
      // --- LinkedIn senders ---
      const linkedinSenders = await prisma.sender.findMany({
        where: { workspaceSlug: ws.slug, channel: "linkedin" },
        select: {
          id: true,
          name: true,
          status: true,
          healthStatus: true,
          sessionStatus: true,
          lastPolledAt: true,
          warmupDay: true,
          dailyConnectionLimit: true,
          dailyMessageLimit: true,
          dailyProfileViewLimit: true,
        },
      });

      const senderIds = linkedinSenders.map((s) => s.id);

      // Today's actions grouped by sender + status
      const todayActions =
        senderIds.length > 0
          ? await prisma.linkedInAction.groupBy({
              by: ["senderId", "status"],
              where: {
                senderId: { in: senderIds },
                scheduledFor: { gte: todayStart, lte: todayEnd },
              },
              _count: { id: true },
            })
          : [];

      // Daily usage for today
      const dailyUsages =
        senderIds.length > 0
          ? await prisma.linkedInDailyUsage.findMany({
              where: {
                senderId: { in: senderIds },
                date: todayStart,
              },
            })
          : [];

      // Recent errors (last 24h, failed actions)
      const recentErrors =
        senderIds.length > 0
          ? await prisma.linkedInAction.findMany({
              where: {
                senderId: { in: senderIds },
                status: "failed",
                completedAt: { gte: last24h },
                result: { not: null },
              },
              select: { senderId: true, result: true },
              orderBy: { completedAt: "desc" },
              take: 50, // fetch a batch, then dedupe per sender
            })
          : [];

      // Build per-sender LinkedIn data
      const senderData = linkedinSenders.map((sender) => {
        // Action counts
        const actionCounts: Record<string, number> = {
          pending: 0,
          running: 0,
          completed: 0,
          failed: 0,
        };
        for (const row of todayActions) {
          if (row.senderId === sender.id && row.status in actionCounts) {
            actionCounts[row.status] = row._count.id;
          }
        }

        // Daily usage
        const usage = dailyUsages.find((u) => u.senderId === sender.id);

        // Recent unique errors (last 3)
        const senderErrors = recentErrors
          .filter((e) => e.senderId === sender.id)
          .map((e) => {
            try {
              const parsed = JSON.parse(e.result!);
              return parsed.error || parsed.message || e.result;
            } catch {
              return e.result;
            }
          });
        const uniqueErrors = [...new Set(senderErrors)].slice(0, 3);

        return {
          id: sender.id,
          name: sender.name,
          status: sender.status,
          healthStatus: sender.healthStatus,
          sessionStatus: sender.sessionStatus,
          lastPolledAt: sender.lastPolledAt?.toISOString() ?? null,
          warmupDay: sender.warmupDay,
          todayActions: {
            pending: actionCounts.pending,
            running: actionCounts.running,
            completed: actionCounts.completed,
            failed: actionCounts.failed,
          },
          dailyUsage: {
            connectionsSent: usage?.connectionsSent ?? 0,
            dailyConnectionLimit: sender.dailyConnectionLimit,
            messagesSent: usage?.messagesSent ?? 0,
            dailyMessageLimit: sender.dailyMessageLimit,
            profileViews: usage?.profileViews ?? 0,
            dailyProfileViewLimit: sender.dailyProfileViewLimit,
          },
          recentErrors: uniqueErrors,
        };
      });

      // --- Email senders ---
      const emailSenders = await prisma.sender.findMany({
        where: { workspaceSlug: ws.slug, channel: "email" },
        select: {
          id: true,
          name: true,
          emailAddress: true,
          status: true,
        },
      });

      const connectedInboxes = emailSenders.filter(
        (s) => s.status === "active",
      );
      const disconnectedInboxes = emailSenders
        .filter((s) => s.status !== "active")
        .map((s) => ({
          name: s.name,
          email: s.emailAddress,
          status: s.status,
        }));

      // --- Active email campaigns ---
      const activeCampaigns = await prisma.campaign.count({
        where: {
          workspaceSlug: ws.slug,
          status: "active",
          channels: { contains: "email" },
        },
      });

      // NOTE: "campaigns with no sends today" requires EmailBison campaign-level
      // send stats which are not stored locally per-day. Skipping for now.

      // --- Domains ---
      // Extract unique domains from email sender addresses
      const domainSet = new Set<string>();
      for (const s of emailSenders) {
        if (s.emailAddress) {
          const parts = s.emailAddress.split("@");
          if (parts.length === 2) domainSet.add(parts[1].toLowerCase());
        }
      }

      const domains = domainSet.size > 0
        ? await prisma.domainHealth.findMany({
            where: { domain: { in: [...domainSet] } },
            select: {
              domain: true,
              blacklistSeverity: true,
              overallHealth: true,
            },
          })
        : [];

      // Fill in any domains not yet in DomainHealth
      const foundDomains = new Set(domains.map((d) => d.domain));
      const domainData = [
        ...domains.map((d) => ({
          domain: d.domain,
          blacklisted:
            d.blacklistSeverity === "warning" ||
            d.blacklistSeverity === "critical",
          overallHealth: d.overallHealth,
        })),
        ...[...domainSet]
          .filter((d) => !foundDomains.has(d))
          .map((d) => ({
            domain: d,
            blacklisted: false,
            overallHealth: "unknown" as const,
          })),
      ];

      return {
        slug: ws.slug,
        name: ws.name,
        status: ws.status,
        linkedin: {
          senders: senderData,
        },
        email: {
          totalInboxes: emailSenders.length,
          connectedInboxes: connectedInboxes.length,
          disconnectedInboxes,
          activeCampaigns,
          campaignsWithNoSendsToday: [] as string[], // See NOTE above — requires EmailBison stats
        },
        domains: domainData,
      };
    }),
  );

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    workspaces: workspaceResults,
  });
}
