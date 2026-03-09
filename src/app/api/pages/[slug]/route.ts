import { NextRequest, NextResponse } from "next/server";
import { getPage, updatePage, deletePage } from "@/lib/pages/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;
  const page = await getPage(slug);
  if (!page)
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  return NextResponse.json({ page });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;
  try {
    const body = await request.json();
    const page = await updatePage(slug, body);
    return NextResponse.json({ page });
  } catch (err) {
    console.error("[PATCH /api/pages]", err);
    return NextResponse.json(
      { error: "Failed to update page" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { slug } = await params;
  try {
    await deletePage(slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/pages]", err);
    return NextResponse.json(
      { error: "Failed to delete page" },
      { status: 500 },
    );
  }
}
