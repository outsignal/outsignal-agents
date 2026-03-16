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
import { Users, ExternalLink } from "lucide-react";
import Link from "next/link";

const PAGE_SIZE = 50;

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local.charAt(0)}***@${domain}`;
}

export default async function PortalPeoplePage({
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

  const [personWorkspaces, totalPeople] = await Promise.all([
    prisma.personWorkspace.findMany({
      where: { workspace: workspaceSlug },
      include: {
        person: true,
      },
      orderBy: { person: { createdAt: "desc" } },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.personWorkspace.count({
      where: { workspace: workspaceSlug },
    }),
  ]);

  const totalPages = Math.ceil(totalPeople / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-foreground">People</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Contacts and leads associated with your workspace
          </p>
        </div>
        {totalPeople > 0 && (
          <Badge variant="secondary" className="text-xs font-mono">
            {totalPeople.toLocaleString()} total
          </Badge>
        )}
      </div>

      {/* People Table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Users className="h-4 w-4" />
            Contacts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {personWorkspaces.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Contacts will appear here as your campaigns discover and engage prospects."
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
                            <span className="text-muted-foreground">{"\u2014"}</span>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          {currentPage > 1 && (
            <Link
              href={`/portal/people?page=${currentPage - 1}`}
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
              href={`/portal/people?page=${currentPage + 1}`}
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
