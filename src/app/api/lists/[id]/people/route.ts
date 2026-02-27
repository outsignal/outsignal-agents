import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface SelectAllFilters {
  q?: string;
  vertical?: string[];
  workspace?: string;
  enrichment?: string;
  company?: string;
}

function buildPeopleWhere(filters: SelectAllFilters): Record<string, unknown> {
  const andConditions: Record<string, unknown>[] = [];

  if (filters.q) {
    const q = filters.q.trim();
    if (q) {
      andConditions.push({
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { company: { contains: q, mode: "insensitive" } },
          { jobTitle: { contains: q, mode: "insensitive" } },
        ],
      });
    }
  }

  if (filters.vertical && filters.vertical.length > 0) {
    andConditions.push({ vertical: { in: filters.vertical } });
  }

  if (filters.workspace) {
    andConditions.push({ workspaces: { some: { workspace: filters.workspace } } });
  }

  if (filters.company) {
    andConditions.push({
      company: { contains: filters.company, mode: "insensitive" },
    });
  }

  if (filters.enrichment === "full") {
    andConditions.push({
      AND: [
        { linkedinUrl: { not: null } },
        { companyDomain: { not: null } },
      ],
    });
  } else if (filters.enrichment === "partial") {
    andConditions.push({
      OR: [
        { linkedinUrl: { not: null }, companyDomain: null },
        { linkedinUrl: null, companyDomain: { not: null } },
      ],
    });
  } else if (filters.enrichment === "missing") {
    andConditions.push({ linkedinUrl: null, companyDomain: null });
  }

  return andConditions.length > 0 ? { AND: andConditions } : {};
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Verify list exists
    const list = await prisma.targetList.findUnique({ where: { id } });
    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const body = await request.json();
    let personIds: string[] = [];

    if (body.personIds && Array.isArray(body.personIds)) {
      // Option A: individual selection
      personIds = body.personIds.filter(
        (pid: unknown) => typeof pid === "string"
      );
    } else if (body.selectAllFilters) {
      // Option B: select all matching server-side filter
      const filters = body.selectAllFilters as SelectAllFilters;
      const where = buildPeopleWhere(filters);
      const matchingPeople = await prisma.person.findMany({
        where,
        select: { id: true },
      });
      personIds = matchingPeople.map((p) => p.id);
    } else {
      return NextResponse.json(
        { error: "Must provide personIds or selectAllFilters" },
        { status: 400 }
      );
    }

    if (personIds.length === 0) {
      return NextResponse.json({ added: 0 });
    }

    const result = await prisma.targetListPerson.createMany({
      data: personIds.map((personId) => ({
        listId: id,
        personId,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({ added: result.count });
  } catch (err) {
    console.error("[POST /api/lists/[id]/people] Error:", err);
    return NextResponse.json(
      { error: "Failed to add people to list" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { personId } = body;

    if (!personId || typeof personId !== "string") {
      return NextResponse.json(
        { error: "personId is required" },
        { status: 400 }
      );
    }

    const entry = await prisma.targetListPerson.findUnique({
      where: {
        listId_personId: {
          listId: id,
          personId,
        },
      },
    });

    if (!entry) {
      return NextResponse.json(
        { error: "Person not found in this list" },
        { status: 404 }
      );
    }

    await prisma.targetListPerson.delete({
      where: {
        listId_personId: {
          listId: id,
          personId,
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/lists/[id]/people] Error:", err);
    return NextResponse.json(
      { error: "Failed to remove person from list" },
      { status: 500 }
    );
  }
}
