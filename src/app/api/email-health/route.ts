import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SenderHealthRow {
  email: string;
  name: string | undefined;
  workspaceName: string;
  workspaceSlug: string;
  status: string;
  emailsSent: number;
  bounced: number;
  bounceRate: number;
  replies: number;
  replyRate: number;
  healthStatus: "healthy" | "warning" | "critical";
}

function computeHealth(
  sender: SenderEmail,
  workspaceName: string,
  workspaceSlug: string,
): SenderHealthRow {
  const sent = sender.emails_sent_count;
  const bounced = sender.bounced_count;
  const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
  const replyRate = sent > 0 ? (sender.unique_replied_count / sent) * 100 : 0;

  let healthStatus: "healthy" | "warning" | "critical" = "healthy";
  if (sender.status === "Not connected") healthStatus = "critical";
  else if (bounceRate > 5) healthStatus = "critical";
  else if (bounceRate > 2) healthStatus = "warning";

  return {
    email: sender.email,
    name: sender.name,
    workspaceName,
    workspaceSlug,
    status: sender.status ?? "Unknown",
    emailsSent: sent,
    bounced,
    bounceRate,
    replies: sender.unique_replied_count,
    replyRate,
    healthStatus,
  };
}

// GET /api/email-health?workspace=slug&page=1
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaceFilter = request.nextUrl.searchParams.get("workspace") || undefined;
    const pageParam = request.nextUrl.searchParams.get("page") || "1";
    const currentPage = Math.max(1, parseInt(pageParam));
    const PAGE_SIZE = 50;

    const allWorkspaces = await getAllWorkspaces();
    const allActiveWorkspaces = allWorkspaces.filter((ws) => ws.hasApiToken);
    const activeWorkspaces = workspaceFilter
      ? allActiveWorkspaces.filter((ws) => ws.slug === workspaceFilter)
      : allActiveWorkspaces;

    const allSenders: SenderHealthRow[] = [];
    const failedWorkspaces: string[] = [];

    const results = await Promise.allSettled(
      activeWorkspaces.map(async (ws) => {
        const config = await getWorkspaceBySlug(ws.slug);
        if (!config) return { slug: ws.slug, name: ws.name, senders: [] as SenderEmail[] };
        const client = new EmailBisonClient(config.apiToken);
        const senders = await client.getSenderEmails();
        return { slug: ws.slug, name: ws.name, senders };
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        const { slug, name, senders } = result.value;
        for (const sender of senders) {
          allSenders.push(computeHealth(sender, name, slug));
        }
      } else {
        failedWorkspaces.push(activeWorkspaces[i].name);
      }
    }

    // Sort worst-first
    const sortOrder = { critical: 0, warning: 1, healthy: 2 };
    allSenders.sort((a, b) => {
      const orderDiff = sortOrder[a.healthStatus] - sortOrder[b.healthStatus];
      if (orderDiff !== 0) return orderDiff;
      return b.bounceRate - a.bounceRate;
    });

    // Compute aggregates
    const totalSenders = allSenders.length;
    const disconnected = allSenders.filter((s) => s.status === "Not connected");
    const connected = totalSenders - disconnected.length;
    const totalSent = allSenders.reduce((sum, s) => sum + s.emailsSent, 0);
    const totalBounced = allSenders.reduce((sum, s) => sum + s.bounced, 0);
    const totalReplies = allSenders.reduce((sum, s) => sum + s.replies, 0);
    const avgBounceRate = totalSent > 0 ? (totalBounced / totalSent) * 100 : 0;
    const avgReplyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
    const highBounce = allSenders.filter((s) => s.bounceRate > 5 && s.status !== "Not connected");

    // Pagination
    const totalPages = Math.ceil(totalSenders / PAGE_SIZE);
    const paginatedSenders = allSenders.slice(
      (currentPage - 1) * PAGE_SIZE,
      currentPage * PAGE_SIZE,
    );

    return NextResponse.json({
      senders: paginatedSenders,
      workspaces: allActiveWorkspaces.map((ws) => ({ slug: ws.slug, name: ws.name })),
      failedWorkspaces,
      aggregates: {
        totalSenders,
        connected,
        disconnectedCount: disconnected.length,
        totalSent,
        totalBounced,
        totalReplies,
        avgBounceRate,
        avgReplyRate,
        highBounceCount: highBounce.length,
        activeWorkspaceCount: activeWorkspaces.length,
      },
      pagination: {
        currentPage,
        totalPages,
        pageSize: PAGE_SIZE,
      },
    });
  } catch (err) {
    console.error("[email-health] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch email health data" },
      { status: 500 },
    );
  }
}
