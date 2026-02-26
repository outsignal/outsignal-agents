export const dynamic = "force-dynamic";

import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";

interface PeoplePageProps {
  searchParams: Promise<{
    source?: string;
    workspace?: string;
    status?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
  const params = await searchParams;
  const page = Number(params.page ?? "1");
  const pageSize = 50;

  const where: Record<string, unknown> = {};
  if (params.source) where.source = params.source;
  if (params.workspace)
    where.workspaces = { some: { workspace: params.workspace } };
  if (params.status) where.status = params.status;
  if (params.q) {
    where.OR = [
      { email: { contains: params.q } },
      { firstName: { contains: params.q } },
      { lastName: { contains: params.q } },
      { company: { contains: params.q } },
    ];
  }

  const [people, totalCount] = await Promise.all([
    prisma.person.findMany({
      where,
      include: { workspaces: { select: { workspace: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.person.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const statusColors: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    contacted: "bg-yellow-100 text-yellow-800",
    replied: "bg-brand text-brand-foreground",
    interested: "bg-emerald-100 text-emerald-800",
    bounced: "bg-red-100 text-red-800",
    unsubscribed: "bg-gray-100 text-gray-800",
  };

  return (
    <div>
      <Header
        title="People"
        description={`${totalCount.toLocaleString()} total people in database`}
      />
      <div className="p-8 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {["all", "clay", "emailbison", "manual"].map((source) => {
            const isActive =
              source === "all" ? !params.source : params.source === source;
            const href =
              source === "all"
                ? "/people"
                : `/people?source=${source}${params.q ? `&q=${params.q}` : ""}`;
            return (
              <a key={source} href={href}>
                <Badge
                  variant={isActive ? "default" : "outline"}
                  className={
                    isActive
                      ? "bg-brand text-brand-foreground hover:bg-brand/90"
                      : "cursor-pointer"
                  }
                >
                  {source === "all"
                    ? "All Sources"
                    : source === "emailbison"
                      ? "Email Bison"
                      : source === "clay"
                        ? "Clay"
                        : "Manual"}
                </Badge>
              </a>
            );
          })}
        </div>

        {/* Search */}
        <form className="flex gap-2" action="/people">
          <input
            name="q"
            type="text"
            placeholder="Search by name, email, or company..."
            defaultValue={params.q ?? ""}
            className="flex h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {params.source && (
            <input type="hidden" name="source" value={params.source} />
          )}
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Search
          </button>
        </form>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading">
              People
              {params.q && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  matching &ldquo;{params.q}&rdquo;
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">
                      {[person.firstName, person.lastName]
                        .filter(Boolean)
                        .join(" ") || "-"}
                    </TableCell>
                    <TableCell className="text-sm">{person.email}</TableCell>
                    <TableCell>{person.company ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {person.jobTitle ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {person.source === "emailbison"
                          ? "Email Bison"
                          : person.source === "clay"
                            ? "Clay"
                            : person.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {person.workspaces.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {person.workspaces.map((pw) => (
                            <Badge
                              key={pw.workspace}
                              variant="outline"
                              className="text-xs"
                            >
                              {pw.workspace}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${statusColors[person.status] ?? ""}`}
                      >
                        {person.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {people.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No people found. Sync from Email Bison or import from Clay.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm">
                <p className="text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  {page > 1 && (
                    <a
                      href={`/people?page=${page - 1}${params.source ? `&source=${params.source}` : ""}${params.q ? `&q=${params.q}` : ""}`}
                      className="inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm hover:bg-accent"
                    >
                      Previous
                    </a>
                  )}
                  {page < totalPages && (
                    <a
                      href={`/people?page=${page + 1}${params.source ? `&source=${params.source}` : ""}${params.q ? `&q=${params.q}` : ""}`}
                      className="inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm hover:bg-accent"
                    >
                      Next
                    </a>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
