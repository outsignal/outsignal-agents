export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PACKAGE_LABELS, formatPence } from "@/lib/proposal-templates";
import { CopyLinkButton } from "@/components/proposals/copy-link-button";

const statusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  onboarding_complete: "bg-brand/20 text-brand-foreground",
};

export default async function ProposalsPage() {
  const proposals = await prisma.proposal.findMany({
    orderBy: { createdAt: "desc" },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <div>
      <Header
        title="Proposals"
        description="Manage client proposals and onboarding"
        actions={
          <Link href="/onboard/new">
            <Button>Create New Proposal</Button>
          </Link>
        }
      />
      <div className="p-8">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/onboard/${p.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.clientName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {PACKAGE_LABELS[p.packageType] || p.packageType}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${statusStyles[p.status] ?? ""}`}
                      >
                        {p.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPence(p.platformCost + p.retainerCost)}/mo
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <CopyLinkButton
                        url={`${appUrl}/p/${p.token}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {proposals.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No proposals yet. Create your first one to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
