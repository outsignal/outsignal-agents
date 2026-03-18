"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserPlus,
  MoreHorizontal,
  Send,
  UserX,
  Trash2,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";

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

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].substring(0, 2).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const statusDot: Record<MemberStatus, string> = {
  active: "bg-[#22c55e]",
  invited: "bg-[#f59e0b]",
  disabled: "bg-stone-300",
};

const statusLabel: Record<MemberStatus, string> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

const roleBadge: Record<MemberRole, { bg: string; text: string }> = {
  owner: { bg: "bg-[#635BFF]", text: "text-white" },
  admin: { bg: "bg-blue-100", text: "text-blue-700" },
  viewer: { bg: "bg-stone-200", text: "text-stone-600" },
};

// ---------- sub-components ----------

function Avatar({ name, email }: { name: string | null; email: string }) {
  return (
    <div className="h-8 w-8 rounded-full bg-[#635BFF] flex items-center justify-center text-white text-xs font-semibold shrink-0">
      {getInitials(name, email)}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635BFF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-[#635BFF]" : "bg-stone-200"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0.5"
        } mt-0.5`}
      />
    </button>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const config = roleBadge[role];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${config.bg} ${config.text}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

function StatusBadge({ status }: { status: MemberStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${statusDot[status]}`} />
      {statusLabel[status]}
    </span>
  );
}

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

  // Disable member dialog
  const [disableTarget, setDisableTarget] = useState<Member | null>(null);
  const [disableLoading, setDisableLoading] = useState(false);

  // Remove member dialog (destructive — type email to confirm)
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removeConfirmEmail, setRemoveConfirmEmail] = useState("");
  const [removeLoading, setRemoveLoading] = useState(false);

  // Inline loading states
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

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

  const activeCount = members.filter((m) => m.status === "active").length;

  // --- Add member ---
  async function handleAdd() {
    const email = newEmail.trim();
    if (!email) return;
    if (!isValidEmail(email)) {
      setAddError("Please enter a valid email address");
      return;
    }
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/workspace/${slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: newName.trim() || undefined, role: newRole }),
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
      toast.success(`Invite sent to ${email}`);
    } catch {
      setAddError("Failed to add member");
    } finally {
      setAddLoading(false);
    }
  }

  // --- Disable member (soft) ---
  async function handleDisable() {
    if (!disableTarget) return;
    setDisableLoading(true);
    try {
      const res = await fetch(`/api/workspace/${slug}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: disableTarget.email }),
      });
      const data = await res.json();
      if (res.ok) {
        setMembers(data.members);
        toast.success(`${disableTarget.name || disableTarget.email} has been disabled`);
      }
    } catch {
      toast.error("Failed to disable member");
    } finally {
      setDisableLoading(false);
      setDisableTarget(null);
    }
  }

  // --- Remove member (permanent) ---
  async function handleRemove() {
    if (!removeTarget || removeConfirmEmail !== removeTarget.email) return;
    setRemoveLoading(true);
    try {
      const res = await fetch(`/api/workspace/${slug}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: removeTarget.email }),
      });
      const data = await res.json();
      if (res.ok) {
        setMembers(data.members);
        toast.success(`${removeTarget.email} has been removed`);
      }
    } catch {
      toast.error("Failed to remove member");
    } finally {
      setRemoveLoading(false);
      setRemoveTarget(null);
      setRemoveConfirmEmail("");
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
      if (res.ok) setMembers(data.members);
    } catch {
      toast.error("Failed to update notifications");
    } finally {
      setTogglingEmail(null);
    }
  }

  // --- Change role ---
  async function handleRoleChange(email: string, role: MemberRole) {
    setUpdatingRole(email);
    try {
      const res = await fetch(`/api/workspace/${slug}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (res.ok) {
        setMembers(data.members);
        toast.success(`Role updated to ${role}`);
      }
    } catch {
      toast.error("Failed to update role");
    } finally {
      setUpdatingRole(null);
    }
  }

  // --- Resend invite ---
  async function handleResendInvite(email: string) {
    setResendingEmail(email);
    try {
      const res = await fetch(`/api/workspace/${slug}/members/resend-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) toast.success(`Invite resent to ${email}`);
      else toast.error("Failed to resend invite");
    } catch {
      toast.error("Failed to resend invite");
    } finally {
      setResendingEmail(null);
    }
  }

  return (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Team Members</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {members.length} member{members.length !== 1 ? "s" : ""} &middot; {activeCount} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setLoading(true); fetchMembers(); }}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            className="bg-[#635BFF] hover:bg-[#5249e0] text-white"
            onClick={() => { setAddOpen(true); setAddError(null); setNewEmail(""); setNewName(""); setNewRole("viewer"); }}
          >
            <UserPlus className="h-4 w-4 mr-1.5" />
            Add Member
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error && (
            <p className="text-sm text-red-600 p-4">{error}</p>
          )}

          {loading && members.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Loading members...
            </div>
          ) : members.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="h-10 w-10 text-stone-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No members yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add your first team member to get started.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-stone-100 hover:bg-transparent">
                      <TableHead className="pl-4">Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notifications</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id} className="border-b border-stone-50 hover:bg-stone-50/50">
                        {/* Member */}
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={member.name} email={member.email} />
                            <div className="min-w-0">
                              {member.name ? (
                                <>
                                  <p className="text-sm font-medium truncate">{member.name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                                </>
                              ) : (
                                <p className="text-sm font-medium truncate">{member.email}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        {/* Role */}
                        <TableCell>
                          {member.role === "owner" ? (
                            <RoleBadge role="owner" />
                          ) : (
                            <Select
                              value={member.role}
                              onValueChange={(v) => handleRoleChange(member.email, v as MemberRole)}
                              disabled={updatingRole === member.email}
                            >
                              <SelectTrigger className="w-[100px] h-7 text-xs border-stone-200">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="viewer">Viewer</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        {/* Status */}
                        <TableCell>
                          <StatusBadge status={member.status} />
                        </TableCell>
                        {/* Notifications */}
                        <TableCell>
                          <Toggle
                            checked={member.notificationsEnabled}
                            disabled={togglingEmail === member.email || member.status === "disabled"}
                            onChange={() => handleToggleNotifications(member.email, member.notificationsEnabled)}
                          />
                        </TableCell>
                        {/* Last Login */}
                        <TableCell className="text-sm text-muted-foreground">
                          {member.lastLoginAt ? relativeTime(member.lastLoginAt) : "Never"}
                        </TableCell>
                        {/* Actions */}
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {member.status === "invited" && (
                                <DropdownMenuItem
                                  onClick={() => handleResendInvite(member.email)}
                                  disabled={resendingEmail === member.email}
                                >
                                  <Send className="h-4 w-4 mr-2" />
                                  Resend Invite
                                </DropdownMenuItem>
                              )}
                              {member.role !== "owner" && member.status !== "disabled" && (
                                <DropdownMenuItem onClick={() => setDisableTarget(member)}>
                                  <UserX className="h-4 w-4 mr-2" />
                                  Disable Member
                                </DropdownMenuItem>
                              )}
                              {member.role !== "owner" && (
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-600"
                                  onClick={() => setRemoveTarget(member)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Remove Member
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card layout */}
              <div className="md:hidden divide-y divide-stone-100">
                {members.map((member) => (
                  <div key={member.id} className="p-4 flex items-start gap-3">
                    <Avatar name={member.name} email={member.email} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {member.name && (
                            <p className="text-sm font-medium truncate">{member.name}</p>
                          )}
                          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {member.status === "invited" && (
                              <DropdownMenuItem onClick={() => handleResendInvite(member.email)}>
                                <Send className="h-4 w-4 mr-2" />
                                Resend Invite
                              </DropdownMenuItem>
                            )}
                            {member.role !== "owner" && member.status !== "disabled" && (
                              <DropdownMenuItem onClick={() => setDisableTarget(member)}>
                                <UserX className="h-4 w-4 mr-2" />
                                Disable
                              </DropdownMenuItem>
                            )}
                            {member.role !== "owner" && (
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-600"
                                onClick={() => setRemoveTarget(member)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Remove
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <RoleBadge role={member.role} />
                        <StatusBadge status={member.status} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              They&apos;ll receive a magic link email to access the portal.
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
                onChange={(e) => { setNewEmail(e.target.value); setAddError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                autoFocus
              />
              {newEmail && !isValidEmail(newEmail) && (
                <p className="text-xs text-red-500 mt-1">Enter a valid email address</p>
              )}
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
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
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
            {addError && <p className="text-sm text-red-600">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              className="bg-[#635BFF] hover:bg-[#5249e0] text-white"
              onClick={handleAdd}
              disabled={addLoading || !newEmail.trim() || !isValidEmail(newEmail)}
            >
              {addLoading ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Member Confirmation */}
      <AlertDialog open={!!disableTarget} onOpenChange={(open) => { if (!open) setDisableTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Member</AlertDialogTitle>
            <AlertDialogDescription>
              {disableTarget?.name || disableTarget?.email} will lose portal access and stop receiving notifications. You can re-enable them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDisable}
              disabled={disableLoading}
            >
              {disableLoading ? "Disabling..." : "Disable Member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove Member Confirmation (destructive — type email) */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => { if (!open) { setRemoveTarget(null); setRemoveConfirmEmail(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member Permanently</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Type <span className="font-mono font-medium text-foreground">{removeTarget?.email}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              placeholder="Type email to confirm"
              value={removeConfirmEmail}
              onChange={(e) => setRemoveConfirmEmail(e.target.value)}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleRemove}
              disabled={removeLoading || removeConfirmEmail !== removeTarget?.email}
            >
              {removeLoading ? "Removing..." : "Remove Member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
