import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { checkAllProviderBalances } from "@/lib/credits/provider-balances";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // --- Auth (same pattern as /api/health/radar) ---
  const secret =
    process.env.INGEST_WEBHOOK_SECRET ?? process.env.CLAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook authentication not configured" },
      { status: 401 },
    );
  }

  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  const apiKeyBuf = Buffer.from(apiKey);
  const secretBuf = Buffer.from(secret);
  if (
    apiKeyBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(apiKeyBuf, secretBuf)
  ) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }

  // --- Check all provider balances ---
  const balances = await checkAllProviderBalances();

  const hasWarning = balances.some((b) => b.status === "warning");
  const hasCritical = balances.some((b) => b.status === "critical");

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    overallStatus: hasCritical ? "critical" : hasWarning ? "warning" : "healthy",
    providers: balances,
  });
}
