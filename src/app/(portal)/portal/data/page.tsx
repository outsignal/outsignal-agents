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
import { Users, Building2, ExternalLink } from "lucide-react";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local.charAt(0)}***@${domain}`;
}

export default async function PortalDataPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  // Fetch people in this workspace (limit 50)
  const personWorkspaces = await prisma.personWorkspace.findMany({
    where: { workspace: workspaceSlug },
    include: {
      person: true,
    },
    orderBy: { person: { createdAt: "desc" } },
    take: 50,
  });

  const totalPeople = await prisma.personWorkspace.count({
    where: { workspace: workspaceSlug },
  });

  // Collect unique company domains from people in this workspace
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

  // Fetch company data for the domains linked to our displayed people
  const displayedDomains = [
    ...new Set(
      personWorkspaces
        .map((pw) => pw.person.companyDomain)
        .filter((d): d is string => !!d),
    ),
  ];

  const companies = displayedDomains.length > 0
    ? await prisma.company.findMany({
        where: { domain: { in: displayedDomains } },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Enrichment Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A preview of contacts and companies discovered for your campaigns
        </p>
      </div>

      {/* People Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-heading flex items-center gap-2">
              <Users className="h-4 w-4" />
              People
            </CardTitle>
            {totalPeople > 0 && (
              <Badge variant="secondary" className="text-xs font-mono">
                Showing {Math.min(personWorkspaces.length, 50)} of{" "}
                {totalPeople.toLocaleString()} contacts
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {personWorkspaces.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Contact data will appear here as your campaigns are set up and prospects are discovered."
              variant="compact"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-[60px]">LinkedIn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {personWorkspaces.map((pw) => {
                    const p = pw.person;
                    const name =
                      [p.firstName, p.lastName].filter(Boolean).join(" ") ||
                      "\u2014";
                    return (
                      <TableRow key={pw.id} className="hover:bg-muted border-border">
                        <TableCell className="font-medium text-sm">
                          {name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.jobTitle || "\u2014"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.company || "\u2014"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">
                          {maskEmail(p.email)}
                        </TableCell>
                        <TableCell>
                          {p.linkedinUrl ? (
                            <a
                              href={p.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">\u2014</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Companies Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-heading flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Companies
            </CardTitle>
            {totalCompanies > 0 && (
              <Badge variant="secondary" className="text-xs font-mono">
                Showing {companies.length} of{" "}
                {totalCompanies.toLocaleString()} companies
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {companies.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No company data yet"
              description="Company enrichment data will appear here as prospects are discovered and enriched."
              variant="compact"
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((c) => (
                    <TableRow key={c.id} className="hover:bg-muted border-border">
                      <TableCell className="font-medium text-sm">
                        {c.name}
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
