import { NextResponse } from "next/server";
import { getSenderBudget } from "@/lib/linkedin/rate-limiter";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const budget = await getSenderBudget(id);

  if (!budget) {
    return NextResponse.json({ error: "Sender not found" }, { status: 404 });
  }

  return NextResponse.json(budget);
}
