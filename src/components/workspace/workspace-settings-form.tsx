"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, User, Target, FileText, Package } from "lucide-react";
import type { WorkspaceModule, QuotaUsage } from "@/lib/workspaces/quota";

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

interface PackageData {
  slug: string;
  enabledModules: WorkspaceModule[];
  monthlyLeadQuota: number;
  monthlyLeadQuotaStatic: number;
  monthlyLeadQuotaSignal: number;
  monthlyCampaignAllowance: number;
  usage: QuotaUsage;
}

interface WorkspaceSettingsFormProps {
  workspace: WorkspaceData;
  packageData?: PackageData | null;
}

const ALL_MODULES: { value: WorkspaceModule; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "email-signals", label: "Email Signals" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "linkedin-signals", label: "LinkedIn Signals" },
];

function parseEmails(json: string | null): string {
  if (!json) return "";
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.join(", ") : "";
  } catch {
    return json;
  }
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{used.toLocaleString()} used</span>
        <span>{total.toLocaleString()} limit</span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-800 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all ${isHigh ? "bg-amber-400 dark:bg-amber-500" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WorkspaceSettingsForm({ workspace, packageData }: WorkspaceSettingsFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Package state
  const [pkgSaving, setPkgSaving] = useState(false);
  const [pkgSaved, setPkgSaved] = useState(false);
  const [pkgError, setPkgError] = useState<string | null>(null);
  const [selectedModules, setSelectedModules] = useState<WorkspaceModule[]>(
    packageData?.enabledModules ?? [],
  );
  const [monthlyLeadQuota, setMonthlyLeadQuota] = useState(
    String(packageData?.monthlyLeadQuota ?? 2000),
  );
  const [monthlyLeadQuotaStatic, setMonthlyLeadQuotaStatic] = useState(
    String(packageData?.monthlyLeadQuotaStatic ?? 2000),
  );
  const [monthlyLeadQuotaSignal, setMonthlyLeadQuotaSignal] = useState(
    String(packageData?.monthlyLeadQuotaSignal ?? 0),
  );
  const [monthlyCampaignAllowance, setMonthlyCampaignAllowance] = useState(
    String(packageData?.monthlyCampaignAllowance ?? 2),
  );

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

  async function handleProvision() {
    setProvisioning(true);
    setProvisionError(null);
    try {
      const res = await fetch(`/api/workspace/${workspace.slug}/provision-emailbison`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setProvisionError(data.error ?? "Provisioning failed");
        return;
      }
      router.refresh();
    } catch {
      setProvisionError("Failed to provision EmailBison");
    } finally {
      setProvisioning(false);
    }
  }

  function toggleModule(mod: WorkspaceModule) {
    setSelectedModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod],
    );
    setPkgSaved(false);
  }

  function validateNumeric(val: string, fieldName: string): number | null {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0) {
      setPkgError(`${fieldName} must be a non-negative number`);
      return null;
    }
    return n;
  }

  async function handleSavePackage() {
    setPkgError(null);
    setPkgSaved(false);

    if (selectedModules.length === 0) {
      setPkgError("At least one module must be enabled");
      return;
    }

    const quota = validateNumeric(monthlyLeadQuota, "Monthly Lead Quota");
    if (quota === null) return;
    const staticPool = validateNumeric(monthlyLeadQuotaStatic, "Static Lead Pool");
    if (staticPool === null) return;
    const signalPool = validateNumeric(monthlyLeadQuotaSignal, "Signal Lead Pool");
    if (signalPool === null) return;
    const campaigns = validateNumeric(monthlyCampaignAllowance, "Campaign Allowance");
    if (campaigns === null) return;

    setPkgSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.slug}/package`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledModules: selectedModules,
          monthlyLeadQuota: quota,
          monthlyLeadQuotaStatic: staticPool,
          monthlyLeadQuotaSignal: signalPool,
          monthlyCampaignAllowance: campaigns,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setPkgError(json.error ?? "Failed to save package settings");
        return;
      }

      setPkgSaved(true);
      router.refresh();
    } catch {
      setPkgError("Failed to save package settings");
    } finally {
      setPkgSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* EmailBison Provisioning Alert — above tabs */}
      {(!workspace.apiToken || workspace.status === "pending_emailbison") && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100">EmailBison Not Provisioned</p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  This workspace needs an EmailBison account to send emails.
                </p>
              </div>
              <Button
                onClick={handleProvision}
                disabled={provisioning}
                variant="outline"
                className="border-amber-400 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/30"
              >
                {provisioning ? "Provisioning..." : "Provision EmailBison"}
              </Button>
            </div>
            {provisionError && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">{provisionError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sticky save bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border pb-3 pt-1 flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
            Settings saved
          </span>
        )}
        {error && (
          <span className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</span>
        )}
      </div>

      {/* Tabbed layout */}
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">
            <Building2 className="size-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="sender">
            <User className="size-4" />
            Sender
          </TabsTrigger>
          <TabsTrigger value="icp">
            <Target className="size-4" />
            ICP
          </TabsTrigger>
          <TabsTrigger value="campaign">
            <FileText className="size-4" />
            Campaign Brief
          </TabsTrigger>
          {packageData && (
            <TabsTrigger value="package">
              <Package className="size-4" />
              Package
            </TabsTrigger>
          )}
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label="Notification Emails">
                  <Input
                    value={form.notificationEmails}
                    onChange={(e) => updateField("notificationEmails", e.target.value)}
                    placeholder="email@example.com, another@example.com"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Comma-separated email addresses for notifications
                  </p>
                </FieldRow>
                <FieldRow label="Client Portal Emails">
                  <Input
                    value={form.clientEmails}
                    onChange={(e) => updateField("clientEmails", e.target.value)}
                    placeholder="client@company.com, another@company.com"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Comma-separated emails authorized to log into the client portal
                  </p>
                </FieldRow>
              </div>
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
              <FieldRow label="Notes">
                <Textarea
                  value={form.onboardingNotes}
                  onChange={(e) => updateField("onboardingNotes", e.target.value)}
                  rows={4}
                  placeholder="Any additional notes about this workspace..."
                />
              </FieldRow>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sender Tab */}
        <TabsContent value="sender">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label="Full Name">
                  <Input
                    value={form.senderFullName}
                    onChange={(e) => updateField("senderFullName", e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Job Title">
                  <Input
                    value={form.senderJobTitle}
                    onChange={(e) => updateField("senderJobTitle", e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Phone">
                  <Input
                    value={form.senderPhone}
                    onChange={(e) => updateField("senderPhone", e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="LinkedIn Username">
                  <Input
                    value={form.linkedinUsername}
                    onChange={(e) => updateField("linkedinUsername", e.target.value)}
                  />
                </FieldRow>
              </div>
              <FieldRow label="Address">
                <Textarea
                  value={form.senderAddress}
                  onChange={(e) => updateField("senderAddress", e.target.value)}
                  rows={2}
                />
              </FieldRow>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ICP Tab */}
        <TabsContent value="icp">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label="Countries">
                  <Input
                    value={form.icpCountries}
                    onChange={(e) => updateField("icpCountries", e.target.value)}
                    placeholder="United Kingdom, United States"
                  />
                </FieldRow>
                <FieldRow label="Industries">
                  <Input
                    value={form.icpIndustries}
                    onChange={(e) => updateField("icpIndustries", e.target.value)}
                    placeholder="SaaS, Fintech, Healthcare"
                  />
                </FieldRow>
                <FieldRow label="Company Size">
                  <Input
                    value={form.icpCompanySize}
                    onChange={(e) => updateField("icpCompanySize", e.target.value)}
                    placeholder="50-500 employees"
                  />
                </FieldRow>
                <FieldRow label="Decision Maker Titles">
                  <Input
                    value={form.icpDecisionMakerTitles}
                    onChange={(e) => updateField("icpDecisionMakerTitles", e.target.value)}
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
                  onChange={(e) => updateField("icpExclusionCriteria", e.target.value)}
                  rows={2}
                  placeholder="Who to exclude from targeting"
                />
              </FieldRow>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Campaign Brief Tab */}
        <TabsContent value="campaign">
          <Card>
            <CardContent className="pt-6 space-y-4">
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
                  onChange={(e) => updateField("differentiators", e.target.value)}
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
                  onChange={(e) => updateField("pricingSalesCycle", e.target.value)}
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
                  onChange={(e) => updateField("existingMessaging", e.target.value)}
                  rows={3}
                />
              </FieldRow>
              <FieldRow label="Supporting Materials">
                <Textarea
                  value={form.supportingMaterials}
                  onChange={(e) => updateField("supportingMaterials", e.target.value)}
                  rows={2}
                />
              </FieldRow>
              <FieldRow label="Exclusion List">
                <Textarea
                  value={form.exclusionList}
                  onChange={(e) => updateField("exclusionList", e.target.value)}
                  rows={2}
                  placeholder="Domains/companies to exclude"
                />
              </FieldRow>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Package Tab */}
        {packageData && (
          <TabsContent value="package">
            <Card>
              <CardContent className="pt-6 space-y-6">
                {/* Current Usage */}
                <div className="space-y-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    Current Period Usage
                  </p>
                  <div className="text-xs text-muted-foreground mb-2">
                    Billing window:{" "}
                    <span className="text-foreground">
                      {formatDate(packageData.usage.billingWindowStart)} &mdash;{" "}
                      {formatDate(packageData.usage.billingWindowEnd)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium mb-1.5">Lead Quota</p>
                      <UsageBar
                        used={packageData.usage.totalLeadsUsed}
                        total={packageData.monthlyLeadQuota}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {packageData.usage.totalLeadsUsed.toLocaleString()} /{" "}
                        {packageData.monthlyLeadQuota.toLocaleString()} leads used this period
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium mb-1.5">Campaign Allowance</p>
                      <UsageBar
                        used={packageData.usage.campaignsUsed}
                        total={packageData.monthlyCampaignAllowance}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {packageData.usage.campaignsUsed} / {packageData.monthlyCampaignAllowance}{" "}
                        campaigns this period
                      </p>
                    </div>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Enabled Modules */}
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Enabled Modules
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {ALL_MODULES.map((mod) => (
                      <div key={mod.value} className="flex items-center gap-2">
                        <Checkbox
                          id={`module-${mod.value}`}
                          checked={selectedModules.includes(mod.value)}
                          onCheckedChange={() => toggleModule(mod.value)}
                        />
                        <Label
                          htmlFor={`module-${mod.value}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {mod.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Quota Configuration */}
                <div className="space-y-4">
                  <p className="text-sm font-medium text-muted-foreground">
                    Quota Configuration
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label
                        htmlFor="monthlyLeadQuota"
                        className="text-sm font-medium mb-1.5 block"
                      >
                        Monthly Lead Quota (Total)
                      </Label>
                      <Input
                        id="monthlyLeadQuota"
                        type="number"
                        min={0}
                        value={monthlyLeadQuota}
                        onChange={(e) => {
                          setMonthlyLeadQuota(e.target.value);
                          setPkgSaved(false);
                        }}
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor="monthlyCampaignAllowance"
                        className="text-sm font-medium mb-1.5 block"
                      >
                        Campaign Allowance
                      </Label>
                      <Input
                        id="monthlyCampaignAllowance"
                        type="number"
                        min={0}
                        value={monthlyCampaignAllowance}
                        onChange={(e) => {
                          setMonthlyCampaignAllowance(e.target.value);
                          setPkgSaved(false);
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Soft limit -- agent warns before exceeding
                      </p>
                    </div>
                    <div>
                      <Label
                        htmlFor="monthlyLeadQuotaStatic"
                        className="text-sm font-medium mb-1.5 block"
                      >
                        Static Lead Pool
                      </Label>
                      <Input
                        id="monthlyLeadQuotaStatic"
                        type="number"
                        min={0}
                        value={monthlyLeadQuotaStatic}
                        onChange={(e) => {
                          setMonthlyLeadQuotaStatic(e.target.value);
                          setPkgSaved(false);
                        }}
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor="monthlyLeadQuotaSignal"
                        className="text-sm font-medium mb-1.5 block"
                      >
                        Signal Lead Pool
                      </Label>
                      <Input
                        id="monthlyLeadQuotaSignal"
                        type="number"
                        min={0}
                        value={monthlyLeadQuotaSignal}
                        onChange={(e) => {
                          setMonthlyLeadQuotaSignal(e.target.value);
                          setPkgSaved(false);
                        }}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Used by signal campaigns (Phase 18+)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Package Save */}
                <div className="flex items-center gap-3">
                  <Button onClick={handleSavePackage} disabled={pkgSaving}>
                    {pkgSaving ? "Saving..." : "Save Package Settings"}
                  </Button>
                  {pkgSaved && (
                    <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                      Package settings saved
                    </span>
                  )}
                  {pkgError && (
                    <span className="text-sm text-red-600 dark:text-red-400 font-medium">{pkgError}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
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
