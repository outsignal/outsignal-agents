"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Globe,
  Calendar,
  Mail,
  Phone,
  User,
  Briefcase,
} from "lucide-react";

interface ProfileData {
  slug: string;
  name: string;
  vertical: string | null;
  type: string;
  package: string;
  status: string;
  website: string | null;
  targetVolume: string | null;
  onboardingNotes: string | null;
  senderFullName: string | null;
  senderJobTitle: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
  notificationEmails: string | null;
  clientEmails: string | null;
  slackChannelId: string | null;
  billingCompanyName: string | null;
  billingRetainerPence: number | null;
  billingPlatformFeePence: number | null;
  billingRenewalDate: string | null;
  createdAt: string;
}

interface WorkspaceProfileFormProps {
  workspace: ProfileData;
}

function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return json.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

function formatCurrency(pence: number | null): string {
  if (pence === null || pence === undefined) return "Not set";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

const statusVariant: Record<string, "success" | "warning" | "secondary"> = {
  active: "success",
  onboarding: "warning",
  pending_emailbison: "warning",
};

const packageLabels: Record<string, string> = {
  email: "Email Only",
  linkedin: "LinkedIn Only",
  email_linkedin: "Email + LinkedIn",
  consultancy: "Consultancy",
};

const typeLabels: Record<string, string> = {
  client: "Client",
  internal: "Internal",
};

export function WorkspaceProfileForm({ workspace }: WorkspaceProfileFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    vertical: workspace.vertical ?? "",
    website: workspace.website ?? "",
    targetVolume: workspace.targetVolume ?? "",
    onboardingNotes: workspace.onboardingNotes ?? "",
    senderFullName: workspace.senderFullName ?? "",
    senderJobTitle: workspace.senderJobTitle ?? "",
    senderPhone: workspace.senderPhone ?? "",
    senderAddress: workspace.senderAddress ?? "",
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/workspace/${workspace.slug}/configure`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical: form.vertical || null,
          website: form.website || null,
          targetVolume: form.targetVolume || null,
          onboardingNotes: form.onboardingNotes || null,
          senderFullName: form.senderFullName || null,
          senderJobTitle: form.senderJobTitle || null,
          senderPhone: form.senderPhone || null,
          senderAddress: form.senderAddress || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save");
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError("Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  const notificationEmails = parseJsonArray(workspace.notificationEmails);
  const clientEmails = parseJsonArray(workspace.clientEmails);
  const createdDate = new Date(workspace.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const renewalDate = workspace.billingRenewalDate
    ? new Date(workspace.billingRenewalDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Header card - read-only identity */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-heading flex items-center gap-2">
              <Building2 className="h-5 w-5 text-brand" />
              {workspace.name}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant[workspace.status] ?? "secondary"}>
                {workspace.status}
              </Badge>
              <Badge variant="secondary">
                {typeLabels[workspace.type] ?? workspace.type}
              </Badge>
              <Badge variant="secondary">
                {packageLabels[workspace.package] ?? workspace.package}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="font-medium">Slug:</span>
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                {workspace.slug}
              </code>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Created {createdDate}</span>
            </div>
            {workspace.slackChannelId && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="font-medium">Slack:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                  {workspace.slackChannelId}
                </code>
              </div>
            )}
          </div>

          {/* Contacts display */}
          {(notificationEmails.length > 0 || clientEmails.length > 0) && (
            <>
              <Separator className="my-4" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                {notificationEmails.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      Notification Emails
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {notificationEmails.map((email) => (
                        <Badge key={email} variant="secondary" className="text-xs">
                          {email}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {clientEmails.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      Portal Access Emails
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {clientEmails.map((email) => (
                        <Badge key={email} variant="secondary" className="text-xs">
                          {email}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Billing summary */}
          {(workspace.billingCompanyName || workspace.billingRetainerPence) && (
            <>
              <Separator className="my-4" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {workspace.billingCompanyName && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-0.5">
                      Billing Company
                    </p>
                    <p>{workspace.billingCompanyName}</p>
                  </div>
                )}
                {workspace.billingRetainerPence !== null && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-0.5">
                      Monthly Retainer
                    </p>
                    <p>{formatCurrency(workspace.billingRetainerPence)}</p>
                  </div>
                )}
                {renewalDate && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-0.5">
                      Next Renewal
                    </p>
                    <p>{renewalDate}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Editable profile fields */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Profile Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Vertical / Industry" icon={<Briefcase className="h-3.5 w-3.5" />}>
              <Input
                value={form.vertical}
                onChange={(e) => updateField("vertical", e.target.value)}
                placeholder="e.g., Branded Merchandise"
              />
            </FieldRow>
            <FieldRow label="Website" icon={<Globe className="h-3.5 w-3.5" />}>
              <Input
                value={form.website}
                onChange={(e) => updateField("website", e.target.value)}
                placeholder="https://example.com"
              />
            </FieldRow>
          </div>
          <FieldRow label="Target Volume">
            <Input
              value={form.targetVolume}
              onChange={(e) => updateField("targetVolume", e.target.value)}
              placeholder="e.g., 500 leads/month"
            />
          </FieldRow>
        </CardContent>
      </Card>

      {/* Primary contact */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <User className="h-4 w-4 text-brand" />
            Primary Contact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Full Name">
              <Input
                value={form.senderFullName}
                onChange={(e) => updateField("senderFullName", e.target.value)}
                placeholder="Jane Smith"
              />
            </FieldRow>
            <FieldRow label="Job Title">
              <Input
                value={form.senderJobTitle}
                onChange={(e) => updateField("senderJobTitle", e.target.value)}
                placeholder="Marketing Director"
              />
            </FieldRow>
            <FieldRow label="Phone" icon={<Phone className="h-3.5 w-3.5" />}>
              <Input
                value={form.senderPhone}
                onChange={(e) => updateField("senderPhone", e.target.value)}
                placeholder="+44 7XXX XXXXXX"
              />
            </FieldRow>
          </div>
          <FieldRow label="Address">
            <Textarea
              value={form.senderAddress}
              onChange={(e) => updateField("senderAddress", e.target.value)}
              rows={2}
              placeholder="Business address"
            />
          </FieldRow>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={form.onboardingNotes}
            onChange={(e) => updateField("onboardingNotes", e.target.value)}
            rows={4}
            placeholder="Internal notes about this client..."
          />
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="flex items-center gap-3 sticky bottom-4 bg-background/80 backdrop-blur-sm border border-border rounded-lg p-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Profile"}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600 font-medium">
            Profile saved
          </span>
        )}
        {error && (
          <span className="text-sm text-red-600 font-medium">{error}</span>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      {children}
    </div>
  );
}
