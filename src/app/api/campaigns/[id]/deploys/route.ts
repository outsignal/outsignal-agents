import { NextResponse } from "next/server";
import { getDeployHistory } from "@/lib/campaigns/deploy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deploys = await getDeployHistory(id);
  return NextResponse.json({ deploys });
}
