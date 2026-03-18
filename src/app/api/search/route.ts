import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q") ?? "").trim();
  const type = searchParams.get("type") ?? "all";
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1),
    100
  );

  // Return empty results for short queries
  if (q.length < 2) {
    return NextResponse.json({
      people: [],
      companies: [],
      totalPeople: 0,
      totalCompanies: 0,
    });
  }

  const searchTerm = q.toLowerCase();

  const [people, companies, totalPeople, totalCompanies] = await Promise.all([
    // People search
    type === "companies"
      ? Promise.resolve([])
      : prisma.person.findMany({
          where: {
            OR: [
              { firstName: { contains: searchTerm, mode: "insensitive" } },
              { lastName: { contains: searchTerm, mode: "insensitive" } },
              { email: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            companyDomain: true,
            workspaces: {
              select: {
                workspace: true,
              },
            },
          },
          take: limit,
          orderBy: { updatedAt: "desc" },
        }),

    // Companies search
    type === "people"
      ? Promise.resolve([])
      : prisma.company.findMany({
          where: {
            OR: [
              { name: { contains: searchTerm, mode: "insensitive" } },
              { domain: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            name: true,
            domain: true,
            industry: true,
            headcount: true,
          },
          take: limit,
          orderBy: { updatedAt: "desc" },
        }),

    // People count
    type === "companies"
      ? Promise.resolve(0)
      : prisma.person.count({
          where: {
            OR: [
              { firstName: { contains: searchTerm, mode: "insensitive" } },
              { lastName: { contains: searchTerm, mode: "insensitive" } },
              { email: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
        }),

    // Companies count
    type === "people"
      ? Promise.resolve(0)
      : prisma.company.count({
          where: {
            OR: [
              { name: { contains: searchTerm, mode: "insensitive" } },
              { domain: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
        }),
  ]);

  // Map workspace slugs to workspace names
  let workspaceNames: Record<string, string> = {};
  if (type !== "companies" && people.length > 0) {
    const slugs = new Set(
      (people as Array<{ workspaces: Array<{ workspace: string }> }>).flatMap(
        (p) => p.workspaces.map((w) => w.workspace)
      )
    );
    if (slugs.size > 0) {
      const workspaces = await prisma.workspace.findMany({
        where: { slug: { in: Array.from(slugs) } },
        select: { slug: true, name: true },
      });
      workspaceNames = Object.fromEntries(
        workspaces.map((w) => [w.slug, w.name])
      );
    }
  }

  // Format people results with workspace names
  const formattedPeople = (
    people as Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
      companyDomain: string | null;
      workspaces: Array<{ workspace: string }>;
    }>
  ).map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    companyDomain: p.companyDomain,
    workspaces: p.workspaces.map((w) => ({
      name: workspaceNames[w.workspace] ?? w.workspace,
      slug: w.workspace,
    })),
  }));

  return NextResponse.json({
    people: formattedPeople,
    companies,
    totalPeople,
    totalCompanies,
  });
}
