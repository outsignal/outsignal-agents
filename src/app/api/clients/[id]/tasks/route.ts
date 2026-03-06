import { NextRequest, NextResponse } from "next/server";
import { addTask } from "@/lib/clients/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { addTaskSchema } from "@/lib/validations/clients";

// POST /api/clients/[id]/tasks — add a new task
// Body: { stage, title, dueDate? }
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
    const body = await request.json();
    const result = addTaskSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }

    const { dueDate, ...rest } = result.data;
    const task = await addTask(id, {
      ...rest,
      ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/clients/[id]/tasks] Error:", err);
    return NextResponse.json(
      { error: "Failed to add task" },
      { status: 500 },
    );
  }
}
