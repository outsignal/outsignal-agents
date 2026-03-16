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
  Archive,
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
import { ControlledConfirmDialog } from "@/components/ui/confirm-dialog";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import { cn } from "@/lib/utils";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";

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

/** Statuses shown as active kanban columns */
const ACTIVE_STATUSES = PIPELINE_STATUSES.filter(
  (s) => !["closed_won", "closed_lost", "unqualified", "churned"].includes(s.value),
);

/** Statuses relegated to the archive section */
const ARCHIVED_STATUSES = new Set(["closed_won", "closed_lost", "unqualified", "churned"]);

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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getStatusConfig(status: string) {
  return PIPELINE_STATUSES.find((s) => s.value === status) ?? {
    value: status,
    label: status,
    color: "#87909e",
  };
}

/** Map pipeline status values to Tailwind classes for badge + dot styling */
const STATUS_BADGE_CLASSES: Record<string, { badge: string; dot: string }> = {
  new_lead:     { badge: "bg-muted text-muted-foreground",    dot: "bg-muted-foreground" },
  contacted:    { badge: "bg-indigo-50 text-indigo-600",   dot: "bg-indigo-500" },
  qualified:    { badge: "bg-indigo-50 text-indigo-600",   dot: "bg-indigo-500" },
  demo:         { badge: "bg-violet-50 text-violet-600",   dot: "bg-violet-500" },
  proposal:     { badge: "bg-amber-50 text-amber-600",     dot: "bg-amber-500" },
  negotiation:  { badge: "bg-orange-50 text-orange-600",   dot: "bg-orange-500" },
  closed_won:   { badge: "bg-green-50 text-green-700",     dot: "bg-green-500" },
  closed_lost:  { badge: "bg-red-50 text-red-700",         dot: "bg-red-500" },
  unqualified:  { badge: "bg-muted text-muted-foreground",     dot: "bg-muted-foreground" },
  churned:      { badge: "bg-rose-50 text-rose-700",       dot: "bg-rose-500" },
};

const FALLBACK_BADGE_CLASSES = { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };

function getStatusClasses(status: string) {
  return STATUS_BADGE_CLASSES[status] ?? FALLBACK_BADGE_CLASSES;
}

// ─── Drag Handle ──────────────────────────────────────────────────────────────

function DragGrip({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-[2px] opacity-0 group-hover:opacity-40 transition-opacity", className)}>
      {/* 6-dot grip pattern (3 rows x 2 cols) */}
      <div className="flex gap-[2px]">
        <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground" />
        <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground" />
      </div>
      <div className="flex gap-[2px]">
        <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground" />
        <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground" />
      </div>
      <div className="flex gap-[2px]">
        <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground" />
        <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground" />
      </div>
    </div>
  );
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
  const classes = getStatusClasses(status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-opacity hover:opacity-80 focus:outline-none",
            classes.badge,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", classes.dot)} />
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
              className={cn("h-2 w-2 rounded-full shrink-0", getStatusClasses(s.value).dot)}
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
  isDragOverlay,
}: {
  prospect: Prospect;
  onStatusChange: (newStatus: string) => void;
  onDelete: () => void;
  onConvert: () => void;
  onEdit: () => void;
  isDragOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({ id: prospect.id });

  const domain = prospect.website
    ? prospect.website.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      className={cn(
        "group flex items-stretch rounded-xl border border-border bg-background shadow-sm transition-all hover:shadow-md cursor-pointer",
        isDragging && "opacity-40",
        isDragOverlay && "shadow-lg ring-2 ring-[#635BFF]/20 rotate-[2deg]",
      )}
      onClick={onEdit}
    >
      {/* Drag handle zone */}
      <div
        {...(isDragOverlay ? {} : listeners)}
        {...(isDragOverlay ? {} : attributes)}
        className="flex items-center justify-center w-6 shrink-0 cursor-grab active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <DragGrip />
      </div>

      {/* Card content */}
      <div className="flex-1 min-w-0 py-2.5 pr-2.5">
        {/* Top row: company name + action menu */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0 flex-1">
            {prospect.pipelineStatus === "closed_won" ? (
              <a
                href={`/clients/${prospect.id}`}
                className="text-sm font-semibold leading-tight text-foreground hover:underline block truncate"
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
                aria-label="Prospect actions"
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
        <div className="space-y-0.5 mb-2">
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
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Clock className="h-2.5 w-2.5" />
            {relativeTime(prospect.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton Column ──────────────────────────────────────────────────────────

function SkeletonColumn() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-background p-3 space-y-2"
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
  isDragging,
}: {
  status: { value: string; label: string; color: string };
  prospects: Prospect[];
  onStatusChange: (id: string, newStatus: string) => void;
  onDelete: (id: string, name: string) => void;
  onConvert: (id: string) => void;
  onEdit: (prospect: Prospect) => void;
  isDragging?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.value });

  return (
    <div className="flex flex-col min-h-0">
      {/* Column header */}
      <div className="mb-3 flex items-center gap-2 px-1">
        <span
          className={cn("h-2 w-2 rounded-full shrink-0", getStatusClasses(status.value).dot)}
        />
        <h3 className="text-sm font-semibold text-foreground tracking-tight truncate">
          {status.label}
        </h3>
        <span className="text-xs font-mono text-muted-foreground shrink-0">
          {prospects.length}
        </span>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-lg transition-all min-h-[80px] p-1",
          isOver && "bg-[#635BFF]/5 ring-2 ring-[#635BFF]/20",
          isDragging && !isOver && "border-2 border-dashed border-[#635BFF]/10 rounded-lg",
        )}
      >
        <div className="space-y-3">
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
        </div>

        {prospects.length === 0 && (
          <div className="flex items-center justify-center h-full min-h-[80px] border-2 border-dashed border-border rounded-lg">
            <p className="text-xs text-muted-foreground">No deals</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Archive Table ────────────────────────────────────────────────────────────

function ArchiveTable({
  prospects,
  onStatusChange,
  onDelete,
  onConvert,
  onEdit,
}: {
  prospects: Prospect[];
  onStatusChange: (id: string, newStatus: string) => void;
  onDelete: (id: string, name: string) => void;
  onConvert: (id: string) => void;
  onEdit: (prospect: Prospect) => void;
}) {
  if (prospects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No archived deals yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
            <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-10"></th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => {
            const classes = getStatusClasses(p.pipelineStatus);
            const config = getStatusConfig(p.pipelineStatus);
            return (
              <tr
                key={p.id}
                className="border-b border-border hover:bg-muted transition-colors cursor-pointer"
                onClick={() => onEdit(p)}
              >
                <td className="py-2.5 px-3 text-muted-foreground font-medium">{p.name}</td>
                <td className="py-2.5 px-3 text-muted-foreground">{p.contactName || p.contactEmail || "—"}</td>
                <td className="py-2.5 px-3">
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <span onClick={(e) => e.stopPropagation()}>
                    <StatusBadge status={p.pipelineStatus} onStatusChange={(ns) => onStatusChange(p.id, ns)} />
                  </span>
                </td>
                <td className="py-2.5 px-3 text-muted-foreground text-xs font-mono">{formatDate(p.createdAt)}</td>
                <td className="py-2.5 px-3 text-right">
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <span onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(p)}>
                          <ArrowRight className="h-4 w-4 mr-2" />
                          View / Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onConvert(p.id)}>
                          <UserPlus className="h-4 w-4 mr-2" />
                          Convert to Client
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(p.id, p.name)}>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

  // Confirmation dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [convertConfirm, setConvertConfirm] = useState<{ id: string; name: string } | null>(null);
  const [closedWonConfirm, setClosedWonConfirm] = useState<{ id: string; name: string } | null>(null);

  // Drag-and-drop state
  const [activeProspect, setActiveProspect] = useState<Prospect | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const prospect = prospects.find((p) => p.id === event.active.id);
    setActiveProspect(prospect ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const prospect = prospects.find((p) => p.id === active.id);
      if (prospect && prospect.pipelineStatus !== over.id) {
        handleStatusChange(prospect.id, over.id as string);
      }
    }
    setActiveProspect(null);
  }

  function handleDragCancel() {
    setActiveProspect(null);
  }

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

  /** Active prospects (shown in kanban columns) */
  const activeFiltered = useMemo(
    () => filtered.filter((p) => !ARCHIVED_STATUSES.has(p.pipelineStatus)),
    [filtered],
  );

  /** Archived prospects (closed_won, closed_lost, unqualified, churned) */
  const archivedFiltered = useMemo(
    () => filtered.filter((p) => ARCHIVED_STATUSES.has(p.pipelineStatus)),
    [filtered],
  );

  const prospectsByStatus = useMemo(() => {
    const grouped: Record<string, Prospect[]> = {};
    for (const status of ACTIVE_STATUSES) {
      grouped[status.value] = [];
    }
    for (const p of activeFiltered) {
      if (grouped[p.pipelineStatus]) {
        grouped[p.pipelineStatus].push(p);
      } else {
        // Unknown status — put in first column
        grouped[ACTIVE_STATUSES[0].value].push(p);
      }
    }
    return grouped;
  }, [activeFiltered]);

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
        setClosedWonConfirm({ id, name: prospect?.name ?? "This prospect" });
      }
    } catch {
      // Revert on error
      fetchProspects();
    }
  }

  function handleDelete(id: string, name: string) {
    setDeleteConfirm({ id, name });
  }

  async function executeDelete(id: string) {
    setDeleteConfirm(null);
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

  function handleConvertToClient(id: string) {
    const prospect = prospects.find((p) => p.id === id);
    setConvertConfirm({ id, name: prospect?.name ?? "This prospect" });
  }

  async function executeConvert(id: string) {
    setConvertConfirm(null);

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
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Search prospects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 w-64 text-sm"
            />
          </div>

          {!loading && (
            <span className="text-xs text-muted-foreground ml-auto font-mono">
              {filtered.length} prospect{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Kanban board */}
        {!loading && prospects.length === 0 && !search ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Building2 className="h-12 w-12 text-muted-foreground/30 mb-4" aria-hidden="true" />
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
              {ACTIVE_STATUSES.map((status) => (
                <div
                  key={status.value}
                  className="min-w-[280px] flex-1 rounded-xl bg-muted p-3"
                >
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <span
                      className={cn("h-2 w-2 rounded-full shrink-0", getStatusClasses(status.value).dot)}
                    />
                    <div className="h-4 bg-muted rounded animate-pulse w-24" />
                  </div>
                  <SkeletonColumn />
                </div>
              ))}
            </div>
            {/* Mobile skeleton */}
            <div className="lg:hidden rounded-xl bg-muted p-3">
              <SkeletonColumn />
            </div>
          </>
        ) : filtered.length === 0 && search ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Building2 className="h-8 w-8 text-muted-foreground/30 mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No prospects match your search.</p>
          </div>
        ) : (
          <>
            {/* Desktop: horizontal scrollable columns with drag-and-drop */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="hidden lg:flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
                {ACTIVE_STATUSES.map((status) => (
                  <div
                    key={status.value}
                    className="min-w-[280px] flex-1 rounded-xl bg-muted p-3 snap-start"
                  >
                    <KanbanColumn
                      status={status}
                      prospects={prospectsByStatus[status.value] ?? []}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                      onConvert={handleConvertToClient}
                      onEdit={handleEdit}
                      isDragging={activeProspect !== null}
                    />
                  </div>
                ))}
              </div>

              <DragOverlay>
                {activeProspect ? (
                  <div className="w-[280px]">
                    <ProspectCard
                      prospect={activeProspect}
                      onStatusChange={() => {}}
                      onDelete={() => {}}
                      onConvert={() => {}}
                      onEdit={() => {}}
                      isDragOverlay
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

            {/* Mobile/tablet: tabs */}
            <div className="lg:hidden">
              <Tabs defaultValue="new_lead">
                <TabsList className="w-full overflow-x-auto flex-nowrap justify-start">
                  {ACTIVE_STATUSES.map((status) => {
                    const count = (prospectsByStatus[status.value] ?? []).length;
                    return (
                      <TabsTrigger
                        key={status.value}
                        value={status.value}
                        className="shrink-0"
                      >
                        <span
                          className={cn("h-2 w-2 rounded-full shrink-0 mr-1.5", getStatusClasses(status.value).dot)}
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

                {ACTIVE_STATUSES.map((status) => (
                  <TabsContent key={status.value} value={status.value}>
                    <div className="rounded-xl bg-muted p-3">
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

            {/* Archive section */}
            {(archivedFiltered.length > 0 || !search) && (
              <CollapsibleSection
                id="pipeline-archive"
                title="Archived"
                defaultCollapsed
                collapsedSummary={
                  <span className="font-mono text-xs">
                    {archivedFiltered.length} deal{archivedFiltered.length !== 1 ? "s" : ""}
                  </span>
                }
                actions={
                  <Archive className="h-4 w-4 text-muted-foreground" />
                }
              >
                <ArchiveTable
                  prospects={archivedFiltered}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onConvert={handleConvertToClient}
                  onEdit={handleEdit}
                />
              </CollapsibleSection>
            )}
          </>
        )}
      </div>

      {/* ─── Confirmation Dialogs ─────────────────────────────────────────── */}
      <ControlledConfirmDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}
        title="Delete Prospect"
        description={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteConfirm && executeDelete(deleteConfirm.id)}
      />

      <ControlledConfirmDialog
        open={convertConfirm !== null}
        onOpenChange={(open) => { if (!open) setConvertConfirm(null); }}
        title="Convert to Client"
        description={`Convert "${convertConfirm?.name}" to a client? This will set them to Closed Won and create onboarding tasks.`}
        confirmLabel="Convert"
        onConfirm={() => convertConfirm && executeConvert(convertConfirm.id)}
      />

      <ControlledConfirmDialog
        open={closedWonConfirm !== null}
        onOpenChange={(open) => { if (!open) setClosedWonConfirm(null); }}
        title="Convert to Full Client?"
        description={`"${closedWonConfirm?.name}" has been marked as Closed Won. Would you like to convert them to a full client now?`}
        confirmLabel="View Client"
        onConfirm={() => {
          if (closedWonConfirm) {
            router.push(`/clients/${closedWonConfirm.id}`);
          }
          setClosedWonConfirm(null);
        }}
      />

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
