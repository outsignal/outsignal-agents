"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  ExternalLink,
  Mail,
  User,
  Calendar,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  STAGES,
  PIPELINE_STATUSES,
  CAMPAIGN_TYPES,
} from "@/lib/clients/task-templates";
import type { ClientDetail } from "@/lib/clients/operations";
import { ClientTaskBoard } from "@/components/clients/client-task-board";

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div>
      <header className="flex items-center justify-between border-b border-border/50 px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 bg-muted rounded animate-pulse" />
          <div className="h-6 w-48 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-16 bg-muted rounded animate-pulse" />
          <div className="h-8 w-16 bg-muted rounded animate-pulse" />
        </div>
      </header>
      <div className="p-8 space-y-6">
        <div className="h-40 bg-muted/50 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-64 bg-muted/30 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPipelineStatusConfig(status: string) {
  return (
    PIPELINE_STATUSES.find((s) => s.value === status) ?? {
      value: status,
      label: status,
      color: "#87909e",
    }
  );
}

function getCampaignTypeLabel(type: string) {
  return CAMPAIGN_TYPES.find((t) => t.value === type)?.label ?? type;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // ─── Fetch client ───────────────────────────────────────────────────

  const fetchClient = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Client not found");
          return;
        }
        throw new Error("Failed to fetch client");
      }
      const data = await res.json();
      setClient(data.client);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch client");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  // ─── Delete handler ─────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this client? This cannot be undone.")) {
      return;
    }

    setDeleting(true);

    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete client");
      router.push("/clients");
    } catch {
      setDeleting(false);
    }
  }

  // ─── Pipeline status change ─────────────────────────────────────────

  async function handleStatusChange(newStatus: string) {
    if (!client || updatingStatus) return;

    const previousStatus = client.pipelineStatus;

    // Optimistic
    setClient((prev) =>
      prev ? { ...prev, pipelineStatus: newStatus } : prev,
    );
    setUpdatingStatus(true);

    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineStatus: newStatus }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      // Re-fetch to get any auto-populated tasks (e.g., when moving to closed_won)
      fetchClient();
    } catch {
      // Rollback
      setClient((prev) =>
        prev ? { ...prev, pipelineStatus: previousStatus } : prev,
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  // ─── Loading / Error states ─────────────────────────────────────────

  if (loading) return <PageSkeleton />;

  if (error || !client) {
    return (
      <div>
        <Header title="Client Not Found" />
        <div className="p-8">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error ?? "Client not found"}
          </div>
          <Link
            href="/clients"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Clients
          </Link>
        </div>
      </div>
    );
  }

  // ─── Pipeline status config ─────────────────────────────────────────

  const statusConfig = getPipelineStatusConfig(client.pipelineStatus);

  return (
    <div>
      {/* Header */}
      <Header
        title={client.name}
        description={
          client.contactName
            ? `Contact: ${client.contactName}`
            : undefined
        }
        actions={
          <>
            <Link
              href="/clients"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Clients
            </Link>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/clients/${clientId}/edit`}>
                <Pencil className="h-4 w-4 mr-1.5" />
                Edit
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="text-destructive hover:text-destructive"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1.5" />
              )}
              Delete
            </Button>
          </>
        }
      />

      <div className="p-8 space-y-6">
        {/* Info card */}
        <Card>
          <CardContent className="pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Pipeline status with dropdown */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                  Pipeline Status
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={updatingStatus}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted cursor-pointer disabled:opacity-50"
                      style={{
                        borderColor: statusConfig.color + "40",
                        backgroundColor: statusConfig.color + "15",
                        color: statusConfig.color,
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: statusConfig.color }}
                      />
                      {statusConfig.label}
                      <ChevronDown className="h-3 w-3 ml-0.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {PIPELINE_STATUSES.map((ps) => (
                      <DropdownMenuItem
                        key={ps.value}
                        onClick={() => handleStatusChange(ps.value)}
                        className="gap-2"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: ps.color }}
                        />
                        {ps.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Campaign type */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                  Campaign Type
                </p>
                <Badge variant="secondary" className="text-xs">
                  {getCampaignTypeLabel(client.campaignType)}
                </Badge>
              </div>

              {/* Workspace link */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                  Workspace
                </p>
                {client.workspaceSlug ? (
                  <Link
                    href={`/workspace/${client.workspaceSlug}`}
                    className="inline-flex items-center gap-1 text-sm text-brand-foreground hover:underline"
                  >
                    {client.workspaceSlug}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Not linked
                  </span>
                )}
              </div>

              {/* Contact info */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                  Contact
                </p>
                <div className="space-y-1">
                  {client.contactName && (
                    <div className="flex items-center gap-1.5 text-sm">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      {client.contactName}
                    </div>
                  )}
                  {client.contactEmail && (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <a
                        href={`mailto:${client.contactEmail}`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {client.contactEmail}
                      </a>
                    </div>
                  )}
                  {!client.contactName && !client.contactEmail && (
                    <span className="text-sm text-muted-foreground">--</span>
                  )}
                </div>
              </div>
            </div>

            {/* Second row: started date + website */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border/50">
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wider">
                  Started
                </p>
                <div className="flex items-center gap-1.5 text-sm">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {client.startedAt
                    ? new Date(client.startedAt).toLocaleDateString()
                    : "Not started"}
                </div>
              </div>

              {client.website && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wider">
                    Website
                  </p>
                  <a
                    href={
                      client.website.startsWith("http")
                        ? client.website
                        : `https://${client.website}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                  >
                    {client.website}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Notes (expandable) */}
            {client.notes && (
              <div className="mt-4 pt-4 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => setNotesExpanded(!notesExpanded)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  Notes
                  {notesExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
                {notesExpanded && (
                  <p className="mt-2 text-sm text-foreground/80 whitespace-pre-wrap">
                    {client.notes}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Task board */}
        {client.tasks.length > 0 ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-heading font-semibold tracking-tight">
                Task Board
              </h2>
              <div className="flex items-center gap-3">
                {client.stageProgress.map((sp) => (
                  <span
                    key={sp.stage}
                    className="text-xs text-muted-foreground"
                  >
                    {STAGES.find((s) => s.value === sp.stage)?.label}:{" "}
                    <span
                      className={cn(
                        "font-medium",
                        sp.percentage === 100 && "text-emerald-500",
                      )}
                    >
                      {sp.percentage}%
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <ClientTaskBoard
              tasks={client.tasks}
              clientId={clientId}
              onTaskUpdate={fetchClient}
            />
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground text-sm">
                No tasks yet. Tasks are automatically created when the client
                status is set to{" "}
                <span className="font-medium text-emerald-500">
                  Closed Won
                </span>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
