import { NextRequest, NextResponse } from "next/server";
import {
  getClient,
  updateClient,
  deleteClient,
} from "@/lib/clients/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateClientSchema } from "@/lib/validations/clients";
import { auditLog } from "@/lib/audit";

// GET /api/clients/[id] — client detail with tasks
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const client = await getClient(id);

    if (!client) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ client });
  } catch (err) {
    console.error("[GET /api/clients/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch client" },
      { status: 500 },
    );
  }
}

// PATCH /api/clients/[id] — update client fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const result = updateClientSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }

    // Convert null values to undefined (Zod nullable() produces null, operations expect undefined)
    const cleaned = Object.fromEntries(
      Object.entries(result.data).map(([k, v]) => [k, v === null ? undefined : v])
    );
    const client = await updateClient(id, cleaned);

    return NextResponse.json({ client });
  } catch (err) {
    console.error("[PATCH /api/clients/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to update client" },
      { status: 500 },
    );
  }
}

// DELETE /api/clients/[id] — delete client
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    await deleteClient(id);

    auditLog({
      action: "client.delete",
      entityType: "Client",
      entityId: id,
      adminEmail: session.email,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/clients/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to delete client" },
      { status: 500 },
    );
  }
}
