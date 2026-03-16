"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { STAGES, CAMPAIGN_TYPES } from "@/lib/clients/task-templates";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StageProgress {
  stage: string;
  total: number;
  completed: number;
  percentage: number;
}

interface Client {
  id: string;
  name: string;
  pipelineStatus: string;
  campaignType: string;
  workspaceSlug: string | null;
  workspaceType?: string;
  contactEmail: string | null;
  contactName: string | null;
  stageProgress: StageProgress[];
  outstandingTasks: number;
  overdueTasks: number;
  createdAt: string;
}

interface ClientsResponse {
  clients: Client[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_WORKSPACES = [
  { slug: "rise", label: "Rise" },
  { slug: "lime-recruitment", label: "Lime Recruitment" },
  { slug: "yoopknows", label: "YoopKnows" },
  { slug: "outsignal", label: "Outsignal" },
  { slug: "myacq", label: "MyAcq" },
  { slug: "1210-solutions", label: "1210 Solutions" },
];

const campaignTypeBadge: Record<string, { label: string; variant: "default" | "secondary" | "brand" }> = {
  email: { label: "Email Only", variant: "secondary" },
  email_linkedin: { label: "Email + LinkedIn", variant: "brand" },
  scale: { label: "Scale", variant: "default" },
};

// All 4 stages in order for progress rendering
const STAGE_KEYS = STAGES.map((s) => s.value);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getCampaignLabel(type: string): string {
  return campaignTypeBadge[type]?.label ?? type;
}

function getCampaignVariant(type: string): "default" | "secondary" | "brand" {
  return campaignTypeBadge[type]?.variant ?? "secondary";
}

// ─── Stage Progress Bar ──────────────────────────────────────────────────────

function StageProgressBar({ stageProgress }: { stageProgress: StageProgress[] }) {
  // Build a map for quick lookup
  const progressMap = new Map(stageProgress.map((sp) => [sp.stage, sp]));

  return (
    <div className="flex gap-1">
      {STAGE_KEYS.map((stageKey) => {
        const stage = progressMap.get(stageKey);
        const percentage = stage?.percentage ?? 0;
        const completed = stage?.completed ?? 0;
        const total = stage?.total ?? 0;

        return (
          <div key={stageKey} className="flex flex-col items-center gap-0.5">
            <div className="h-1.5 w-8 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  percentage === 100
                    ? "bg-emerald-500"
                    : percentage > 0
                      ? "bg-amber-400"
                      : "bg-muted",
                )}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {completed}/{total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Skeleton Rows ───────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i} className="border-border">
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-28" />
          </TableCell>
          <TableCell>
            <div className="h-5 bg-muted rounded-full animate-pulse w-24" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-20" />
          </TableCell>
          <TableCell>
            <div className="flex gap-1">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-3 bg-muted rounded animate-pulse w-8" />
              ))}
            </div>
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-20" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ─── Add Client Dialog ──────────────────────────────────────────────────────

interface AddClientFormData {
  name: string;
  contactEmail: string;
  contactName: string;
  website: string;
  campaignType: string;
  workspaceSlug: string;
  populateTasks: boolean;
}

function AddClientDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<AddClientFormData>({
    name: "",
    contactEmail: "",
    contactName: "",
    website: "",
    campaignType: "email_linkedin",
    workspaceSlug: "",
    populateTasks: true,
  });

  function resetForm() {
    setForm({
      name: "",
      contactEmail: "",
      contactName: "",
      website: "",
      campaignType: "email_linkedin",
      workspaceSlug: "",
      populateTasks: true,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        campaignType: form.campaignType,
        pipelineStatus: form.populateTasks ? "closed_won" : "closed_won",
      };
      if (form.contactEmail.trim()) body.contactEmail = form.contactEmail.trim();
      if (form.contactName.trim()) body.contactName = form.contactName.trim();
      if (form.website.trim()) body.website = form.website.trim();
      if (form.workspaceSlug) body.workspaceSlug = form.workspaceSlug;

      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        resetForm();
        setOpen(false);
        onCreated();
        toast.success("Client created");
      } else {
        toast.error("Failed to create client");
      }
    } catch {
      toast.error("Failed to create client");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Client
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Client</DialogTitle>
            <DialogDescription>
              Create a new active client. Tasks will be populated from the
              campaign template.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                placeholder="Acme Corp"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contactName">Contact Name</Label>
                <Input
                  id="contactName"
                  placeholder="John Smith"
                  value={form.contactName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      contactName: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contactEmail">Contact Email</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  placeholder="john@acme.com"
                  value={form.contactEmail}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      contactEmail: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                placeholder="https://acme.com"
                value={form.website}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, website: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Campaign Type</Label>
                <Select
                  value={form.campaignType}
                  onValueChange={(val) =>
                    setForm((prev) => ({ ...prev, campaignType: val }))
                  }
                >
                  <SelectTrigger aria-label="Campaign type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_TYPES.map((ct) => (
                      <SelectItem key={ct.value} value={ct.value}>
                        {ct.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Link Workspace</Label>
                <Select
                  value={form.workspaceSlug || "none"}
                  onValueChange={(val) =>
                    setForm((prev) => ({
                      ...prev,
                      workspaceSlug: val === "none" ? "" : val,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Link workspace">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {KNOWN_WORKSPACES.map((ws) => (
                      <SelectItem key={ws.slug} value={ws.slug}>
                        {ws.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="populateTasks"
                checked={form.populateTasks}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({
                    ...prev,
                    populateTasks: checked === true,
                  }))
                }
              />
              <Label
                htmlFor="populateTasks"
                className="text-sm font-normal cursor-pointer"
              >
                Populate task board from template
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!form.name.trim() || submitting}>
              {submitting ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients?isPipeline=false");
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const clients = data?.clients ?? [];

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => {
      // Clients with outstanding tasks first
      if (a.outstandingTasks > 0 && b.outstandingTasks === 0) return -1;
      if (a.outstandingTasks === 0 && b.outstandingTasks > 0) return 1;
      // Within outstanding, sort by overdue count descending
      if (a.outstandingTasks > 0 && b.outstandingTasks > 0) {
        if (a.overdueTasks !== b.overdueTasks) return b.overdueTasks - a.overdueTasks;
      }
      return 0; // preserve server order otherwise
    });
  }, [clients]);

  return (
    <div>
      <Header
        title="Clients"
        description="Manage active clients and their lifecycle"
        actions={<AddClientDialog onCreated={fetchClients} />}
      />

      <div className="p-6 space-y-6">
        {/* Summary */}
        {data && !loading && (
          <div className="mb-6">
            <span className="text-xs text-muted-foreground">
              {clients.length} active client{clients.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Campaign Type</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Stage Progress</TableHead>
                  <TableHead>Tasks</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows />
                ) : clients.length > 0 ? (
                  sortedClients.map((client) => {
                    const totalTasks = client.stageProgress.reduce((sum, s) => sum + s.total, 0);
                    const completedTasks = client.stageProgress.reduce((sum, s) => sum + s.completed, 0);
                    return (
                      <TableRow key={client.id} className="border-border">
                        <TableCell>
                          <div className="flex items-center">
                            <Link
                              href={`/clients/${client.id}`}
                              className="font-medium text-sm hover:underline"
                            >
                              {client.name}
                            </Link>
                            {client.workspaceType === "internal" && (
                              <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                                Internal
                              </Badge>
                            )}
                            {client.overdueTasks > 0 ? (
                              <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">
                                {client.overdueTasks} overdue
                              </Badge>
                            ) : client.outstandingTasks > 0 ? (
                              <Badge variant="warning" className="ml-2 text-[10px] px-1.5 py-0">
                                {client.outstandingTasks} pending
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getCampaignVariant(client.campaignType)}>
                            {getCampaignLabel(client.campaignType)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {client.workspaceSlug ? (
                            <Link
                              href={`/workspace/${client.workspaceSlug}`}
                              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {client.workspaceSlug}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StageProgressBar
                            stageProgress={client.stageProgress}
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {completedTasks}/{totalTasks}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(client.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Users className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                        <p className="text-sm">
                          No active clients yet. Convert a prospect from the
                          pipeline or add one directly.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
