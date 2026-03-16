import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Building2, Globe, ExternalLink } from "lucide-react";
import Link from "next/link";

const PAGE_SIZE = 50;

export default async function PortalCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;
  const { page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const skip = (currentPage - 1) * PAGE_SIZE;

  // Get unique company domains for this workspace's people
  const allPersonWorkspaces = await prisma.personWorkspace.findMany({
    where: { workspace: workspaceSlug },
    select: { person: { select: { companyDomain: true } } },
  });

  const uniqueDomains = [
    ...new Set(
      allPersonWorkspaces
        .map((pw) => pw.person.companyDomain)
        .filter((d): d is string => !!d),
    ),
  ];

  const totalCompanies = uniqueDomains.length;

  // Fetch paginated company records
  const companies = uniqueDomains.length > 0
    ? await prisma.company.findMany({
        where: { domain: { in: uniqueDomains } },
        orderBy: { name: "asc" },
        skip,
        take: PAGE_SIZE,
      })
    : [];

  // Count people per company domain for this workspace
  const domainCounts = new Map<string, number>();
  for (const pw of allPersonWorkspaces) {
    const d = pw.person.companyDomain;
    if (d) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }

  const totalPages = Math.ceil(totalCompanies / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Companies</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Companies associated with your campaign leads
          </p>
        </div>
        {totalCompanies > 0 && (
          <Badge variant="secondary" className="text-xs font-mono">
            {totalCompanies.toLocaleString()} total
          </Badge>
        )}
      </div>

      {/* Companies Table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Company Directory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {companies.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No companies yet"
              description="Company data will appear here as your campaigns discover and enrich prospects."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead>Company Name</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="text-right">Contacts</TableHead>
                    <TableHead className="w-[60px]">Website</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((c) => (
                    <TableRow key={c.id} className="hover:bg-muted border-border">
                      <TableCell className="font-medium text-sm">
                        {c.name || "\u2014"}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">
                        {c.domain}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.industry || "\u2014"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono text-muted-foreground tabular-nums">
                        {c.headcount?.toLocaleString() || "\u2014"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono text-muted-foreground tabular-nums">
                        {domainCounts.get(c.domain) ?? 0}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`https://${c.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Globe className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          {currentPage > 1 && (
            <Link
              href={`/portal/companies?page=${currentPage - 1}`}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-muted-foreground hover:bg-muted transition-colors"
            >
              Previous
            </Link>
          )}
          <span className="text-xs text-muted-foreground font-mono tabular-nums">
            {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages && (
            <Link
              href={`/portal/companies?page=${currentPage + 1}`}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-muted-foreground hover:bg-muted transition-colors"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
