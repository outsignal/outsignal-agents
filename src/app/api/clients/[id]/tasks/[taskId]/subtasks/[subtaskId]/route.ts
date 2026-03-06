import { NextRequest, NextResponse } from "next/server";
import { updateSubtaskStatus } from "@/lib/clients/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateSubtaskSchema } from "@/lib/validations/clients";

// PATCH /api/clients/[id]/tasks/[taskId]/subtasks/[subtaskId] — update subtask status
// Body: { status: "todo" | "in_progress" | "complete" }
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; taskId: string; subtaskId: string }>;
  },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { subtaskId } = await params;
    const body = await request.json();
    const result = updateSubtaskSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }

    const subtask = await updateSubtaskStatus(subtaskId, result.data.status);

    return NextResponse.json({ subtask });
  } catch (err) {
    console.error(
      "[PATCH /api/clients/[id]/tasks/[taskId]/subtasks/[subtaskId]] Error:",
      err,
    );
    return NextResponse.json(
      { error: "Failed to update subtask" },
      { status: 500 },
    );
  }
}
