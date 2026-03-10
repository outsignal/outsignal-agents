import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { generateInsights } from "@/lib/insights/generate";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = new URL(request.url).searchParams.get("workspace");

  try {
    if (workspace) {
      // Single workspace mode (recommended: one cron-job.org entry per workspace)
      const count = await generateInsights(workspace);
      return NextResponse.json({
        ok: true,
        workspace,
        insightsGenerated: count,
        timestamp: new Date().toISOString(),
      });
    }

    // All workspaces mode (iterate sequentially)
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true },
    });

    const results: Array<{
      workspace: string;
      insightsGenerated: number;
      error?: string;
    }> = [];

    for (const ws of workspaces) {
      try {
        const count = await generateInsights(ws.slug);
        results.push({ workspace: ws.slug, insightsGenerated: count });
      } catch (err) {
        results.push({
          workspace: ws.slug,
          insightsGenerated: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const totalInsights = results.reduce(
      (s, r) => s + r.insightsGenerated,
      0,
    );
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      workspacesProcessed: workspaces.length,
      totalInsightsGenerated: totalInsights,
      results,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[generate-insights] Unhandled error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
