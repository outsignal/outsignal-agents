"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeadSample {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  linkedinUrl: string | null;
  icpScore: number | null;
}

interface AdminLeadsTableProps {
  leads: LeadSample[];
  totalCount: number;
}

function titleCase(s: string): string {
  if (s === s.toUpperCase() || s === s.toLowerCase()) {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  return s;
}

function formatLocation(location: string): string {
  let loc = location;
  loc = loc.replace("United Kingdom", "UK");
  loc = loc.replace("United States", "US");
  const parts = loc.split(",").map((p) => p.trim());
  return parts.slice(0, 2).join(", ");
}

function IcpBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-muted-foreground text-sm">&mdash;</span>;
  }
  const isGreen = score >= 70;
  const isAmber = score >= 40 && score < 70;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
        isGreen && "bg-emerald-100 text-emerald-700",
        isAmber && "bg-amber-100 text-amber-700",
        !isGreen && !isAmber && "bg-gray-100 text-gray-500",
      )}
    >
      {score}
    </span>
  );
}

export function AdminLeadsTable({ leads, totalCount }: AdminLeadsTableProps) {
  const pageSize = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(leads.length / pageSize));
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, leads.length);
  const paginatedLeads = leads.slice(startIdx, endIdx);

  if (leads.length === 0) {
    return (
      <p className="text-center py-10 text-muted-foreground text-sm">
        No leads linked to this campaign yet.
      </p>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Users className="size-3.5" />
          {totalCount > leads.length ? (
            <>
              Showing top{" "}
              <strong className="text-foreground font-medium">
                {leads.length.toLocaleString()}
              </strong>{" "}
              of{" "}
              <strong className="text-foreground font-medium">
                {totalCount.toLocaleString()}
              </strong>{" "}
              leads, sorted by ICP score
            </>
          ) : (
            <>
              <strong className="text-foreground font-medium">
                {leads.length.toLocaleString()}
              </strong>{" "}
              leads, sorted by ICP score
            </>
          )}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border">
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5 pl-4">
                Name
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5">
                Company
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5 hidden md:table-cell">
                Location
              </TableHead>
              <TableHead className="w-10 hidden md:table-cell py-2.5" />
              <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5 text-right pr-4">
                ICP
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLeads.map((lead) => (
              <TableRow
                key={lead.personId}
                className="hover:bg-muted/30 transition-colors border-b border-border/50 last:border-0"
              >
                <TableCell className="py-3.5 pl-4">
                  <p className="font-medium text-sm leading-snug">
                    {[lead.firstName, lead.lastName]
                      .filter(Boolean)
                      .map((s) => titleCase(s!))
                      .join(" ") || "\u2014"}
                  </p>
                  {lead.jobTitle && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {lead.jobTitle}
                    </p>
                  )}
                </TableCell>
                <TableCell className="py-3.5 text-sm">
                  {lead.company ?? "\u2014"}
                </TableCell>
                <TableCell className="py-3.5 hidden md:table-cell text-sm text-muted-foreground max-w-[160px] truncate">
                  {lead.location ? formatLocation(lead.location) : "\u2014"}
                </TableCell>
                <TableCell className="py-3.5 hidden md:table-cell w-10">
                  {lead.linkedinUrl ? (
                    <a
                      href={lead.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-[#635BFF] transition-colors inline-flex"
                    >
                      <svg
                        className="size-4"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                    </a>
                  ) : (
                    <span className="text-muted-foreground/30">&mdash;</span>
                  )}
                </TableCell>
                <TableCell className="py-3.5 text-right pr-4">
                  <IcpBadge score={lead.icpScore} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {leads.length > pageSize && (
        <div className="flex items-center justify-between pt-4 mt-2">
          <p className="text-sm text-muted-foreground">
            Showing {startIdx + 1}&ndash;{endIdx} of{" "}
            {leads.length.toLocaleString()} leads
            {leads.length < totalCount && (
              <span className="ml-1">
                ({totalCount.toLocaleString()} total)
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((p) => Math.min(totalPages, p + 1))
              }
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
