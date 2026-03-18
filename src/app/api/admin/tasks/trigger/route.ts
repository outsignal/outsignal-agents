import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// ---------------------------------------------------------------------------
// Allowed task IDs (must match deployed Trigger.dev task identifiers)
// ---------------------------------------------------------------------------

const ALLOWED_TASK_IDS = new Set([
  "bounce-monitor",
  "campaign-deploy",
  "deliverability-digest",
  "domain-health",
  "generate-suggestion",
  "generate-insights",
  "inbox-check",
  "invoice-processor",
  "linkedin-fast-track",
  "ooo-reengage",
  "poll-replies",
  "postmaster-stats-sync",
  "process-reply",
  "retry-classification",
  "smoke-test",
  "sync-senders",
]);

// ---------------------------------------------------------------------------
// POST /api/admin/tasks/trigger
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { taskId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId } = body;

  if (!taskId || !ALLOWED_TASK_IDS.has(taskId)) {
    return NextResponse.json(
      { error: `Invalid taskId. Allowed: ${[...ALLOWED_TASK_IDS].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payload: {} }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[tasks/trigger] Trigger.dev API ${res.status}:`, text);
      return NextResponse.json(
        { error: `Trigger.dev API error (${res.status})` },
        { status: 500 },
      );
    }

    const data = await res.json();
    return NextResponse.json({ success: true, runId: data.id });
  } catch (err) {
    console.error("[tasks/trigger] Failed to trigger task:", err);
    return NextResponse.json(
      { error: "Failed to trigger task" },
      { status: 500 },
    );
  }
}
