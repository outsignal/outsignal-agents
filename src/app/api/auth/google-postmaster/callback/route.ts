/**
 * Google Postmaster OAuth callback.
 * GET /api/auth/google-postmaster/callback?code=XXX
 * Exchanges the authorization code for tokens and stores them.
 */

import { NextResponse } from "next/server";
import { handleCallback } from "@/lib/postmaster/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("[postmaster-oauth] OAuth error:", error);
    return NextResponse.redirect(
      new URL(`/domain-health?error=postmaster_oauth_${error}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/domain-health?error=postmaster_no_code", request.url)
    );
  }

  try {
    await handleCallback(code);
    return NextResponse.redirect(
      new URL("/domain-health?success=postmaster_connected", request.url)
    );
  } catch (err) {
    console.error("[postmaster-oauth] Callback failed:", err);
    return NextResponse.redirect(
      new URL("/domain-health?error=postmaster_callback_failed", request.url)
    );
  }
}
