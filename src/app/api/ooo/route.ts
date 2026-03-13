import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// ---------------------------------------------------------------------------
// GET /api/ooo
// Returns all OOO re-engagement records plus summary stats.
// Query params:
//   workspaceSlug — filter by workspace (default "all")
//   status        — filter by status (default "all")
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const workspaceSlug = searchParams.get("workspaceSlug") ?? "all";
  const statusFilter = searchParams.get("status") ?? "all";

  try {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Build where clause for list query
    const where: Record<string, unknown> = {};
    if (workspaceSlug !== "all") {
      where.workspaceSlug = workspaceSlug;
    }
    if (statusFilter !== "all") {
      where.status = statusFilter;
    }

    // Fetch records ordered by return date (soonest first)
    const records = await prisma.oooReengagement.findMany({
      where,
      orderBy: { oooUntil: "asc" },
    });

    // Enrich records with person name where available
    const emails = [...new Set(records.map((r) => r.personEmail))];
    const people = await prisma.person.findMany({
      where: { email: { in: emails } },
      select: { email: true, firstName: true, lastName: true },
    });
    const personMap = new Map(people.map((p) => [p.email, p]));

    const enriched = records.map((r) => {
      const person = personMap.get(r.personEmail);
      const name =
        person
          ? [person.firstName, person.lastName].filter(Boolean).join(" ") || null
          : null;
      return { ...r, personName: name };
    });

    // Compute summary stats (always scoped to workspaceSlug filter if set)
    const statsWhere = workspaceSlug !== "all" ? { workspaceSlug } : {};

    const [totalOoo, returningThisWeek, reengaged, failed] = await Promise.all([
      prisma.oooReengagement.count({
        where: { ...statsWhere, status: "pending" },
      }),
      prisma.oooReengagement.count({
        where: {
          ...statsWhere,
          status: "pending",
          oooUntil: { gte: now, lte: nextWeek },
        },
      }),
      prisma.oooReengagement.count({
        where: { ...statsWhere, status: "sent" },
      }),
      prisma.oooReengagement.count({
        where: { ...statsWhere, status: "failed" },
      }),
    ]);

    return NextResponse.json({
      records: enriched,
      summary: { totalOoo, returningThisWeek, reengaged, failed },
    });
  } catch (err) {
    console.error("[GET /api/ooo]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
