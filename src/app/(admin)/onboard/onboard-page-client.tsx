"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
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
import { OnboardingFormModal, type OnboardingInviteData } from "@/components/proposals/onboarding-form-modal";
import {
  DocumentUpload,
  type ParsedDocumentFields,
} from "@/components/proposals/document-upload";
import { FileSignature, Mail, Pencil, Plus, Trash2 } from "lucide-react";
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

interface OnboardPageClientProps {
  proposals: ProposalRow[];
  onboardingInvites: OnboardingInviteRow[];
  appUrl: string;
}

// ---------------------------------------------------------------------------
// Status styles
// ---------------------------------------------------------------------------

const proposalStatusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  onboarding_complete: "bg-brand/20 text-brand-foreground",
};

const inviteStatusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardPageClient({
  proposals,
  onboardingInvites,
  appUrl,
}: OnboardPageClientProps) {
  const router = useRouter();

  // Proposal modal state
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<ProposalRow | null>(null);
  const [prefilledProposalData, setPrefilledProposalData] =
    useState<ProposalFormData | null>(null);
  const [proposalMode, setProposalMode] = useState<
    "edit" | "create-from-document" | "create"
  >("create");

  // Onboarding invite modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [editingInvite, setEditingInvite] = useState<OnboardingInviteRow | null>(
    null,
  );
  const [inviteMode, setInviteMode] = useState<"create" | "edit">("create");

  // Delete confirmation state
  const [proposalToDelete, setProposalToDelete] = useState<ProposalRow | null>(null);
  const [inviteToDelete, setInviteToDelete] = useState<OnboardingInviteRow | null>(null);

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
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete proposal");
        return;
      }
      toast.success("Proposal deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete proposal. Please try again.");
    }
  }

  // ---- Onboarding invite actions ----

  function openCreateInvite() {
    setEditingInvite(null);
    setInviteMode("create");
    setInviteModalOpen(true);
  }

  function openEditInvite(inv: OnboardingInviteRow) {
    setEditingInvite(inv);
    setInviteMode("edit");
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
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete invite");
        return;
      }
      toast.success("Onboarding invite deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete invite. Please try again.");
    }
  }

  // ---- Document import ----

  function handleDocumentParsed(parsed: ParsedDocumentFields) {
    setEditingProposal(null);
    setPrefilledProposalData(parsed);
    setProposalMode("create-from-document");
    setProposalModalOpen(true);
  }

  return (
    <>
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
                      className="h-32"
                    >
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <FileSignature className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No proposals yet</p>
                        <Link href="/onboard/new">
                          <Button variant="outline" size="sm">
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Create Proposal
                          </Button>
                        </Link>
                      </div>
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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Onboarding Invites</h2>
          <Button variant="outline" size="sm" onClick={openCreateInvite}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Invite
          </Button>
        </div>
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
                    <TableCell>
                      <Link
                        href={`/onboard/invite/${inv.id}`}
                        className="font-medium hover:underline"
                      >
                        {inv.clientName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${inviteStatusStyles[inv.status] ?? ""}`}
                      >
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inv.workspaceSlug ?? (inv.createWorkspace ? "(auto)" : "—")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <CopyLinkButton
                          url={`${appUrl}/o/${inv.token}`}
                        />
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
                      className="h-32"
                    >
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <Mail className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">No onboarding invites yet</p>
                        <Button variant="outline" size="sm" onClick={openCreateInvite}>
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Create Invite
                        </Button>
                      </div>
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
          onOpenChange={setProposalModalOpen}
          proposalId={editingProposal?.id}
          initialData={prefilledProposalData ?? undefined}
          mode={proposalMode}
        />
      )}

      {/* Onboarding invite form modal */}
      {inviteModalOpen && (
        <OnboardingFormModal
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          mode={inviteMode}
          invite={
            editingInvite
              ? {
                  id: editingInvite.id,
                  clientName: editingInvite.clientName,
                  clientEmail: editingInvite.clientEmail,
                  status: editingInvite.status,
                  createWorkspace: editingInvite.createWorkspace,
                  workspaceSlug: editingInvite.workspaceSlug,
                } as OnboardingInviteData
              : undefined
          }
        />
      )}

      {/* Delete confirmation dialogs */}
      <ControlledConfirmDialog
        open={proposalToDelete !== null}
        onOpenChange={(open) => { if (!open) setProposalToDelete(null); }}
        title="Delete Proposal"
        description={`Delete proposal for ${proposalToDelete?.clientName}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => proposalToDelete && executeDeleteProposal(proposalToDelete)}
      />

      <ControlledConfirmDialog
        open={inviteToDelete !== null}
        onOpenChange={(open) => { if (!open) setInviteToDelete(null); }}
        title="Delete Onboarding Invite"
        description={`Delete onboarding invite for ${inviteToDelete?.clientName}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => inviteToDelete && executeDeleteInvite(inviteToDelete)}
      />
    </>
  );
}
