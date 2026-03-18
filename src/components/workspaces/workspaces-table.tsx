"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkspaceRow {
  slug: string;
  name: string;
  vertical: string | null;
  status: string;
  package: string | null;
  type: string | null;
  createdAt: string;
  senderCount: number;
  campaignCount: number;
  memberCount: number;
  lastActivity: string | null;
}

interface WorkspacesTableProps {
  workspaces: WorkspaceRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const PACKAGE_BADGE: Record<string, { variant: "info" | "purple" | "brand" | "warning"; label: string }> = {
  email: { variant: "info", label: "Email" },
  linkedin: { variant: "purple", label: "LinkedIn" },
  email_linkedin: { variant: "brand", label: "Email + LinkedIn" },
  consultancy: { variant: "warning", label: "Consultancy" },
};

const STATUS_BADGE: Record<string, { variant: "success" | "secondary" | "warning"; dot: boolean; label: string }> = {
  active: { variant: "success", dot: true, label: "Active" },
  onboarding: { variant: "secondary", dot: false, label: "Onboarding" },
  pending_emailbison: { variant: "warning", dot: true, label: "Pending EB" },
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkspacesTable({ workspaces }: WorkspacesTableProps) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    if (!search.trim()) return workspaces;
    const q = search.toLowerCase();
    return workspaces.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.slug.toLowerCase().includes(q) ||
        (w.vertical && w.vertical.toLowerCase().includes(q)),
    );
  }, [workspaces, search]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search workspaces..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Showing{" "}
          <span className="font-medium text-foreground">
            {filtered.length}
          </span>{" "}
          result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table or filtered empty state */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No workspaces match"
          description="Try adjusting your search query."
          variant="compact"
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Vertical</TableHead>
                <TableHead className="hidden sm:table-cell">Package</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Members</TableHead>
                <TableHead className="text-right">Senders</TableHead>
                <TableHead className="text-right">Campaigns</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Last Activity</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((ws) => {
                const pkg = ws.package ? PACKAGE_BADGE[ws.package] : null;
                const status = STATUS_BADGE[ws.status] ?? {
                  variant: "secondary" as const,
                  dot: false,
                  label: ws.status,
                };

                return (
                  <TableRow
                    key={ws.slug}
                    className="cursor-pointer"
                    onClick={() => router.push(`/workspace/${ws.slug}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/workspace/${ws.slug}`}
                        className="font-medium text-sm text-foreground hover:text-brand transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ws.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {ws.vertical ?? "\u2014"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {pkg ? (
                        <Badge variant={pkg.variant}>{pkg.label}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">\u2014</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right hidden sm:table-cell">
                      <span className="font-mono text-sm text-foreground">
                        {ws.memberCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm text-foreground">
                        {ws.senderCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm text-foreground">
                        {ws.campaignCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant} dot={status.dot}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {ws.lastActivity ? relativeTime(ws.lastActivity) : "Never"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {formatDate(ws.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
