import { NextRequest, NextResponse } from "next/server";
import { getSenderBudget } from "@/lib/linkedin/rate-limiter";
import { requireAdminAuth } from "@/lib/require-admin-auth";

/**
 * GET /api/senders/budgets?ids=id1,id2,id3
 * Batch-fetch daily limit budgets for multiple senders.
 */
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({ error: "Missing ids parameter" }, { status: 400 });
  }

  const ids = idsParam.split(",").filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ budgets: {} });
  }

  // Cap at 50 to prevent abuse
  const capped = ids.slice(0, 50);

  const results = await Promise.all(
    capped.map(async (id) => {
      const budget = await getSenderBudget(id);
      return [id, budget] as const;
    }),
  );

  const budgets: Record<string, Awaited<ReturnType<typeof getSenderBudget>>> = {};
  for (const [id, budget] of results) {
    budgets[id] = budget;
  }

  return NextResponse.json({ budgets });
}
