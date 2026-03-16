"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { WorkspaceModule, QuotaUsage } from "@/lib/workspaces/quota";

interface PackageData {
  slug: string;
  enabledModules: WorkspaceModule[];
  monthlyLeadQuota: number;
  monthlyLeadQuotaStatic: number;
  monthlyLeadQuotaSignal: number;
  monthlyCampaignAllowance: number;
  usage: QuotaUsage;
}

const ALL_MODULES: { value: WorkspaceModule; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "email-signals", label: "Email Signals" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "linkedin-signals", label: "LinkedIn Signals" },
];

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{used.toLocaleString()} used</span>
        <span>{total.toLocaleString()} limit</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all ${isHigh ? "bg-amber-400" : "bg-brand"}`}
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

export function PackageQuotasForm({ data }: { data: PackageData }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedModules, setSelectedModules] = useState<WorkspaceModule[]>(
    data.enabledModules,
  );
  const [monthlyLeadQuota, setMonthlyLeadQuota] = useState(
    String(data.monthlyLeadQuota),
  );
  const [monthlyLeadQuotaStatic, setMonthlyLeadQuotaStatic] = useState(
    String(data.monthlyLeadQuotaStatic),
  );
  const [monthlyLeadQuotaSignal, setMonthlyLeadQuotaSignal] = useState(
    String(data.monthlyLeadQuotaSignal),
  );
  const [monthlyCampaignAllowance, setMonthlyCampaignAllowance] = useState(
    String(data.monthlyCampaignAllowance),
  );

  function toggleModule(mod: WorkspaceModule) {
    setSelectedModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod],
    );
    setSaved(false);
  }

  function validateNumeric(val: string, fieldName: string): number | null {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0) {
      setError(`${fieldName} must be a non-negative number`);
      return null;
    }
    return n;
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    // Client-side validation
    if (selectedModules.length === 0) {
      setError("At least one module must be enabled");
      return;
    }

    const quota = validateNumeric(monthlyLeadQuota, "Monthly Lead Quota");
    if (quota === null) return;
    const staticPool = validateNumeric(
      monthlyLeadQuotaStatic,
      "Static Lead Pool",
    );
    if (staticPool === null) return;
    const signalPool = validateNumeric(
      monthlyLeadQuotaSignal,
      "Signal Lead Pool",
    );
    if (signalPool === null) return;
    const campaigns = validateNumeric(
      monthlyCampaignAllowance,
      "Campaign Allowance",
    );
    if (campaigns === null) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${data.slug}/package`, {
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
        setError(json.error ?? "Failed to save package settings");
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError("Failed to save package settings");
    } finally {
      setSaving(false);
    }
  }

  const { usage } = data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Package &amp; Quotas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Usage */}
        <div className="space-y-4">
          <p className="text-sm font-medium text-muted-foreground">
            Current Period Usage
          </p>
          <div className="text-xs text-muted-foreground mb-2">
            Billing window:{" "}
            <span className="text-foreground">
              {formatDate(usage.billingWindowStart)} &mdash;{" "}
              {formatDate(usage.billingWindowEnd)}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium mb-1.5">Lead Quota</p>
              <UsageBar
                used={usage.totalLeadsUsed}
                total={data.monthlyLeadQuota}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {usage.totalLeadsUsed.toLocaleString()} /{" "}
                {data.monthlyLeadQuota.toLocaleString()} leads used this period
              </p>
            </div>
            <div>
              <p className="text-xs font-medium mb-1.5">Campaign Allowance</p>
              <UsageBar
                used={usage.campaignsUsed}
                total={data.monthlyCampaignAllowance}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {usage.campaignsUsed} / {data.monthlyCampaignAllowance}{" "}
                campaigns this period
              </p>
            </div>
          </div>
        </div>

        {/* Divider */}
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

        {/* Divider */}
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
                  setSaved(false);
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
                  setSaved(false);
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Soft limit — agent warns before exceeding
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
                  setSaved(false);
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
                  setSaved(false);
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Used by signal campaigns (Phase 18+)
              </p>
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Package Settings"}
          </Button>
          {saved && (
            <span className="text-sm text-emerald-600 font-medium">
              Package settings saved
            </span>
          )}
          {error && (
            <span className="text-sm text-red-600 font-medium">{error}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
