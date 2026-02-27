import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCompanyEnrichmentStatus } from "@/lib/enrichment/status";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const q = searchParams.get("q")?.trim() || "";
    const verticals = searchParams.getAll("vertical");
    const enrichment = searchParams.get("enrichment") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

    // Build WHERE conditions
    const andConditions: object[] = [];

    if (q) {
      andConditions.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { domain: { contains: q, mode: "insensitive" } },
          { industry: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    if (verticals.length > 0) {
      andConditions.push({ industry: { in: verticals } });
    }

    if (enrichment === "full") {
      andConditions.push({
        industry: { not: null },
        headcount: { not: null },
        description: { not: null },
      });
    } else if (enrichment === "partial") {
      andConditions.push({
        AND: [
          {
            OR: [
              { industry: { not: null } },
              { headcount: { not: null } },
              { description: { not: null } },
            ],
          },
          {
            OR: [
              { industry: null },
              { headcount: null },
              { description: null },
            ],
          },
        ],
      });
    } else if (enrichment === "missing") {
      andConditions.push({
        industry: null,
        headcount: null,
        description: null,
      });
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : {};

    const skip = (page - 1) * PAGE_SIZE;

    const [companies, total, industriesGroup] = await Promise.all([
      prisma.company.findMany({
        where,
        select: {
          id: true,
          name: true,
          domain: true,
          industry: true,
          headcount: true,
          location: true,
          description: true,
          website: true,
          yearFounded: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: PAGE_SIZE,
      }),
      prisma.company.count({ where }),
      prisma.company.groupBy({
        by: ["industry"],
        where: { industry: { not: null } },
        orderBy: { industry: "asc" },
      }),
    ]);

    // Annotate each company with its enrichment status
    const companiesWithStatus = companies.map((c) => ({
      ...c,
      enrichmentStatus: getCompanyEnrichmentStatus(c),
    }));

    const industries = industriesGroup
      .map((g) => g.industry)
      .filter((i): i is string => i !== null);

    return NextResponse.json({
      companies: companiesWithStatus,
      total,
      page,
      pageSize: PAGE_SIZE,
      filterOptions: {
        industries,
      },
    });
  } catch (error) {
    console.error("[companies/search] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
