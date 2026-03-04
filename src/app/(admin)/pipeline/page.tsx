"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MoreHorizontal,
  UserPlus,
  Trash2,
  ArrowRight,
  Search,
  Building2,
  Globe,
  Mail,
  User,
  Clock,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PIPELINE_STATUSES } from "@/lib/clients/task-templates";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prospect {
  id: string;
  name: string;
  pipelineStatus: string;
  contactEmail: string | null;
  contactName: string | null;
  website: string | null;
  companyOverview: string | null;
  notes: string | null;
  createdAt: string;
}

interface ProspectFormData {
  name: string;
  contactEmail: string;
  contactName: string;
  website: string;
  companyOverview: string;
  notes: string;
}

const EMPTY_FORM: ProspectFormData = {
  name: "",
  contactEmail: "",
  contactName: "",
  website: "",
  companyOverview: "",
  notes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString();
}

function getStatusConfig(status: string) {
  return PIPELINE_STATUSES.find((s) => s.value === status) ?? {
    value: status,
    label: status,
    color: "#87909e",
  };
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  onStatusChange,
}: {
  status: string;
  onStatusChange: (newStatus: string) => void;
}) {
  const config = getStatusConfig(status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-opacity hover:opacity-80 focus:outline-none"
          style={{
            backgroundColor: `${config.color}20`,
            color: config.color,
          }}
        >
          {config.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PIPELINE_STATUSES.map((s) => (
          <DropdownMenuItem
            key={s.value}
            onClick={() => onStatusChange(s.value)}
            className="flex items-center gap-2"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Prospect Card ────────────────────────────────────────────────────────────

function ProspectCard({
  prospect,
  onStatusChange,
  onDelete,
  onConvert,
  onEdit,
}: {
  prospect: Prospect;
  onStatusChange: (newStatus: string) => void;
  onDelete: () => void;
  onConvert: () => void;
  onEdit: () => void;
}) {
  const domain = prospect.website
    ? prospect.website.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  return (
    <div
      className="group rounded-lg border border-border/50 bg-card p-3 transition-all hover:border-border hover:shadow-sm cursor-pointer"
      onClick={onEdit}
    >
      {/* Top row: company name + action menu */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          {prospect.pipelineStatus === "closed_won" ? (
            <a
              href={`/clients/${prospect.id}`}
              className="text-sm font-semibold leading-tight hover:underline text-foreground block truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {prospect.name}
            </a>
          ) : (
            <p className="text-sm font-semibold leading-tight text-foreground truncate">
              {prospect.name}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <ArrowRight className="h-4 w-4 mr-2" />
              View / Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onConvert}>
              <UserPlus className="h-4 w-4 mr-2" />
              Convert to Client
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Details */}
      <div className="space-y-1 mb-2.5">
        {prospect.contactName && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{prospect.contactName}</span>
          </div>
        )}
        {prospect.contactEmail && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{prospect.contactEmail}</span>
          </div>
        )}
        {domain && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="h-3 w-3 shrink-0" />
            <a
              href={prospect.website!}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate hover:underline hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              {domain}
            </a>
          </div>
        )}
      </div>

      {/* Bottom row: status badge + time */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
        <StatusBadge status={prospect.pipelineStatus} onStatusChange={onStatusChange} />
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70 shrink-0">
          <Clock className="h-2.5 w-2.5" />
          {relativeTime(prospect.createdAt)}
        </span>
      </div>
    </div>
  );
}

// ─── Skeleton Column ──────────────────────────────────────────────────────────

function SkeletonColumn() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border/30 bg-card p-3 space-y-2"
        >
          <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
          <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
          <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
          <div className="flex items-center justify-between pt-1">
            <div className="h-5 bg-muted rounded-full animate-pulse w-20" />
            <div className="h-3 bg-muted rounded animate-pulse w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  prospects,
  onStatusChange,
  onDelete,
  onConvert,
  onEdit,
}: {
  status: { value: string; label: string; color: string };
  prospects: Prospect[];
  onStatusChange: (id: string, newStatus: string) => void;
  onDelete: (id: string, name: string) => void;
  onConvert: (id: string) => void;
  onEdit: (prospect: Prospect) => void;
}) {
  return (
    <div className="flex flex-col min-h-0">
      {/* Column header */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: status.color }}
        />
        <h3 className="text-sm font-semibold tracking-tight truncate">
          {status.label}
        </h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
          {prospects.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2 flex-1">
        {prospects.map((p) => (
          <ProspectCard
            key={p.id}
            prospect={p}
            onStatusChange={(newStatus) => onStatusChange(p.id, newStatus)}
            onDelete={() => onDelete(p.id, p.name)}
            onConvert={() => onConvert(p.id)}
            onEdit={() => onEdit(p)}
          />
        ))}

        {prospects.length === 0 && (
          <p className="text-xs text-muted-foreground/50 text-center py-6">
            No prospects
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const router = useRouter();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Add Prospect form state
  const [formData, setFormData] = useState<ProspectFormData>({ ...EMPTY_FORM });

  // Edit Prospect state
  const [editingProspect, setEditingProspect] = useState<Prospect | null>(null);
  const [editFormData, setEditFormData] = useState<ProspectFormData>({ ...EMPTY_FORM });
  const [editSubmitting, setEditSubmitting] = useState(false);

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients?isPipeline=true");
      const json = await res.json();
      setProspects(Array.isArray(json) ? json : json.clients ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProspects();
  }, [fetchProspects]);

  // ─── Filtered + grouped data ──────────────────────────────────────────────

  const filtered = useMemo(() => {
    return prospects.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        const matchName = p.name?.toLowerCase().includes(q);
        const matchEmail = p.contactEmail?.toLowerCase().includes(q);
        const matchContact = p.contactName?.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchContact) return false;
      }
      return true;
    });
  }, [prospects, search]);

  const prospectsByStatus = useMemo(() => {
    const grouped: Record<string, Prospect[]> = {};
    for (const status of PIPELINE_STATUSES) {
      grouped[status.value] = [];
    }
    for (const p of filtered) {
      if (grouped[p.pipelineStatus]) {
        grouped[p.pipelineStatus].push(p);
      } else {
        // Unknown status — put in first column
        grouped[PIPELINE_STATUSES[0].value].push(p);
      }
    }
    return grouped;
  }, [filtered]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handleStatusChange(id: string, newStatus: string) {
    // Optimistic update
    setProspects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, pipelineStatus: newStatus } : p))
    );

    try {
      await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineStatus: newStatus }),
      });

      if (newStatus === "closed_won") {
        const prospect = prospects.find((p) => p.id === id);
        const shouldConvert = confirm(
          `"${prospect?.name}" has been marked as Closed Won. Would you like to convert them to a full client now?`
        );
        if (shouldConvert) {
          router.push(`/clients/${id}`);
        }
      }
    } catch {
      // Revert on error
      fetchProspects();
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) {
      return;
    }

    setProspects((prev) => prev.filter((p) => p.id !== id));

    try {
      await fetch(`/api/clients/${id}`, { method: "DELETE" });
    } catch {
      fetchProspects();
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          pipelineStatus: "new_lead",
        }),
      });

      if (res.ok) {
        setDialogOpen(false);
        setFormData({ ...EMPTY_FORM });
        fetchProspects();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConvertToClient(id: string) {
    const prospect = prospects.find((p) => p.id === id);
    if (
      !confirm(
        `Convert "${prospect?.name}" to a client? This will set them to Closed Won and create onboarding tasks.`,
      )
    ) {
      return;
    }

    // Set status to closed_won (backend auto-populates tasks)
    setProspects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, pipelineStatus: "closed_won" } : p,
      ),
    );

    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineStatus: "closed_won" }),
      });

      if (res.ok) {
        router.push(`/clients/${id}`);
      } else {
        fetchProspects();
      }
    } catch {
      fetchProspects();
    }
  }

  function handleEdit(prospect: Prospect) {
    setEditingProspect(prospect);
    setEditFormData({
      name: prospect.name ?? "",
      contactEmail: prospect.contactEmail ?? "",
      contactName: prospect.contactName ?? "",
      website: prospect.website ?? "",
      companyOverview: prospect.companyOverview ?? "",
      notes: prospect.notes ?? "",
    });
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingProspect) return;
    setEditSubmitting(true);

    try {
      const res = await fetch(`/api/clients/${editingProspect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editFormData),
      });

      if (res.ok) {
        setEditingProspect(null);
        fetchProspects();
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <Header
        title="Pipeline"
        description="Track prospects through the sales funnel"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Prospect
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Prospect</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Company Name *</Label>
                  <Input
                    id="name"
                    required
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Acme Corp"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contactEmail">Contact Email</Label>
                    <Input
                      id="contactEmail"
                      type="email"
                      value={formData.contactEmail}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          contactEmail: e.target.value,
                        }))
                      }
                      placeholder="john@acme.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactName">Contact Name</Label>
                    <Input
                      id="contactName"
                      value={formData.contactName}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          contactName: e.target.value,
                        }))
                      }
                      placeholder="John Smith"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={formData.website}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, website: e.target.value }))
                    }
                    placeholder="https://acme.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyOverview">Company Overview</Label>
                  <Textarea
                    id="companyOverview"
                    value={formData.companyOverview}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        companyOverview: e.target.value,
                      }))
                    }
                    placeholder="Brief description of the company..."
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, notes: e.target.value }))
                    }
                    placeholder="Internal notes about this prospect..."
                    rows={2}
                  />
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Adding..." : "Add Prospect"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6 space-y-6">
        {/* Search + count */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search prospects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-64 text-sm"
            />
          </div>

          {!loading && (
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} prospect{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Kanban board */}
        {!loading && prospects.length === 0 && !search ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-1">
              No pipeline deals
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-5">
              Add your first prospect to start tracking deals through the sales pipeline.
            </p>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Prospect
            </Button>
          </div>
        ) : loading ? (
          <>
            {/* Desktop skeleton */}
            <div className="hidden lg:flex gap-4 overflow-x-auto pb-4">
              {PIPELINE_STATUSES.map((status) => (
                <div
                  key={status.value}
                  className="min-w-[280px] flex-1 rounded-lg bg-muted/30 p-3 border border-border/30"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: status.color }}
                    />
                    <div className="h-4 bg-muted rounded animate-pulse w-24" />
                  </div>
                  <SkeletonColumn />
                </div>
              ))}
            </div>
            {/* Mobile skeleton */}
            <div className="lg:hidden rounded-lg bg-muted/30 p-3 border border-border/30">
              <SkeletonColumn />
            </div>
          </>
        ) : filtered.length === 0 && search ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Building2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm">No prospects match your search.</p>
          </div>
        ) : (
          <>
            {/* Desktop: horizontal scrollable columns */}
            <div className="hidden lg:flex gap-4 overflow-x-auto pb-4">
              {PIPELINE_STATUSES.map((status) => (
                <div
                  key={status.value}
                  className={cn(
                    "min-w-[280px] flex-1 rounded-lg bg-muted/30 p-3 border border-border/30",
                    // Slightly dim "done" state columns
                    (status.value === "closed_won" ||
                      status.value === "closed_lost" ||
                      status.value === "unqualified" ||
                      status.value === "churned") &&
                      "opacity-80"
                  )}
                >
                  <KanbanColumn
                    status={status}
                    prospects={prospectsByStatus[status.value] ?? []}
                    onStatusChange={handleStatusChange}
                    onDelete={handleDelete}
                    onConvert={handleConvertToClient}
                    onEdit={handleEdit}
                  />
                </div>
              ))}
            </div>

            {/* Mobile/tablet: tabs */}
            <div className="lg:hidden">
              <Tabs defaultValue="new_lead">
                <TabsList className="w-full overflow-x-auto flex-nowrap justify-start">
                  {PIPELINE_STATUSES.map((status) => {
                    const count = (prospectsByStatus[status.value] ?? []).length;
                    return (
                      <TabsTrigger
                        key={status.value}
                        value={status.value}
                        className="shrink-0"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0 mr-1.5"
                          style={{ backgroundColor: status.color }}
                        />
                        {status.label}
                        {count > 0 && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            {count}
                          </span>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {PIPELINE_STATUSES.map((status) => (
                  <TabsContent key={status.value} value={status.value}>
                    <div className="rounded-lg bg-muted/30 p-3 border border-border/30">
                      <KanbanColumn
                        status={status}
                        prospects={prospectsByStatus[status.value] ?? []}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                        onConvert={handleConvertToClient}
                        onEdit={handleEdit}
                      />
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </>
        )}
      </div>

      {/* ─── Edit Prospect Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={editingProspect !== null}
        onOpenChange={(open) => {
          if (!open) setEditingProspect(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Prospect</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Company Name *</Label>
              <Input
                id="edit-name"
                required
                value={editFormData.name}
                onChange={(e) =>
                  setEditFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Acme Corp"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-contactEmail">Contact Email</Label>
                <Input
                  id="edit-contactEmail"
                  type="email"
                  value={editFormData.contactEmail}
                  onChange={(e) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      contactEmail: e.target.value,
                    }))
                  }
                  placeholder="john@acme.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-contactName">Contact Name</Label>
                <Input
                  id="edit-contactName"
                  value={editFormData.contactName}
                  onChange={(e) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      contactName: e.target.value,
                    }))
                  }
                  placeholder="John Smith"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-website">Website</Label>
              <Input
                id="edit-website"
                value={editFormData.website}
                onChange={(e) =>
                  setEditFormData((prev) => ({ ...prev, website: e.target.value }))
                }
                placeholder="https://acme.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-companyOverview">Company Overview</Label>
              <Textarea
                id="edit-companyOverview"
                value={editFormData.companyOverview}
                onChange={(e) =>
                  setEditFormData((prev) => ({
                    ...prev,
                    companyOverview: e.target.value,
                  }))
                }
                placeholder="Brief description of the company..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editFormData.notes}
                onChange={(e) =>
                  setEditFormData((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Internal notes about this prospect..."
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingProspect(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
