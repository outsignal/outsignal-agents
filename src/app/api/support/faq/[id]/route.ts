import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { question, answer, category, sortOrder, published } =
      await request.json();

    const data: Record<string, unknown> = {};
    if (question !== undefined) data.question = question;
    if (answer !== undefined) data.answer = answer;
    if (category !== undefined) data.category = category;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (published !== undefined) data.published = published;

    const article = await prisma.faqArticle.update({
      where: { id },
      data,
    });

    return NextResponse.json(article);
  } catch (error) {
    console.error("Failed to update FAQ article:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await prisma.faqArticle.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete FAQ article:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
