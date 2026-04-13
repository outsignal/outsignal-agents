import { NextRequest, NextResponse } from "next/server";
import { populateClientTasks, getClient } from "@/lib/clients/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { populateClientTasksSchema } from "@/lib/validations/clients";
import type { TemplateType } from "@/lib/clients/task-templates";

// POST /api/clients/[id]/populate — populate tasks from template
// Body: { templateType?: "email" | "email_linkedin" | "linkedin" | "consultancy" }
// If no templateType provided, uses client's campaignType
export async function POST(
  request: NextRequest,
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

    // Check if client already has tasks
    if (client.tasks && client.tasks.length > 0) {
      return NextResponse.json(
        { error: "Client already has tasks. Delete existing tasks first." },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const result = populateClientTasksSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const templateType = result.data.templateType || (client.campaignType as TemplateType) || "email";

    await populateClientTasks(id, templateType);

    // Re-fetch the client to get the populated tasks
    const updated = await getClient(id);

    return NextResponse.json({ tasks: updated?.tasks ?? [] }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/clients/[id]/populate] Error:", err);
    return NextResponse.json(
      { error: "Failed to populate tasks" },
      { status: 500 },
    );
  }
}
