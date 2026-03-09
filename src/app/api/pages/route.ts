import { NextRequest, NextResponse } from "next/server";
import { listPages, createPage } from "@/lib/pages/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const filters = {
    clientId: params.get("clientId") || undefined,
    search: params.get("search") || undefined,
  };
  const pages = await listPages(filters);
  return NextResponse.json({ pages });
}

export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    if (!body.title?.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 },
      );
    }
    const page = await createPage(body);
    return NextResponse.json({ page }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/pages]", err);
    return NextResponse.json(
      { error: "Failed to create page" },
      { status: 500 },
    );
  }
}
