import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 50;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

    const [list, paginatedPeople, total, allMembersForSummary] =
      await Promise.all([
        prisma.targetList.findUnique({
          where: { id },
        }),
        prisma.targetListPerson.findMany({
          where: { listId: id },
          include: {
            person: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                company: true,
                jobTitle: true,
                vertical: true,
                linkedinUrl: true,
                companyDomain: true,
              },
            },
          },
          orderBy: { addedAt: "desc" },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        prisma.targetListPerson.count({ where: { listId: id } }),
        prisma.targetListPerson.findMany({
          where: { listId: id },
          select: {
            person: {
              select: {
                email: true,
                linkedinUrl: true,
                companyDomain: true,
              },
            },
          },
        }),
      ]);

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const withEmail = allMembersForSummary.filter((m) => !!m.person.email).length;
    const withLinkedin = allMembersForSummary.filter((m) => !!m.person.linkedinUrl).length;
    const withCompany = allMembersForSummary.filter((m) => !!m.person.companyDomain).length;

    const people = paginatedPeople.map((tlp) => ({
      id: tlp.id,
      personId: tlp.personId,
      addedAt: tlp.addedAt.toISOString(),
      person: tlp.person,
    }));

    return NextResponse.json({
      list: {
        id: list.id,
        name: list.name,
        workspaceSlug: list.workspaceSlug,
        description: list.description,
        createdAt: list.createdAt.toISOString(),
        updatedAt: list.updatedAt.toISOString(),
      },
      people,
      total,
      page,
      pageSize: PAGE_SIZE,
      summary: {
        total,
        withEmail,
        withLinkedin,
        withCompany,
      },
    });
  } catch (err) {
    console.error("[GET /api/lists/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch list" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const list = await prisma.targetList.findUnique({ where: { id } });
    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    await prisma.targetList.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/lists/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to delete list" },
      { status: 500 }
    );
  }
}
