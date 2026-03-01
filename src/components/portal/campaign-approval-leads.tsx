"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, MessageSquare, ExternalLink } from "lucide-react";
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

interface Props {
  campaignId: string;
  leads: LeadSample[];
  totalCount: number;
  leadsApproved: boolean;
  leadsFeedback: string | null;
  isPending: boolean;
}

export function CampaignApprovalLeads({
  campaignId,
  leads,
  totalCount,
  leadsApproved,
  leadsFeedback,
  isPending,
}: Props) {
  const router = useRouter();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);

  const canAct = isPending && !leadsApproved;

  async function handleApprove() {
    setLoading(true);
    await fetch(`/api/portal/campaigns/${campaignId}/approve-leads`, {
      method: "POST",
    });
    setLoading(false);
    router.refresh();
  }

  async function handleRequestChanges() {
    if (!feedback.trim()) return;
    setLoading(true);
    await fetch(`/api/portal/campaigns/${campaignId}/request-changes-leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: feedback.trim() }),
    });
    setLoading(false);
    setShowFeedback(false);
    setFeedback("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-lg">Leads</CardTitle>
          {leadsApproved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-700 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Approved
            </span>
          )}
        </div>
        {totalCount > 0 && (
          <p className="text-sm text-muted-foreground">
            Showing top {Math.min(leads.length, 50)} of {totalCount.toLocaleString()} leads, ordered by ICP score
          </p>
        )}
      </CardHeader>
      <CardContent>
        {/* Previous feedback banner */}
        {leadsFeedback && !leadsApproved && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4 text-sm">
            <p className="font-medium text-amber-800 mb-1">Changes Requested</p>
            <p className="text-amber-700">{leadsFeedback}</p>
          </div>
        )}

        {leads.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">
            No leads linked to this campaign yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>LinkedIn</TableHead>
                  <TableHead className="text-right">ICP Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.personId}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—"}
                    </TableCell>
                    <TableCell>{lead.jobTitle ?? "—"}</TableCell>
                    <TableCell>{lead.company ?? "—"}</TableCell>
                    <TableCell>{lead.location ?? "—"}</TableCell>
                    <TableCell>
                      {lead.linkedinUrl ? (
                        <a
                          href={lead.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm"
                        >
                          Profile <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {lead.icpScore !== null ? (
                        <span
                          className={cn(
                            "font-medium",
                            lead.icpScore >= 70
                              ? "text-emerald-700"
                              : lead.icpScore >= 40
                                ? "text-amber-700"
                                : "text-gray-500",
                          )}
                        >
                          {lead.icpScore}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Approval buttons — only show when campaign is pending and leads not yet approved */}
        {canAct && leads.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Button
                onClick={handleApprove}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Approve Leads
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowFeedback(!showFeedback)}
                disabled={loading}
              >
                <MessageSquare className="h-4 w-4 mr-1" />
                Request Changes
              </Button>
            </div>

            {showFeedback && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Describe what changes you'd like (e.g., 'too many US-based leads, need more UK')..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={3}
                />
                <Button
                  onClick={handleRequestChanges}
                  disabled={loading || !feedback.trim()}
                  variant="destructive"
                  size="sm"
                >
                  Submit Feedback
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
