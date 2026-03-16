import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { getPortalSession } from "@/lib/portal-session";

export async function POST(req: NextRequest) {
  try {
    // Verify authentication (admin or portal)
    const adminSession = await requireAdminAuth();
    if (!adminSession) {
      try {
        await getPortalSession();
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const { endpoint } = body;

    if (!endpoint) {
      return NextResponse.json(
        { error: "Missing required field: endpoint" },
        { status: 400 }
      );
    }

    await prisma.pushSubscription.deleteMany({
      where: { endpoint },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[push/unsubscribe] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
