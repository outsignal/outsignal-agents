"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ControlledConfirmDialog,
} from "@/components/ui/confirm-dialog";
import {
  UserPlus,
  Trash2,
  CheckCircle2,
  Clock,
  MinusCircle,
  RefreshCw,
} from "lucide-react";

// ---------- types ----------

interface Member {
  email: string;
  role: "client";
  portalAccess: boolean;
  notifications: boolean;
  lastLogin: string | null;
  status: "active" | "invited" | "never_logged_in";
}

interface MembersTableProps {
  slug: string;
}

// ---------- helpers ----------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const statusConfig = {
  active: { label: "Active", variant: "success" as const, icon: CheckCircle2 },
  invited: { label: "Invited", variant: "warning" as const, icon: Clock },
  never_logged_in: { label: "Never Logged In", variant: "secondary" as const, icon: MinusCircle },
};

// ---------- component ----------

export function MembersTable({ slug }: MembersTableProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add member dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Remove member dialog
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // Notification toggle loading
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/workspace/${slug}/members`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to fetch members");
      }
      const data = await res.json();
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch members");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // --- Add member ---
  async function handleAdd() {
    if (!newEmail.trim()) return;
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/workspace/${slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Failed to add member");
        return;
      }
      setMembers(data.members);
      setNewEmail("");
      setAddOpen(false);
    } catch {
      setAddError("Failed to add member");
    } finally {
      setAddLoading(false);
    }
  }

  // --- Remove member ---
  async function handleRemove() {
    if (!removeTarget) return;
    setRemoveLoading(true);
    try {
      const res = await fetch(`/api/workspace/${slug}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: removeTarget }),
      });
      const data = await res.json();
      if (res.ok) {
        setMembers(data.members);
      }
    } catch {
      // silently fail
    } finally {
      setRemoveLoading(false);
      setRemoveTarget(null);
    }
  }

  // --- Toggle notifications ---
  async function handleToggleNotifications(email: string, current: boolean) {
    setTogglingEmail(email);
    try {
      const res = await fetch(`/api/workspace/${slug}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, notifications: !current }),
      });
      const data = await res.json();
      if (res.ok) {
        setMembers(data.members);
      }
    } catch {
      // silently fail
    } finally {
      setTogglingEmail(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="font-heading">Members</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setLoading(true); fetchMembers(); }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => { setAddOpen(true); setAddError(null); setNewEmail(""); }}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Add Member
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          {loading && members.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Loading members...
            </div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No members configured. Add client emails to grant portal access.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">Portal Access</TableHead>
                  <TableHead className="text-center">Notifications</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const sc = statusConfig[member.status];
                  const StatusIcon = sc.icon;
                  return (
                    <TableRow key={member.email}>
                      <TableCell className="font-medium">
                        {member.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {member.portalAccess ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 inline-block" />
                        ) : (
                          <MinusCircle className="h-4 w-4 text-muted-foreground inline-block" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={member.notifications}
                          disabled={togglingEmail === member.email}
                          onCheckedChange={() =>
                            handleToggleNotifications(member.email, member.notifications)
                          }
                          aria-label={`Toggle notifications for ${member.email}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {member.lastLogin ? relativeTime(member.lastLogin) : "--"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sc.variant} className="text-xs gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {sc.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                          onClick={() => setRemoveTarget(member.email)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Add a client email address to grant portal access and enable notifications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="new-member-email" className="text-sm font-medium mb-1.5 block">
                Email Address
              </Label>
              <Input
                id="new-member-email"
                type="email"
                placeholder="client@company.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                autoFocus
              />
            </div>
            {addError && (
              <p className="text-sm text-red-600">{addError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={addLoading || !newEmail.trim()}>
              {addLoading ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation */}
      <ControlledConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title="Remove Member"
        description={`Are you sure you want to remove ${removeTarget ?? "this member"}? They will lose portal access and notifications.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleRemove}
        disabled={removeLoading}
      />
    </>
  );
}
