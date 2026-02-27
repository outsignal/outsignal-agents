import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const q = searchParams.get("q")?.trim() || "";
    const verticals = searchParams.getAll("vertical").filter(Boolean);
    const workspace = searchParams.get("workspace")?.trim() || "";
    const enrichment = searchParams.get("enrichment")?.trim() || "";
    const company = searchParams.get("company")?.trim() || "";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

    // Build AND conditions array — avoids overwriting where.OR (Prisma pitfall)
    const andConditions: Record<string, unknown>[] = [];

    // Free-text search across 5 fields (OR within, case-insensitive)
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

    // Vertical filter — OR within multiple selected verticals
    if (verticals.length > 0) {
      andConditions.push({ vertical: { in: verticals } });
    }

    // Workspace filter — join through PersonWorkspace
    if (workspace) {
      andConditions.push({ workspaces: { some: { workspace } } });
    }

    // Company sub-filter (contains, case-insensitive)
    if (company) {
      andConditions.push({ company: { contains: company, mode: "insensitive" } });
    }

    // Enrichment status filter — derived from field presence
    // full = linkedinUrl AND companyDomain both not null (email is always present)
    // partial = exactly one of linkedinUrl/companyDomain is null
    // missing = both linkedinUrl AND companyDomain are null
    if (enrichment === "full") {
      andConditions.push({
        AND: [
          { linkedinUrl: { not: null } },
          { companyDomain: { not: null } },
        ],
      });
    } else if (enrichment === "partial") {
      andConditions.push({
        OR: [
          { linkedinUrl: { not: null }, companyDomain: null },
          { linkedinUrl: null, companyDomain: { not: null } },
        ],
      });
    } else if (enrichment === "missing") {
      andConditions.push({ linkedinUrl: null, companyDomain: null });
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : {};

    // Batch all queries in a single Promise.all
    const [people, total, verticalGroups, workspaceGroups] = await Promise.all([
      prisma.person.findMany({
        where,
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
          workspaces: {
            select: {
              workspace: true,
              vertical: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.person.count({ where }),
      prisma.person.groupBy({
        by: ["vertical"],
        where: { vertical: { not: null } },
        orderBy: { vertical: "asc" },
      }),
      prisma.personWorkspace.groupBy({
        by: ["workspace"],
        orderBy: { workspace: "asc" },
      }),
    ]);

    const filterOptions = {
      verticals: verticalGroups
        .map((g) => g.vertical)
        .filter((v): v is string => v !== null),
      workspaces: workspaceGroups.map((g) => g.workspace),
    };

    return NextResponse.json({
      people,
      total,
      page,
      pageSize: PAGE_SIZE,
      filterOptions,
    });
  } catch (err) {
    console.error("[GET /api/people/search] Error:", err);
    return NextResponse.json(
      { error: "Failed to search people" },
      { status: 500 }
    );
  }
}
