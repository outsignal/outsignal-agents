"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileSignature,
  Link as LinkIcon,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { ControlledConfirmDialog } from "@/components/ui/confirm-dialog";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  ProposalFormModal,
  type ProposalFormData,
} from "@/components/proposals/proposal-form-modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Proposal {
  id: string;
  token: string;
  clientName: string;
  clientEmail: string | null;
  companyOverview: string | null;
  packageType: string;
  setupFee: number;
  platformCost: number;
  retainerCost: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "draft" | "sent" | "accepted" | "paid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "paid", label: "Paid" },
];

function statusBadgeVariant(
  status: string,
): "secondary" | "info" | "warning" | "success" | "brand" {
  switch (status) {
    case "draft":
      return "secondary";
    case "sent":
      return "info";
    case "accepted":
      return "warning";
    case "paid":
      return "success";
    case "onboarding_complete":
      return "brand";
    default:
      return "secondary";
  }
}

function packageBadgeVariant(
  pkg: string,
): "info" | "purple" | "brand" {
  switch (pkg) {
    case "email":
      return "info";
    case "linkedin":
      return "purple";
    case "email_linkedin":
      return "brand";
    default:
      return "info";
  }
}

function packageLabel(pkg: string): string {
  switch (pkg) {
    case "email":
      return "Email";
    case "linkedin":
      return "LinkedIn";
    case "email_linkedin":
      return "Email + LinkedIn";
    default:
      return pkg;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "paid":
      return "Paid";
    case "onboarding_complete":
      return "Onboarding Complete";
    default:
      return status;
  }
}

function formatPence(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Proposal | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch proposals
  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals");
      if (!res.ok) throw new Error("Failed to fetch proposals");
      const data = await res.json();
      setProposals(data.proposals ?? []);
    } catch {
      toast.error("Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // Filtered proposals
  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? proposals
        : proposals.filter((p) => p.status === statusFilter),
    [proposals, statusFilter],
  );

  // KPI counts
  const counts = useMemo(() => {
    const c = { total: proposals.length, draft: 0, sent: 0, accepted: 0, paid: 0 };
    for (const p of proposals) {
      if (p.status === "draft") c.draft++;
      else if (p.status === "sent") c.sent++;
      else if (p.status === "accepted") c.accepted++;
      else if (p.status === "paid") c.paid++;
    }
    return c;
  }, [proposals]);

  // Handlers
  function handleNewProposal() {
    setEditingProposal(null);
    setModalOpen(true);
  }

  function handleEditProposal(proposal: Proposal) {
    setEditingProposal(proposal);
    setModalOpen(true);
  }

  function handleCopyLink(token: string) {
    const appUrl = window.location.origin;
    const url = `${appUrl}/p/${token}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Proposal link copied to clipboard"),
      () => toast.error("Failed to copy link"),
    );
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/proposals/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete proposal");
      }
      toast.success("Proposal deleted");
      setDeleteTarget(null);
      fetchProposals();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete proposal");
    } finally {
      setDeleting(false);
    }
  }

  function handleModalClose(open: boolean) {
    setModalOpen(open);
    if (!open) {
      // Refetch after close (covers create + edit)
      fetchProposals();
    }
  }

  // Build initial data for editing
  const editInitialData: ProposalFormData | undefined = editingProposal
    ? {
        clientName: editingProposal.clientName,
        clientEmail: editingProposal.clientEmail ?? undefined,
        companyOverview: editingProposal.companyOverview ?? undefined,
        packageType: editingProposal.packageType,
        setupFee: editingProposal.setupFee,
        platformCost: editingProposal.platformCost,
        retainerCost: editingProposal.retainerCost,
        status: editingProposal.status,
      }
    : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
        <div className="min-w-0">
          <h1 className="text-xl font-medium text-foreground">Proposals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading
              ? "Loading proposals..."
              : `${counts.total} proposal${counts.total !== 1 ? "s" : ""} total`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="brand" onClick={handleNewProposal}>
            <Plus />
            New Proposal
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 p-6 space-y-6 overflow-auto">
        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <MetricCard
            label="Total Proposals"
            value={counts.total}
            icon="FileText"
            density="compact"
            accentColor="#635BFF"
            loading={loading}
          />
          <MetricCard
            label="Draft"
            value={counts.draft}
            icon="FileText"
            density="compact"
            accentColor="#94a3b8"
            loading={loading}
          />
          <MetricCard
            label="Sent"
            value={counts.sent}
            icon="Send"
            density="compact"
            accentColor="#3b82f6"
            loading={loading}
          />
          <MetricCard
            label="Accepted"
            value={counts.accepted}
            icon="CheckCircle"
            density="compact"
            accentColor="#f59e0b"
            loading={loading}
          />
          <MetricCard
            label="Paid"
            value={counts.paid}
            icon="Star"
            density="compact"
            accentColor="#10b981"
            loading={loading}
          />
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1 border-b border-border/50">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                statusFilter === tab.value
                  ? "border-[#635BFF] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.value !== "all" && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {counts[tab.value as keyof typeof counts]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table or empty state */}
        {!loading && filtered.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title="No proposals found"
            description={
              statusFilter !== "all"
                ? `No proposals with status "${statusFilter}". Try a different filter or create a new proposal.`
                : "Create your first proposal to get started."
            }
            action={{
              label: "New Proposal",
              onClick: handleNewProposal,
            }}
          />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Client Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Total Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((proposal) => {
                  const totalValue =
                    proposal.setupFee + proposal.platformCost + proposal.retainerCost;
                  return (
                    <TableRow key={proposal.id}>
                      <TableCell className="font-medium">
                        {proposal.clientName}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">
                        {proposal.clientEmail ?? "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={packageBadgeVariant(proposal.packageType)}>
                          {packageLabel(proposal.packageType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatPence(totalValue)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(proposal.status)} dot>
                          {statusLabel(proposal.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(proposal.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleCopyLink(proposal.token)}
                            title="Copy proposal link"
                          >
                            <LinkIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleEditProposal(proposal)}
                            title="Edit proposal"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {proposal.status === "draft" && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setDeleteTarget(proposal)}
                              title="Delete proposal"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Proposal Form Modal */}
      <ProposalFormModal
        open={modalOpen}
        onOpenChange={handleModalClose}
        proposalId={editingProposal?.id}
        initialData={editInitialData}
        mode={editingProposal ? "edit" : "create"}
      />

      {/* Delete Confirmation Dialog */}
      <ControlledConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Proposal"
        description={`Are you sure you want to delete the proposal for "${deleteTarget?.clientName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        disabled={deleting}
      />
    </div>
  );
}
