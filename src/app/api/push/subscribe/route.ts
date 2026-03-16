import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { getPortalSession } from "@/lib/portal-session";

export async function POST(req: NextRequest) {
  try {
    // Determine user type
    let userType: string;
    let userId: string;

    const adminSession = await requireAdminAuth();
    if (adminSession) {
      userType = "admin";
      userId = adminSession.email;
    } else {
      try {
        const portalSession = await getPortalSession();
        userType = "portal";
        userId = `${portalSession.workspaceSlug}:${portalSession.email}`;
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const { endpoint, keys } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { error: "Missing required fields: endpoint, keys.p256dh, keys.auth" },
        { status: 400 }
      );
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userType,
        userId,
      },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userType,
        userId,
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[push/subscribe] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
