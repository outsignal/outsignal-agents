import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createListSchema } from "@/lib/validations/lists";

export async function GET(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";
    const workspace = searchParams.get("workspace")?.trim() || "";

    const where: Record<string, unknown> = {};

    if (q) {
      where.name = { contains: q, mode: "insensitive" };
    }

    if (workspace) {
      where.workspaceSlug = workspace;
    }

    const lists = await prisma.targetList.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { people: true } },
        people: {
          select: {
            person: {
              select: {
                email: true,
                linkedinUrl: true,
                companyDomain: true,
              },
            },
          },
        },
      },
    });

    const result = lists.map((list) => {
      const people = list.people;
      const withEmail = people.filter((p) => !!p.person.email).length;
      const withLinkedin = people.filter((p) => !!p.person.linkedinUrl).length;
      const withCompany = people.filter((p) => !!p.person.companyDomain).length;

      return {
        id: list.id,
        name: list.name,
        workspaceSlug: list.workspaceSlug,
        description: list.description,
        createdAt: list.createdAt.toISOString(),
        peopleCount: list._count.people,
        enrichment: {
          withEmail,
          withLinkedin,
          withCompany,
        },
      };
    });

    return NextResponse.json({ lists: result });
  } catch (err) {
    console.error("[GET /api/lists] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch lists" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = createListSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const { name, workspaceSlug, description } = result.data;

    const list = await prisma.targetList.create({
      data: {
        name: name.trim(),
        workspaceSlug: workspaceSlug.trim(),
        description: description?.trim() ?? null,
      },
    });

    return NextResponse.json(
      {
        list: {
          id: list.id,
          name: list.name,
          workspaceSlug: list.workspaceSlug,
          description: list.description,
          createdAt: list.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/lists] Error:", err);
    return NextResponse.json(
      { error: "Failed to create list" },
      { status: 500 }
    );
  }
}
