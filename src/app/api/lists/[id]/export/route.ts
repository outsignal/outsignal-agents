/**
 * GET /api/lists/[id]/export
 *
 * Returns a downloadable CSV file of all exportable members in a TargetList.
 * Enforces the verification gate: responds with 400 if any member has an
 * unverified email. Invalid/blocked emails are automatically excluded.
 *
 * Response headers:
 * - Content-Type: text/csv; charset=utf-8
 * - Content-Disposition: attachment; filename="{listName}_{date}.csv"
 */

import { generateListCsv } from "@/lib/export/csv";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const { csv, filename, count } = await generateListCsv(id);

    console.log(`[GET /api/lists/${id}/export] Exported ${count} people as ${filename}`);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Count": String(count),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Verification gate block → 400
    if (message.includes("Export blocked")) {
      return Response.json({ error: message }, { status: 400 });
    }

    console.error("[GET /api/lists/[id]/export] Unexpected error:", err);
    return Response.json({ error: "Failed to generate CSV export" }, { status: 500 });
  }
}
