"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
import {
  ProposalFormModal,
  type ProposalFormData,
} from "@/components/proposals/proposal-form-modal";
import {
  OnboardingFormModal,
  type OnboardingInviteData,
} from "@/components/proposals/onboarding-form-modal";
import {
  DocumentUpload,
  type ParsedDocumentFields,
} from "@/components/proposals/document-upload";
import { Pencil, Trash2 } from "lucide-react";
import { ControlledConfirmDialog } from "@/components/ui/confirm-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  token: string;
  status: string;
  clientName: string;
  clientEmail?: string;
  companyOverview: string;
  packageType: string;
  setupFee: number;
  platformCost: number;
  retainerCost: number;
  createdAt: string;
}

interface OnboardingInviteRow {
  id: string;
  token: string;
  status: string;
  clientName: string;
  clientEmail?: string;
  createWorkspace: boolean;
  workspaceSlug?: string;
  createdAt: string;
}

interface OnboardApiResponse {
  proposals: ProposalRow[];
  onboardingInvites: OnboardingInviteRow[];
  appUrl: string;
}

// ---------------------------------------------------------------------------
// Status styles
// ---------------------------------------------------------------------------

const proposalStatusStyles: Record<string, string> = {
  draft: "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200",
  sent: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200",
  accepted: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200",
  paid: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200",
  onboarding_complete: "bg-brand/20 text-brand-foreground",
};

const inviteStatusStyles: Record<string, string> = {
  draft: "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200",
  sent: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200",
  viewed: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200",
  completed: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200",
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function OnboardSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      <p className="text-sm text-muted-foreground mt-3">Loading...</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardTab() {
  const [data, setData] = useState<OnboardApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/onboard");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Proposal modal state
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<ProposalRow | null>(
    null,
  );
  const [prefilledProposalData, setPrefilledProposalData] =
    useState<ProposalFormData | null>(null);
  const [proposalMode, setProposalMode] = useState<
    "edit" | "create-from-document" | "create"
  >("create");

  // Onboarding invite modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [editingInvite, setEditingInvite] =
    useState<OnboardingInviteRow | null>(null);

  // Delete confirmation state
  const [proposalToDelete, setProposalToDelete] = useState<ProposalRow | null>(
    null,
  );
  const [inviteToDelete, setInviteToDelete] =
    useState<OnboardingInviteRow | null>(null);

  // ---- Proposal actions ----

  function openEditProposal(p: ProposalRow) {
    setEditingProposal(p);
    setPrefilledProposalData({
      clientName: p.clientName,
      clientEmail: p.clientEmail,
      companyOverview: p.companyOverview,
      packageType: p.packageType,
      setupFee: p.setupFee,
      platformCost: p.platformCost,
      retainerCost: p.retainerCost,
      status: p.status,
    });
    setProposalMode("edit");
    setProposalModalOpen(true);
  }

  function handleDeleteProposal(p: ProposalRow) {
    setProposalToDelete(p);
  }

  async function executeDeleteProposal(p: ProposalRow) {
    setProposalToDelete(null);
    try {
      const res = await fetch(`/api/proposals/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Failed to delete proposal");
        return;
      }
      fetchData();
    } catch {
      alert("Failed to delete proposal. Please try again.");
    }
  }

  // ---- Onboarding invite actions ----

  function openEditInvite(inv: OnboardingInviteRow) {
    setEditingInvite(inv);
    setInviteModalOpen(true);
  }

  function handleDeleteInvite(inv: OnboardingInviteRow) {
    setInviteToDelete(inv);
  }

  async function executeDeleteInvite(inv: OnboardingInviteRow) {
    setInviteToDelete(null);
    try {
      const res = await fetch(`/api/onboarding-invites/${inv.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Failed to delete invite");
        return;
      }
      fetchData();
    } catch {
      alert("Failed to delete invite. Please try again.");
    }
  }

  // ---- Document import ----

  function handleDocumentParsed(parsed: ParsedDocumentFields) {
    setEditingProposal(null);
    setPrefilledProposalData(parsed);
    setProposalMode("create-from-document");
    setProposalModalOpen(true);
  }

  // ---- Handle modal close to refetch ----

  function handleProposalModalChange(open: boolean) {
    setProposalModalOpen(open);
    if (!open) fetchData();
  }

  function handleInviteModalChange(open: boolean) {
    setInviteModalOpen(open);
    if (!open) fetchData();
  }

  if (loading) return <OnboardSkeleton />;
  if (!data) return <p className="text-sm text-muted-foreground">Failed to load data.</p>;

  const { proposals, onboardingInvites, appUrl } = data;

  return (
    <>
      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 mb-4">
        <Link href="/onboard/new">
          <Button size="sm">Create New Proposal</Button>
        </Link>
      </div>

      {/* Document import section */}
      <DocumentUpload onParsed={handleDocumentParsed} />

      {/* Proposals table */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Proposals</h2>
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
                        className={`text-xs ${proposalStatusStyles[p.status] ?? ""}`}
                      >
                        {p.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPence(p.platformCost + p.retainerCost)}/mo
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <CopyLinkButton url={`${appUrl}/p/${p.token}`} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditProposal(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        {p.status === "draft" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteProposal(p)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        )}
                      </div>
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
      </section>

      {/* Onboarding invites table */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Onboarding Invites</h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {onboardingInvites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      {inv.clientName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${inviteStatusStyles[inv.status] ?? ""}`}
                      >
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inv.workspaceSlug ??
                        (inv.createWorkspace ? "(auto)" : "\u2014")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <CopyLinkButton url={`${appUrl}/o/${inv.token}`} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditInvite(inv)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                        {inv.status !== "completed" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteInvite(inv)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {onboardingInvites.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No onboarding invites yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* Proposal form modal */}
      {proposalModalOpen && (
        <ProposalFormModal
          open={proposalModalOpen}
          onOpenChange={handleProposalModalChange}
          proposalId={editingProposal?.id}
          initialData={prefilledProposalData ?? undefined}
          mode={proposalMode}
        />
      )}

      {/* Onboarding invite form modal */}
      {inviteModalOpen && editingInvite && (
        <OnboardingFormModal
          open={inviteModalOpen}
          onOpenChange={handleInviteModalChange}
          invite={
            {
              id: editingInvite.id,
              clientName: editingInvite.clientName,
              clientEmail: editingInvite.clientEmail,
              status: editingInvite.status,
              createWorkspace: editingInvite.createWorkspace,
              workspaceSlug: editingInvite.workspaceSlug,
            } as OnboardingInviteData
          }
        />
      )}

      {/* Delete confirmation dialogs */}
      <ControlledConfirmDialog
        open={proposalToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setProposalToDelete(null);
        }}
        title="Delete Proposal"
        description={`Delete proposal for ${proposalToDelete?.clientName}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() =>
          proposalToDelete && executeDeleteProposal(proposalToDelete)
        }
      />

      <ControlledConfirmDialog
        open={inviteToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setInviteToDelete(null);
        }}
        title="Delete Onboarding Invite"
        description={`Delete onboarding invite for ${inviteToDelete?.clientName}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() =>
          inviteToDelete && executeDeleteInvite(inviteToDelete)
        }
      />
    </>
  );
}
