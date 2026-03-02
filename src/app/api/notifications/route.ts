import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const severity = url.searchParams.get("severity");
  const workspace = url.searchParams.get("workspace");
  const page = parseInt(url.searchParams.get("page") ?? "1");
  const limit = 50;

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (severity) where.severity = severity;
  if (workspace) where.workspaceSlug = workspace;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return NextResponse.json({ notifications, total, page, limit });
}

// Mark notifications as read
export async function PATCH(request: NextRequest) {
  const body = await request.json();

  if (body.markAllRead) {
    await prisma.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.ids && Array.isArray(body.ids)) {
    await prisma.notification.updateMany({
      where: { id: { in: body.ids } },
      data: { read: true },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}
