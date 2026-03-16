import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal-session";
import { searchKnowledge } from "@/lib/knowledge/store";

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const q = request.nextUrl.searchParams.get("q")?.trim();

    if (!q) {
      return NextResponse.json({ faq: [], kb: [] });
    }

    const [faq, kb] = await Promise.all([
      prisma.faqArticle.findMany({
        where: {
          published: true,
          OR: [
            { question: { contains: q, mode: "insensitive" } },
            { answer: { contains: q, mode: "insensitive" } },
          ],
        },
      }),
      searchKnowledge(q, { limit: 5 }),
    ]);

    return NextResponse.json({ faq, kb });
  } catch (error) {
    console.error("Failed to search FAQ/KB:", error);
    return NextResponse.json(
      { error: "Failed to search" },
      { status: 500 },
    );
  }
}
