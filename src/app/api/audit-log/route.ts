import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

/**
 * GET /api/audit-log?page=1&limit=50
 *
 * Returns paginated audit log entries, newest first.
 * Admin-only. Supports optional filters via query params:
 *   - entityType: filter by entity type (e.g. "Campaign", "Sender")
 *   - adminEmail: filter by admin email
 */
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
    const entityType = searchParams.get("entityType");
    const adminEmail = searchParams.get("adminEmail");

    const where: Record<string, string> = {};
    if (entityType) where.entityType = entityType;
    if (adminEmail) where.adminEmail = adminEmail;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[GET /api/audit-log] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit logs" },
      { status: 500 },
    );
  }
}
