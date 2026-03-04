"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Pencil,
  Trash2,
  Key,
} from "lucide-react";
import { SenderFormModal } from "./sender-form-modal";
import { SenderHealthPanel } from "./sender-health-panel";
import type { SenderWithWorkspace } from "./types";

interface SenderCardProps {
  sender: SenderWithWorkspace;
  workspaces: Array<{ slug: string; name: string }>;
}

const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  setup: "secondary",
  active: "success",
  paused: "warning",
  disabled: "destructive",
};

const HEALTH_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  healthy: "success",
  warning: "warning",
  paused: "warning",
  blocked: "destructive",
  session_expired: "destructive",
};

const SESSION_LABEL: Record<string, string> = {
  not_setup: "Not set up",
  active: "Active",
  expired: "Expired",
};

export function SenderCard({ sender, workspaces }: SenderCardProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  const isPaused = sender.status === "paused";
  const isHardFlagged =
    sender.healthStatus === "blocked" || sender.healthStatus === "session_expired";

  async function handleTogglePause() {
    setToggling(true);
    try {
      const res = await fetch(`/api/senders/${sender.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: isPaused ? "active" : "paused" }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Toggle pause failed:", data.error);
      } else {
        router.refresh();
      }
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/senders/${sender.id}`, {
        method: "DELETE",
      });
      if (res.status === 409) {
        const data = await res.json();
        setDeleteError(data.error);
        return;
      }
      if (!res.ok) {
        setDeleteError("Failed to delete sender. Please try again.");
        return;
      }
      setDeleteOpen(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function handleReactivate() {
    setReactivating(true);
    try {
      const res = await fetch(`/api/senders/${sender.id}/reactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Reactivate failed:", data.error);
      } else {
        router.refresh();
      }
    } finally {
      setReactivating(false);
    }
  }

  async function handleCopyToken() {
    if (!sender.inviteToken) return;
    await navigator.clipboard.writeText(sender.inviteToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }

  const proxyDisplay = sender.proxyUrl
    ? sender.proxyUrl.replace(/\/\/[^@]+@/, "//***@")
    : null;

  return (
    <>
      <Card className="flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm leading-tight truncate">{sender.name}</h3>
              {sender.emailAddress && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {sender.emailAddress}
                </p>
              )}
              <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                {sender.workspace.name}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge variant={STATUS_VARIANT[sender.status] ?? "secondary"} size="xs">
                {sender.status}
              </Badge>
              <Badge variant={HEALTH_VARIANT[sender.healthStatus] ?? "secondary"} size="xs">
                {sender.healthStatus.replace("_", " ")}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 space-y-2 text-xs">
          {/* Proxy URL */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Proxy</span>
            <span className="font-mono text-[10px] truncate text-foreground/80">
              {proxyDisplay ?? <span className="text-muted-foreground">Not set</span>}
            </span>
          </div>

          {/* Daily limits */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Limits</span>
            <span className="text-foreground/80">
              {sender.dailyConnectionLimit}c / {sender.dailyMessageLimit}m / {sender.dailyProfileViewLimit}pv
            </span>
          </div>

          {/* LinkedIn tier */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Tier</span>
            <span className="text-foreground/80 capitalize">{sender.linkedinTier}</span>
          </div>

          {/* Session status */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Session</span>
            <span className="text-foreground/80">
              {SESSION_LABEL[sender.sessionStatus] ?? sender.sessionStatus}
            </span>
          </div>

          {/* Warmup day */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Warmup</span>
            <span className="text-foreground/80">
              {sender.warmupDay > 0 ? `Day ${sender.warmupDay}` : "Not started"}
            </span>
          </div>

          {/* Health history toggle */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-1 w-full pt-1 border-t border-border/40"
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0" />
            )}
            Health history
          </button>
        </CardContent>

        {/* Expandable health panel */}
        <SenderHealthPanel senderId={sender.id} isExpanded={expanded} />

        {/* Action bar */}
        <div className="border-t border-border/50 px-4 py-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="ml-auto">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleTogglePause}
                disabled={toggling || sender.status === "disabled" || sender.status === "setup"}
              >
                {isPaused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
                {toggling ? "..." : isPaused ? "Resume" : "Pause"}
              </DropdownMenuItem>
              {isHardFlagged && (
                <DropdownMenuItem
                  onClick={handleReactivate}
                  disabled={reactivating}
                >
                  <RefreshCw className="h-4 w-4" />
                  {reactivating ? "Reactivating..." : "Reactivate"}
                </DropdownMenuItem>
              )}
              {sender.inviteToken && (
                <DropdownMenuItem onClick={handleCopyToken}>
                  {tokenCopied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Key className="h-4 w-4" />
                  )}
                  {tokenCopied ? "Token Copied!" : "Copy Invite Token"}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>

      {/* Edit modal */}
      <SenderFormModal
        open={editOpen}
        onOpenChange={setEditOpen}
        sender={sender}
        workspaces={workspaces}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete sender?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{sender.name}</strong>? This action cannot be undone.
          </p>
          {deleteError && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
