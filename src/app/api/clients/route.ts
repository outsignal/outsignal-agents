import { NextRequest, NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/clients/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createClientSchema } from "@/lib/validations/clients";

// GET /api/clients?pipelineStatus=closed_won&search=&hasWorkspace=true&isPipeline=false
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const filters = {
    pipelineStatus: params.get("pipelineStatus") || undefined,
    search: params.get("search") || undefined,
    hasWorkspace:
      params.get("hasWorkspace") === "true"
        ? true
        : params.get("hasWorkspace") === "false"
          ? false
          : undefined,
    isPipeline:
      params.get("isPipeline") === "true"
        ? true
        : params.get("isPipeline") === "false"
          ? false
          : undefined,
  };
  const clients = await listClients(filters);
  return NextResponse.json({ clients });
}

// POST /api/clients — body: { name, contactEmail?, ... }
export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = createClientSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const client = await createClient(result.data);
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/clients]", err);
    return NextResponse.json(
      { error: "Failed to create client" },
      { status: 500 },
    );
  }
}
