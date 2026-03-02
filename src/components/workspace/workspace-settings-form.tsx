"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface WorkspaceData {
  slug: string;
  name: string;
  vertical: string | null;
  apiToken: string;
  status: string;
  slackChannelId: string | null;
  notificationEmails: string | null;
  linkedinUsername: string | null;
  linkedinPasswordNote: string | null;
  senderFullName: string | null;
  senderJobTitle: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
  icpCountries: string | null;
  icpIndustries: string | null;
  icpCompanySize: string | null;
  icpDecisionMakerTitles: string | null;
  icpKeywords: string | null;
  icpExclusionCriteria: string | null;
  coreOffers: string | null;
  pricingSalesCycle: string | null;
  differentiators: string | null;
  painPoints: string | null;
  caseStudies: string | null;
  leadMagnets: string | null;
  existingMessaging: string | null;
  supportingMaterials: string | null;
  exclusionList: string | null;
  website: string | null;
  senderEmailDomains: string | null;
  targetVolume: string | null;
  onboardingNotes: string | null;
  clientEmails: string | null;
}

interface WorkspaceSettingsFormProps {
  workspace: WorkspaceData;
}

function parseEmails(json: string | null): string {
  if (!json) return "";
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.join(", ") : "";
  } catch {
    return json;
  }
}

export function WorkspaceSettingsForm({ workspace }: WorkspaceSettingsFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: workspace.name,
    vertical: workspace.vertical ?? "",
    website: workspace.website ?? "",
    targetVolume: workspace.targetVolume ?? "",
    notificationEmails: parseEmails(workspace.notificationEmails),
    senderFullName: workspace.senderFullName ?? "",
    senderJobTitle: workspace.senderJobTitle ?? "",
    senderPhone: workspace.senderPhone ?? "",
    senderAddress: workspace.senderAddress ?? "",
    linkedinUsername: workspace.linkedinUsername ?? "",
    icpCountries: workspace.icpCountries ?? "",
    icpIndustries: workspace.icpIndustries ?? "",
    icpCompanySize: workspace.icpCompanySize ?? "",
    icpDecisionMakerTitles: workspace.icpDecisionMakerTitles ?? "",
    icpKeywords: workspace.icpKeywords ?? "",
    icpExclusionCriteria: workspace.icpExclusionCriteria ?? "",
    coreOffers: workspace.coreOffers ?? "",
    pricingSalesCycle: workspace.pricingSalesCycle ?? "",
    differentiators: workspace.differentiators ?? "",
    painPoints: workspace.painPoints ?? "",
    caseStudies: workspace.caseStudies ?? "",
    leadMagnets: workspace.leadMagnets ?? "",
    existingMessaging: workspace.existingMessaging ?? "",
    supportingMaterials: workspace.supportingMaterials ?? "",
    exclusionList: workspace.exclusionList ?? "",
    onboardingNotes: workspace.onboardingNotes ?? "",
    clientEmails: parseEmails(workspace.clientEmails),
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
      // Convert email fields to JSON arrays
      const emails = form.notificationEmails
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      const clientEmailList = form.clientEmails
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      const res = await fetch(`/api/workspace/${workspace.slug}/configure`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          vertical: form.vertical || null,
          website: form.website || null,
          targetVolume: form.targetVolume || null,
          notificationEmails: emails.length > 0 ? emails : null,
          senderFullName: form.senderFullName || null,
          senderJobTitle: form.senderJobTitle || null,
          senderPhone: form.senderPhone || null,
          senderAddress: form.senderAddress || null,
          linkedinUsername: form.linkedinUsername || null,
          icpCountries: form.icpCountries || null,
          icpIndustries: form.icpIndustries || null,
          icpCompanySize: form.icpCompanySize || null,
          icpDecisionMakerTitles: form.icpDecisionMakerTitles || null,
          icpKeywords: form.icpKeywords || null,
          icpExclusionCriteria: form.icpExclusionCriteria || null,
          coreOffers: form.coreOffers || null,
          pricingSalesCycle: form.pricingSalesCycle || null,
          differentiators: form.differentiators || null,
          painPoints: form.painPoints || null,
          caseStudies: form.caseStudies || null,
          leadMagnets: form.leadMagnets || null,
          existingMessaging: form.existingMessaging || null,
          supportingMaterials: form.supportingMaterials || null,
          exclusionList: form.exclusionList || null,
          onboardingNotes: form.onboardingNotes || null,
          clientEmails: clientEmailList.length > 0 ? clientEmailList : null,
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
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Save button bar */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600 font-medium">
            Settings saved
          </span>
        )}
        {error && (
          <span className="text-sm text-red-600 font-medium">{error}</span>
        )}
      </div>

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldRow label="Company Name">
            <Input
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Vertical / Industry">
            <Input
              value={form.vertical}
              onChange={(e) => updateField("vertical", e.target.value)}
              placeholder="e.g., Branded Merchandise"
            />
          </FieldRow>
          <FieldRow label="Website">
            <Input
              value={form.website}
              onChange={(e) => updateField("website", e.target.value)}
              placeholder="https://example.com"
            />
          </FieldRow>
          <FieldRow label="Target Volume">
            <Input
              value={form.targetVolume}
              onChange={(e) => updateField("targetVolume", e.target.value)}
              placeholder="e.g., 500 leads/month"
            />
          </FieldRow>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {workspace.slackChannelId && (
            <FieldRow label="Slack Channel">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {workspace.slackChannelId}
                </Badge>
                <span className="text-xs text-muted-foreground">Connected</span>
              </div>
            </FieldRow>
          )}
          <FieldRow label="Notification Emails">
            <Input
              value={form.notificationEmails}
              onChange={(e) =>
                updateField("notificationEmails", e.target.value)
              }
              placeholder="email@example.com, another@example.com"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Comma-separated email addresses for notifications
            </p>
          </FieldRow>
          <FieldRow label="Client Portal Emails">
            <Input
              value={form.clientEmails}
              onChange={(e) =>
                updateField("clientEmails", e.target.value)
              }
              placeholder="client@company.com, another@company.com"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Comma-separated emails authorized to log into the client portal
            </p>
          </FieldRow>
        </CardContent>
      </Card>

      {/* Sender Details */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Sender Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Full Name">
              <Input
                value={form.senderFullName}
                onChange={(e) =>
                  updateField("senderFullName", e.target.value)
                }
              />
            </FieldRow>
            <FieldRow label="Job Title">
              <Input
                value={form.senderJobTitle}
                onChange={(e) =>
                  updateField("senderJobTitle", e.target.value)
                }
              />
            </FieldRow>
            <FieldRow label="Phone">
              <Input
                value={form.senderPhone}
                onChange={(e) =>
                  updateField("senderPhone", e.target.value)
                }
              />
            </FieldRow>
            <FieldRow label="LinkedIn Username">
              <Input
                value={form.linkedinUsername}
                onChange={(e) =>
                  updateField("linkedinUsername", e.target.value)
                }
              />
            </FieldRow>
          </div>
          <FieldRow label="Address">
            <Textarea
              value={form.senderAddress}
              onChange={(e) =>
                updateField("senderAddress", e.target.value)
              }
              rows={2}
            />
          </FieldRow>
        </CardContent>
      </Card>

      {/* ICP */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">
            Ideal Customer Profile (ICP)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Countries">
              <Input
                value={form.icpCountries}
                onChange={(e) =>
                  updateField("icpCountries", e.target.value)
                }
                placeholder="United Kingdom, United States"
              />
            </FieldRow>
            <FieldRow label="Industries">
              <Input
                value={form.icpIndustries}
                onChange={(e) =>
                  updateField("icpIndustries", e.target.value)
                }
                placeholder="SaaS, Fintech, Healthcare"
              />
            </FieldRow>
            <FieldRow label="Company Size">
              <Input
                value={form.icpCompanySize}
                onChange={(e) =>
                  updateField("icpCompanySize", e.target.value)
                }
                placeholder="50-500 employees"
              />
            </FieldRow>
            <FieldRow label="Decision Maker Titles">
              <Input
                value={form.icpDecisionMakerTitles}
                onChange={(e) =>
                  updateField("icpDecisionMakerTitles", e.target.value)
                }
                placeholder="Marketing Manager, CEO"
              />
            </FieldRow>
          </div>
          <FieldRow label="Keywords">
            <Textarea
              value={form.icpKeywords}
              onChange={(e) => updateField("icpKeywords", e.target.value)}
              rows={2}
              placeholder="branded merchandise, corporate gifting"
            />
          </FieldRow>
          <FieldRow label="Exclusion Criteria">
            <Textarea
              value={form.icpExclusionCriteria}
              onChange={(e) =>
                updateField("icpExclusionCriteria", e.target.value)
              }
              rows={2}
              placeholder="Who to exclude from targeting"
            />
          </FieldRow>
        </CardContent>
      </Card>

      {/* Campaign Brief */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Campaign Brief</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldRow label="Core Offers">
            <Textarea
              value={form.coreOffers}
              onChange={(e) => updateField("coreOffers", e.target.value)}
              rows={3}
              placeholder="Main products/services"
            />
          </FieldRow>
          <FieldRow label="Differentiators">
            <Textarea
              value={form.differentiators}
              onChange={(e) =>
                updateField("differentiators", e.target.value)
              }
              rows={3}
              placeholder="What makes them unique"
            />
          </FieldRow>
          <FieldRow label="Pain Points">
            <Textarea
              value={form.painPoints}
              onChange={(e) => updateField("painPoints", e.target.value)}
              rows={3}
              placeholder="Customer problems they solve"
            />
          </FieldRow>
          <FieldRow label="Pricing / Sales Cycle">
            <Textarea
              value={form.pricingSalesCycle}
              onChange={(e) =>
                updateField("pricingSalesCycle", e.target.value)
              }
              rows={2}
            />
          </FieldRow>
          <FieldRow label="Case Studies">
            <Textarea
              value={form.caseStudies}
              onChange={(e) => updateField("caseStudies", e.target.value)}
              rows={3}
            />
          </FieldRow>
          <FieldRow label="Lead Magnets">
            <Textarea
              value={form.leadMagnets}
              onChange={(e) => updateField("leadMagnets", e.target.value)}
              rows={2}
            />
          </FieldRow>
          <FieldRow label="Existing Messaging">
            <Textarea
              value={form.existingMessaging}
              onChange={(e) =>
                updateField("existingMessaging", e.target.value)
              }
              rows={3}
            />
          </FieldRow>
          <FieldRow label="Supporting Materials">
            <Textarea
              value={form.supportingMaterials}
              onChange={(e) =>
                updateField("supportingMaterials", e.target.value)
              }
              rows={2}
            />
          </FieldRow>
          <FieldRow label="Exclusion List">
            <Textarea
              value={form.exclusionList}
              onChange={(e) =>
                updateField("exclusionList", e.target.value)
              }
              rows={2}
              placeholder="Domains/companies to exclude"
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
            onChange={(e) =>
              updateField("onboardingNotes", e.target.value)
            }
            rows={4}
            placeholder="Any additional notes about this workspace..."
          />
        </CardContent>
      </Card>

      {/* Bottom save button */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600 font-medium">
            Settings saved
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-sm font-medium mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
