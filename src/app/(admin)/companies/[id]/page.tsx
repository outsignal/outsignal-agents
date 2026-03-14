import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Globe,
  Linkedin,
  Building2,
  Users,
  Calendar,
  MapPin,
} from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CompanyDetailPage({ params }: Props) {
  const { id } = await params;

  const company = await prisma.company.findUnique({
    where: { id },
  });

  if (!company) notFound();

  // Parse JSON fields
  let techStack: string[] = [];
  try {
    if (company.techStack) techStack = JSON.parse(company.techStack) as string[];
  } catch {
    // ignore
  }

  let enrichmentData: Record<string, unknown> = {};
  try {
    if (company.enrichmentData)
      enrichmentData = JSON.parse(company.enrichmentData) as Record<string, unknown>;
  } catch {
    // ignore
  }

  // Find people at this company
  const people = await prisma.person.findMany({
    where: { companyDomain: company.domain },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      jobTitle: true,
      linkedinUrl: true,
      updatedAt: true,
    },
  });

  return (
    <div>
      <Header
        title={company.name}
        description={company.domain}
      />

      <div className="p-6 space-y-6">
        {/* Company Info Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {company.description && (
                <p className="text-sm text-muted-foreground">
                  {company.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {company.industry && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{company.industry}</span>
                  </div>
                )}
                {company.headcount != null && (
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{company.headcount.toLocaleString()} employees</span>
                  </div>
                )}
                {company.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{company.location}</span>
                  </div>
                )}
                {company.yearFounded && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>Founded {company.yearFounded}</span>
                  </div>
                )}
                {company.revenue && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Revenue:</span>{" "}
                    <span className="font-medium">{company.revenue}</span>
                  </div>
                )}
                {company.companyType && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Type:</span>{" "}
                    <span className="capitalize">{company.companyType}</span>
                  </div>
                )}
              </div>

              {/* Links */}
              <div className="flex gap-3 pt-2">
                {company.website && (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Globe className="h-4 w-4" /> Website
                  </a>
                )}
                {company.linkedinUrl && (
                  <a
                    href={company.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Linkedin className="h-4 w-4" /> LinkedIn
                  </a>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tech Stack & Enrichment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Enrichment Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {techStack.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                    Tech Stack
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {techStack.map((tech) => (
                      <Badge key={tech} variant="secondary" className="text-xs">
                        {tech}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(enrichmentData).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                    Additional Fields
                  </p>
                  <div className="space-y-1.5">
                    {Object.entries(enrichmentData).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="text-right max-w-[60%] truncate">
                          {typeof value === "string"
                            ? value
                            : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {techStack.length === 0 &&
                Object.keys(enrichmentData).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No enrichment data available yet.
                  </p>
                )}
            </CardContent>
          </Card>
        </div>

        {/* People at this company */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              People at {company.name}
              {people.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {people.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {people.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <Users className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No people found with @{company.domain} email addresses.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((person) => (
                    <TableRow key={person.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {[person.firstName, person.lastName]
                            .filter(Boolean)
                            .join(" ") || "—"}
                          {person.linkedinUrl && (
                            <a
                              href={person.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Linkedin className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {person.email}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {person.jobTitle || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {person.updatedAt.toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
