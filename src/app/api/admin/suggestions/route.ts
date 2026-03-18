import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

// GET /api/admin/suggestions — list AI suggestions with filtering & pagination
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get("workspace");
    const feedback = searchParams.get("feedback") ?? "all";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const perPage = 20;

    // Build where clause
    const where: Record<string, unknown> = {
      aiSuggestedReply: { not: null },
    };

    if (workspace) {
      where.workspaceSlug = workspace;
    }

    if (feedback === "unrated") {
      where.suggestionFeedback = null;
    } else if (feedback === "good" || feedback === "bad" || feedback === "needs_work") {
      where.suggestionFeedback = feedback;
    }

    // Get total count and paginated results in parallel
    const [total, suggestions, stats] = await Promise.all([
      prisma.reply.count({ where }),
      prisma.reply.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          workspaceSlug: true,
          senderEmail: true,
          senderName: true,
          subject: true,
          bodyText: true,
          aiSuggestedReply: true,
          suggestionFeedback: true,
          suggestionFeedbackAt: true,
          createdAt: true,
          person: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      // Stats across all suggestions (ignoring current filters except workspace)
      (async () => {
        const statsWhere: Record<string, unknown> = {
          aiSuggestedReply: { not: null },
        };
        if (workspace) {
          statsWhere.workspaceSlug = workspace;
        }

        const [totalAll, good, bad, needsWork, unrated] = await Promise.all([
          prisma.reply.count({ where: statsWhere }),
          prisma.reply.count({ where: { ...statsWhere, suggestionFeedback: "good" } }),
          prisma.reply.count({ where: { ...statsWhere, suggestionFeedback: "bad" } }),
          prisma.reply.count({ where: { ...statsWhere, suggestionFeedback: "needs_work" } }),
          prisma.reply.count({ where: { ...statsWhere, suggestionFeedback: null } }),
        ]);

        return { total: totalAll, good, bad, needsWork, unrated };
      })(),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    return NextResponse.json({
      suggestions,
      pagination: { page, totalPages, total },
      stats,
    });
  } catch (err) {
    console.error("[GET /api/admin/suggestions] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch suggestions" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/suggestions — rate a suggestion
export async function PATCH(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { replyId, feedback } = body as {
      replyId: string;
      feedback: "good" | "bad" | "needs_work";
    };

    if (!replyId || !["good", "bad", "needs_work"].includes(feedback)) {
      return NextResponse.json(
        { error: "Invalid replyId or feedback value" },
        { status: 400 }
      );
    }

    await prisma.reply.update({
      where: { id: replyId },
      data: {
        suggestionFeedback: feedback,
        suggestionFeedbackAt: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/admin/suggestions] Error:", err);
    return NextResponse.json(
      { error: "Failed to update feedback" },
      { status: 500 }
    );
  }
}
