import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { enqueueAction } from "@/lib/linkedin/queue";

/**
 * POST /api/linkedin/actions — Enqueue LinkedIn action(s).
 * Body: single action object or array of actions.
 */
export async function POST(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const actions = Array.isArray(body) ? body : [body];

    const ids: string[] = [];
    for (const action of actions) {
      const id = await enqueueAction({
        senderId: action.senderId,
        personId: action.personId,
        workspaceSlug: action.workspaceSlug,
        actionType: action.actionType,
        messageBody: action.messageBody,
        priority: action.priority,
        scheduledFor: action.scheduledFor ? new Date(action.scheduledFor) : undefined,
        campaignName: action.campaignName,
        emailBisonLeadId: action.emailBisonLeadId,
        sequenceStepRef: action.sequenceStepRef,
      });
      ids.push(id);
    }

    return NextResponse.json({ ids });
  } catch (error) {
    console.error("Enqueue action error:", error);
    return NextResponse.json({ error: "Failed to enqueue action" }, { status: 500 });
  }
}
