"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface CampaignLead {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company?: string;
  status?: string;
  lead_campaign_data?: {
    campaign_id: number;
    status: string;
    emails_sent: number;
    replies: number;
    opens: number;
    interested: boolean;
  }[];
}

interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number;
  to: number;
}

interface Props {
  campaignId: string;
  ebCampaignId: number;
}

const statusColors: Record<string, string> = {
  contacted: "bg-blue-100 text-blue-800",
  replied: "bg-emerald-100 text-emerald-800",
  interested: "bg-green-100 text-green-800",
  bounced: "bg-red-100 text-red-800",
  unsubscribed: "bg-gray-100 text-gray-800",
  pending: "bg-amber-100 text-amber-800",
  not_contacted: "bg-gray-100 text-gray-600",
};

export function CampaignLeadsTable({ campaignId, ebCampaignId }: Props) {
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const limit = 25;

  const fetchLeads = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/campaigns/${campaignId}/leads?page=${p}&limit=${limit}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch leads");
      }
      const json = await res.json();
      setLeads(json.data ?? []);
      setMeta(json.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch leads");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchLeads(page);
  }, [page, fetchLeads]);

  function getCampaignStats(lead: CampaignLead) {
    return lead.lead_campaign_data?.find(
      (d) => d.campaign_id === ebCampaignId,
    );
  }

  function formatStatus(status?: string) {
    if (!status) return "Unknown";
    return status
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const totalPages = meta?.last_page ?? 1;
  const total = meta?.total ?? 0;
  const from = meta?.from ?? 0;
  const to = meta?.to ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-base">
            Campaign Leads
          </CardTitle>
          {total > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              {total.toLocaleString()} total
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading && leads.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading leads...
            </span>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-sm text-red-600 mb-3">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchLeads(page)}
            >
              Retry
            </Button>
          </div>
        ) : leads.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">
            No leads found for this campaign.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Company
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">
                      Opens
                    </TableHead>
                    <TableHead className="text-right">Replies</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => {
                    const stats = getCampaignStats(lead);
                    const displayStatus = stats?.status ?? lead.status;
                    return (
                      <TableRow
                        key={lead.id}
                        className={cn(
                          loading && "opacity-50 transition-opacity",
                        )}
                      >
                        <TableCell className="font-medium whitespace-nowrap">
                          {[lead.first_name, lead.last_name]
                            .filter(Boolean)
                            .join(" ") || "\u2014"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {lead.email}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {lead.company ?? "\u2014"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-xs",
                              statusColors[displayStatus ?? ""] ??
                                "bg-gray-100 text-gray-600",
                            )}
                          >
                            {formatStatus(displayStatus)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stats?.emails_sent ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden sm:table-cell">
                          {stats?.opens ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stats?.replies ?? 0}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {from}\u2013{to} of {total.toLocaleString()} leads
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={page === totalPages || loading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
