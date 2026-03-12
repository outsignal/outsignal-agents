import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// ---------------------------------------------------------------------------
// Trigger.dev REST API proxy
// ---------------------------------------------------------------------------

const TRIGGER_API_BASE = "https://api.trigger.dev/api/v1";

async function triggerFetch(path: string) {
  const res = await fetch(`${TRIGGER_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.TRIGGER_SECRET_KEY}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Trigger.dev API ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TriggerRun {
  id: string;
  taskIdentifier: string;
  status: string;
  tags?: string[];
  durationMs?: number | null;
  createdAt: string;
  finishedAt?: string | null;
  error?: { message?: string; name?: string } | null;
}

interface TriggerSchedule {
  id: string;
  task: string;
  active: boolean;
  generator?: { expression?: string };
  nextRun?: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/background-tasks
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const period = searchParams.get("period") ?? "1d";
  const workspace = searchParams.get("workspace") ?? "";

  try {
    // Build runs URL
    let runsUrl = `/runs?filter[createdAt][period]=${period}&page[size]=100`;
    if (workspace) {
      runsUrl += `&filter[tag]=${encodeURIComponent(workspace)}`;
    }

    // Fetch runs and schedules in parallel
    const [runsData, schedulesData] = await Promise.all([
      triggerFetch(runsUrl) as Promise<{ data: TriggerRun[] }>,
      triggerFetch("/schedules") as Promise<{ data: TriggerSchedule[] }>,
    ]);

    const runs: TriggerRun[] = runsData?.data ?? [];
    const schedules: TriggerSchedule[] = schedulesData?.data ?? [];

    // Compute summary
    const total = runs.length;
    const succeeded = runs.filter((r) => r.status === "COMPLETED").length;
    const failed = runs.filter((r) =>
      ["FAILED", "CRASHED", "SYSTEM_FAILURE"].includes(r.status),
    ).length;
    const running = runs.filter((r) =>
      ["EXECUTING", "REATTEMPTING", "QUEUED"].includes(r.status),
    ).length;
    const activeSchedules = schedules.filter((s) => s.active).length;

    return NextResponse.json({
      summary: { total, succeeded, failed, running, activeSchedules },
      runs: runs.slice(0, 50),
      schedules: schedules.filter((s) => s.active),
    });
  } catch (err) {
    console.error("[background-tasks]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
