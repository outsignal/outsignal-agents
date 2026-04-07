import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/linkedin/connections/person/[personId]/status
 * Returns the most recent LinkedInConnection status for a person.
 * Used by the worker as a pre-send gate before executing message actions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> },
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { personId } = await params;

    const connection = await prisma.linkedInConnection.findFirst({
      where: { personId },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    });

    if (!connection) {
      return NextResponse.json({ status: null });
    }

    return NextResponse.json({ status: connection.status });
  } catch (error) {
    console.error("[connections/person/status] Error:", error);
    return NextResponse.json(
      { error: "Failed to check connection status" },
      { status: 500 },
    );
  }
}
