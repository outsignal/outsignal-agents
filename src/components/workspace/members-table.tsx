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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Send,
} from "lucide-react";

// ---------- types ----------

type MemberRole = "owner" | "admin" | "viewer";
type MemberStatus = "active" | "invited" | "disabled";

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: MemberRole;
  workspaceSlug: string;
  notificationsEnabled: boolean;
  status: MemberStatus;
  invitedAt: string;
  invitedBy: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
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

const statusConfig: Record<MemberStatus, { label: string; variant: "success" | "warning" | "destructive"; icon: typeof CheckCircle2 }> = {
  active: { label: "Active", variant: "success", icon: CheckCircle2 },
  invited: { label: "Invited", variant: "warning", icon: Clock },
  disabled: { label: "Disabled", variant: "destructive", icon: MinusCircle },
};

const roleConfig: Record<MemberRole, { label: string; variant: "purple" | "info" | "secondary" }> = {
  owner: { label: "Owner", variant: "purple" },
  admin: { label: "Admin", variant: "info" },
  viewer: { label: "Viewer", variant: "secondary" },
};

// ---------- component ----------

export function MembersTable({ slug }: MembersTableProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add member dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<MemberRole>("viewer");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Remove member dialog
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // Notification toggle loading
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null);

  // Resend invite loading
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);

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
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim() || undefined,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Failed to add member");
        return;
      }
      setMembers(data.members);
      setNewEmail("");
      setNewName("");
      setNewRole("viewer");
      setAddOpen(false);
    } catch {
      setAddError("Failed to add member");
    } finally {
      setAddLoading(false);
    }
  }

  // --- Remove (soft-disable) member ---
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
        body: JSON.stringify({ email, notificationsEnabled: !current }),
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

  // --- Resend invite ---
  async function handleResendInvite(email: string) {
    setResendingEmail(email);
    try {
      await fetch(`/api/workspace/${slug}/members/resend-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // silently fail
    } finally {
      setResendingEmail(null);
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
            <Button size="sm" onClick={() => { setAddOpen(true); setAddError(null); setNewEmail(""); setNewName(""); setNewRole("viewer"); }}>
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
              No members yet. Add team members to grant access and manage notifications.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Notifications</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const sc = statusConfig[member.status];
                  const rc = roleConfig[member.role];
                  const StatusIcon = sc.icon;
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {member.name || member.email}
                          </span>
                          {member.name && (
                            <span className="text-xs text-muted-foreground">
                              {member.email}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={rc.variant} className="text-xs capitalize">
                          {rc.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={sc.variant} className="text-xs gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {sc.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={member.notificationsEnabled}
                          disabled={togglingEmail === member.email || member.status === "disabled"}
                          onCheckedChange={() =>
                            handleToggleNotifications(member.email, member.notificationsEnabled)
                          }
                          aria-label={`Toggle notifications for ${member.email}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {member.lastLoginAt ? relativeTime(member.lastLoginAt) : "--"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {relativeTime(member.invitedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {member.status === "invited" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-brand"
                              onClick={() => handleResendInvite(member.email)}
                              disabled={resendingEmail === member.email}
                              title="Resend invite"
                            >
                              <Send className={`h-4 w-4 ${resendingEmail === member.email ? "animate-pulse" : ""}`} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                            onClick={() => setRemoveTarget(member.email)}
                            title="Disable member"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
              Add a team member to this workspace. They will receive an invitation and can access the portal.
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
                placeholder="team@company.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="new-member-name" className="text-sm font-medium mb-1.5 block">
                Name <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="new-member-name"
                type="text"
                placeholder="John Smith"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
            </div>
            <div>
              <Label htmlFor="new-member-role" className="text-sm font-medium mb-1.5 block">
                Role
              </Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as MemberRole)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
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

      {/* Disable Member Confirmation */}
      <ControlledConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title="Disable Member"
        description={`Are you sure you want to disable ${removeTarget ?? "this member"}? They will lose portal access and notifications.`}
        confirmLabel="Disable"
        variant="destructive"
        onConfirm={handleRemove}
        disabled={removeLoading}
      />
    </>
  );
}
