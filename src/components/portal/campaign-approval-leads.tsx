"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { CheckCircle2, Loader2, Users } from "lucide-react";
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
    return <span className="text-muted-foreground text-sm">—</span>;
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

export function CampaignApprovalLeads({
  campaignId,
  leads,
  totalCount,
  leadsApproved,
  leadsFeedback,
  isPending,
}: Props) {
  const router = useRouter();
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAct = isPending && !leadsApproved;

  // Client-side pagination
  const pageSize = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(leads.length / pageSize));
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, leads.length);
  const paginatedLeads = leads.slice(startIdx, endIdx);

  async function handleApprove() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/campaigns/${campaignId}/approve-leads`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to approve leads");
      router.refresh();
    } catch {
      setError("Something went wrong approving the leads. Please try again.");
      setConfirmApprove(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestChanges() {
    if (!feedback.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/campaigns/${campaignId}/request-changes-leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      if (!res.ok) throw new Error("Failed to submit feedback");
      setShowFeedback(false);
      setFeedback("");
      router.refresh();
    } catch {
      setError("Something went wrong submitting your feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Previous feedback banner */}
      {leadsFeedback && !leadsApproved && (
        <div className="border-l-4 border-amber-400 bg-amber-50/50 px-4 py-3 mb-4 rounded-r-md">
          <p className="text-sm font-medium text-amber-800 mb-0.5">Changes Requested</p>
          <p className="text-sm text-amber-700">{leadsFeedback}</p>
        </div>
      )}

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-[#635BFF]/10 p-3 mb-4">
            <Loader2 className="h-6 w-6 text-[#635BFF] animate-spin" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-1">Leads are currently being processed</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            We&apos;re building your target list. You&apos;ll be notified when leads are ready for review. In the meantime, you can review the campaign content.
          </p>
        </div>
      ) : (
        <>
          {/* Lead count line */}
          <div className="flex items-center gap-2 mb-4">
            {leadsApproved && (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            )}
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {totalCount > leads.length ? (
                <>Showing top <strong className="text-foreground font-medium">{leads.length.toLocaleString()}</strong> of <strong className="text-foreground font-medium">{totalCount.toLocaleString()}</strong> leads, sorted by ICP score</>
              ) : (
                <><strong className="text-foreground font-medium">{leads.length.toLocaleString()}</strong> leads, sorted by ICP score</>
              )}
              {leadsApproved && (
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-700 font-medium">
                  · Approved
                </span>
              )}
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border">
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5 pl-4">Name</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5">Company</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5 hidden md:table-cell">Location</TableHead>
                  <TableHead className="w-10 hidden md:table-cell py-2.5" />
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground font-medium py-2.5 text-right pr-4">ICP</TableHead>
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
                          .join(" ") || "—"}
                      </p>
                      {lead.jobTitle && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{lead.jobTitle}</p>
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 text-sm">{lead.company ?? "—"}</TableCell>
                    <TableCell className="py-3.5 hidden md:table-cell text-sm text-muted-foreground max-w-[160px] truncate">
                      {lead.location ? formatLocation(lead.location) : "—"}
                    </TableCell>
                    <TableCell className="py-3.5 hidden md:table-cell w-10">
                      {lead.linkedinUrl ? (
                        <a
                          href={lead.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-[#635BFF] transition-colors inline-flex"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                          </svg>
                        </a>
                      ) : (
                        <span className="text-muted-foreground/30">—</span>
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

          {/* Pagination controls */}
          {leads.length > pageSize && (
            <div className="flex items-center justify-between pt-4 mt-2">
              <p className="text-sm text-muted-foreground">
                Showing {startIdx + 1}–{endIdx} of {leads.length.toLocaleString()} leads
                {leads.length < totalCount && (
                  <span className="ml-1">({totalCount.toLocaleString()} total)</span>
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
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Sticky action bar */}
      {canAct && leads.length > 0 && (
        <div className="sticky bottom-0 z-10 bg-background border-t py-3 mt-4">
          {error && (
            <p className="text-sm text-red-600 mb-2">{error}</p>
          )}

          {/* Request changes feedback form */}
          {showFeedback && (
            <div className="mb-3 space-y-2">
              <Textarea
                placeholder="Describe what changes you'd like (e.g., 'too many US-based leads, need more UK')..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                className="text-sm"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleRequestChanges}
                  disabled={loading || !feedback.trim()}
                  size="sm"
                  className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
                >
                  {loading && (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  )}
                  Submit Feedback
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowFeedback(false); setFeedback(""); }}
                  disabled={loading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {totalCount.toLocaleString()} lead{totalCount !== 1 ? "s" : ""} ready for approval
            </p>

            {confirmApprove ? (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  Approve all {totalCount.toLocaleString()} leads?
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmApprove(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
                  onClick={handleApprove}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Confirm
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => { setShowFeedback(!showFeedback); setConfirmApprove(false); }}
                  disabled={loading}
                >
                  Request Changes
                </Button>
                <Button
                  className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
                  onClick={() => { setConfirmApprove(true); setShowFeedback(false); }}
                  disabled={loading}
                >
                  Approve Leads
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
