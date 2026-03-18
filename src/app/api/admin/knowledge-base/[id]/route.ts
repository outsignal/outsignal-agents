import { NextResponse } from "next/server";
import { deleteDocument } from "@/lib/knowledge/store";
import { requireAdminAuth } from "@/lib/require-admin-auth";

/**
 * DELETE /api/admin/knowledge-base/[id]
 * Delete a knowledge base document and all its chunks (cascade).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteDocument(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[knowledge-base DELETE] Error:", err);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 },
    );
  }
}
