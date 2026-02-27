import { NextRequest, NextResponse } from "next/server";
import {
  validateAdminPassword,
  createAdminSessionCookie,
  AdminSession,
} from "@/lib/admin-auth";

/**
 * POST /api/admin/login
 *
 * Accept { password }, validate against ADMIN_PASSWORD env var,
 * and set a signed admin session cookie.
 */
export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string };

  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: "Password is required" },
      { status: 400 },
    );
  }

  if (!validateAdminPassword(password)) {
    return NextResponse.json(
      { error: "Invalid password" },
      { status: 401 },
    );
  }

  const session: AdminSession = {
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
  };

  const cookie = createAdminSessionCookie(session);

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", cookie);
  return response;
}
