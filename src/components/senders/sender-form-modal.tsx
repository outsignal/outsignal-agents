"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import type { SenderWithWorkspace } from "./types";

interface SenderFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sender?: SenderWithWorkspace;
  workspaces: Array<{ slug: string; name: string }>;
  onSaved?: () => void;
}

interface FormState {
  name: string;
  workspaceSlug: string;
  emailAddress: string;
  linkedinProfileUrl: string;
  linkedinEmail: string;
  proxyUrl: string;
  linkedinTier: string;
  dailyConnectionLimit: string;
  dailyMessageLimit: string;
  dailyProfileViewLimit: string;
}

function getInitialState(sender?: SenderWithWorkspace, defaultWorkspace?: string): FormState {
  return {
    name: sender?.name ?? "",
    workspaceSlug: sender?.workspaceSlug ?? defaultWorkspace ?? "",
    emailAddress: sender?.emailAddress ?? "",
    linkedinProfileUrl: sender?.linkedinProfileUrl ?? "",
    linkedinEmail: sender?.linkedinEmail ?? "",
    proxyUrl: sender?.proxyUrl ?? "",
    linkedinTier: sender?.linkedinTier ?? "free",
    dailyConnectionLimit: String(sender?.dailyConnectionLimit ?? 5),
    dailyMessageLimit: String(sender?.dailyMessageLimit ?? 10),
    dailyProfileViewLimit: String(sender?.dailyProfileViewLimit ?? 15),
  };
}

export function SenderFormModal({ open, onOpenChange, sender, workspaces, onSaved }: SenderFormModalProps) {
  const router = useRouter();
  const isEdit = Boolean(sender);
  const [form, setForm] = useState<FormState>(() => getInitialState(sender, workspaces[0]?.slug));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes or sender changes
  useEffect(() => {
    if (open) {
      setForm(getInitialState(sender, workspaces[0]?.slug));
      setError(null);
    }
  }, [open, sender, workspaces]);

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.workspaceSlug) {
      setError("Workspace is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const url = isEdit ? `/api/senders/${sender!.id}` : "/api/senders";
      const method = isEdit ? "PATCH" : "POST";

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        ...(form.emailAddress && { emailAddress: form.emailAddress.trim() }),
        ...(form.linkedinProfileUrl && { linkedinProfileUrl: form.linkedinProfileUrl.trim() }),
        ...(form.linkedinEmail && { linkedinEmail: form.linkedinEmail.trim() }),
        ...(form.proxyUrl && { proxyUrl: form.proxyUrl.trim() }),
        linkedinTier: form.linkedinTier,
        dailyConnectionLimit: Number(form.dailyConnectionLimit),
        dailyMessageLimit: Number(form.dailyMessageLimit),
        dailyProfileViewLimit: Number(form.dailyProfileViewLimit),
      };

      // workspaceSlug only for create
      if (!isEdit) {
        body.workspaceSlug = form.workspaceSlug;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "An error occurred. Please try again.");
        return;
      }

      onOpenChange(false);
      if (onSaved) {
        onSaved();
      } else {
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit LinkedIn Account" : "Add LinkedIn Account"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sender-name"
              placeholder="John Smith"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
          </div>

          {/* Workspace */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-workspace">
              Workspace <span className="text-destructive">*</span>
            </Label>
            <Select
              value={form.workspaceSlug}
              onValueChange={(v) => updateField("workspaceSlug", v)}
              disabled={isEdit}
            >
              <SelectTrigger id="sender-workspace">
                <SelectValue placeholder="Select workspace..." />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.slug} value={ws.slug}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Email Address */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-email">Email Address</Label>
            <Input
              id="sender-email"
              type="email"
              placeholder="john@example.com"
              value={form.emailAddress}
              onChange={(e) => updateField("emailAddress", e.target.value)}
            />
          </div>

          {/* LinkedIn Profile URL */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-linkedin-url">LinkedIn Profile URL</Label>
            <Input
              id="sender-linkedin-url"
              type="url"
              placeholder="https://linkedin.com/in/johnsmith"
              value={form.linkedinProfileUrl}
              onChange={(e) => updateField("linkedinProfileUrl", e.target.value)}
            />
          </div>

          {/* LinkedIn Email */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-linkedin-email">LinkedIn Email</Label>
            <Input
              id="sender-linkedin-email"
              type="email"
              placeholder="john@gmail.com"
              value={form.linkedinEmail}
              onChange={(e) => updateField("linkedinEmail", e.target.value)}
            />
          </div>

          {/* Proxy URL */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-proxy">Proxy URL</Label>
            <Input
              id="sender-proxy"
              placeholder="http://user:pass@ip:port"
              value={form.proxyUrl}
              onChange={(e) => updateField("proxyUrl", e.target.value)}
            />
          </div>

          {/* LinkedIn Tier */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-tier">LinkedIn Tier</Label>
            <Select
              value={form.linkedinTier}
              onValueChange={(v) => updateField("linkedinTier", v)}
            >
              <SelectTrigger id="sender-tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Daily limits row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sender-conn-limit">Daily Connections</Label>
              <Input
                id="sender-conn-limit"
                type="number"
                min="0"
                max="100"
                value={form.dailyConnectionLimit}
                onChange={(e) => updateField("dailyConnectionLimit", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sender-msg-limit">Daily Messages</Label>
              <Input
                id="sender-msg-limit"
                type="number"
                min="0"
                max="100"
                value={form.dailyMessageLimit}
                onChange={(e) => updateField("dailyMessageLimit", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sender-pv-limit">Daily Profile Views</Label>
              <Input
                id="sender-pv-limit"
                type="number"
                min="0"
                max="200"
                value={form.dailyProfileViewLimit}
                onChange={(e) => updateField("dailyProfileViewLimit", e.target.value)}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save changes" : "Add sender"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
