import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { iproyal } from "@/lib/iproyal/client";

export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.IPROYAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ connected: false, error: "IPROYAL_API_KEY not configured" });
  }

  try {
    const balance = await iproyal.getBalance();
    return NextResponse.json({ connected: true, balance });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ connected: false, error: message });
  }
}
