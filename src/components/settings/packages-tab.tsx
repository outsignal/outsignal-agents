"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, ExternalLink } from "lucide-react";

interface PackageRow {
  slug: string;
  name: string;
  status: string;
  modules: string[];
  leadQuota: number;
  leadsUsed: number;
  campaignAllowance: number;
  campaignsUsed: number;
}

const MODULE_LABELS: Record<string, { label: string; variant: "success" | "warning" }> = {
  email: { label: "Email", variant: "success" },
  "email-signals": { label: "Email Signals", variant: "warning" },
  linkedin: { label: "LinkedIn", variant: "success" },
  "linkedin-signals": { label: "LinkedIn Signals", variant: "warning" },
};

function QuotaBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">
        {used.toLocaleString()} / {total.toLocaleString()}
      </span>
      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all ${isHigh ? "bg-amber-400" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function PackagesTab() {
  const [rows, setRows] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function fetchPackages() {
      try {
        const res = await fetch("/api/settings/packages");
        const json = await res.json();
        if (active) setRows(json.packages ?? []);
      } catch {
        // silent
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchPackages();
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Campaign capabilities and quotas for all workspaces.
        </p>
        <Link
          href="/packages"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Open full page <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Modules</TableHead>
                <TableHead>Lead Quota</TableHead>
                <TableHead>Campaigns</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground text-sm">
                    No workspaces found.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.slug} className="border-border">
                    <TableCell>
                      <Link
                        href={`/workspace/${row.slug}/settings`}
                        className="font-medium text-sm hover:underline"
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.modules.map((mod) => {
                          const config = MODULE_LABELS[mod];
                          return (
                            <Badge
                              key={mod}
                              variant={config?.variant ?? "secondary"}
                              size="xs"
                            >
                              {config?.label ?? mod}
                            </Badge>
                          );
                        })}
                        {row.modules.length === 0 && (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <QuotaBar used={row.leadsUsed} total={row.leadQuota} />
                    </TableCell>
                    <TableCell>
                      <QuotaBar used={row.campaignsUsed} total={row.campaignAllowance} />
                    </TableCell>
                    <TableCell>
                      {row.status === "active" ? (
                        <Badge variant="success" size="xs">Active</Badge>
                      ) : row.status === "inactive" ? (
                        <Badge variant="outline" size="xs">Inactive</Badge>
                      ) : (
                        <Badge variant="secondary" size="xs">{row.status}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
