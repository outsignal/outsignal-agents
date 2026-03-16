import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const articles = await prisma.faqArticle.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });

    return NextResponse.json({ articles });
  } catch (error) {
    console.error("Failed to list FAQ articles:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { question, answer, category, sortOrder, published } =
      await request.json();

    const article = await prisma.faqArticle.create({
      data: {
        question,
        answer,
        category,
        sortOrder: sortOrder ?? 0,
        published: published ?? true,
      },
    });

    return NextResponse.json(article, { status: 201 });
  } catch (error) {
    console.error("Failed to create FAQ article:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
