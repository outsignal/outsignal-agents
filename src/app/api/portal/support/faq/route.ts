import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal-session";

export async function GET() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const articles = await prisma.faqArticle.findMany({
      where: { published: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });

    const categoryMap = new Map<string, typeof articles>();

    for (const article of articles) {
      const cat = article.category ?? "General";
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, []);
      }
      categoryMap.get(cat)!.push(article);
    }

    const categories = Array.from(categoryMap.entries()).map(
      ([name, items]) => ({
        name,
        articles: items,
      }),
    );

    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Failed to fetch FAQ articles:", error);
    return NextResponse.json(
      { error: "Failed to load FAQ" },
      { status: 500 },
    );
  }
}
