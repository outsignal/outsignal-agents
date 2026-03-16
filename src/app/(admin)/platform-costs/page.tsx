"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Check, ExternalLink, Plus, Trash2 } from "lucide-react";
import { formatGBP } from "@/lib/format";

// ---- Types ------------------------------------------------------------------

interface PlatformCostRecord {
  id: string;
  service: string;
  label: string;
  monthlyCost: number;
  notes: string | null;
  category: string;
  client: string | null;
  url: string | null;
  billingDay: number | null;
  updatedAt: string;
}

interface CostData {
  services: PlatformCostRecord[];
  totalMonthly: number;
  byCategory: Record<string, number>;
  byClient: Record<string, number>;
}

// ---- Constants --------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  infrastructure: "oklch(0.714 0.143 215.221)", // blue
  api: "oklch(0.82 0.148 68)",                   // amber
  email: "oklch(0.845 0.143 155)",                // green
  tools: "oklch(0.714 0.143 310)",                // purple
};

const CATEGORY_ORDER = ["tools", "api", "email", "infrastructure"];

type ViewMode = "category" | "client";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- Sub-components ---------------------------------------------------------

function SummaryCard({
  label,
  value,
  detail,
  accent,
  wide,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
  wide?: boolean;
}) {
  return (
    <Card density="compact" className={wide ? "col-span-2 lg:col-span-1" : ""}>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-1">
          {label}
        </p>
        <p className={`text-2xl font-bold ${accent ? "text-brand-strong" : ""}`}>
          {value}
        </p>
        {detail && (
          <p className="text-xs text-muted-foreground mt-1">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card density="compact" className="animate-pulse">
      <CardContent>
        <div className="h-3 bg-muted rounded w-24 mb-3" />
        <div className="h-7 bg-muted rounded w-32" />
      </CardContent>
    </Card>
  );
}

// ---- Inline Editable Cell ---------------------------------------------------

function EditableCell({
  value,
  type,
  onSave,
  displayValue,
}: {
  value: string;
  type: "number" | "text";
  onSave: (newValue: string) => Promise<void>;
  displayValue?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync external value changes
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void commit();
    } else if (e.key === "Escape") {
      setDraft(value);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type={type}
          step={type === "number" ? "0.01" : undefined}
          min={type === "number" ? "0" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="h-7 w-24 text-sm px-1.5"
        />
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 -mx-1 transition-colors inline-flex items-center gap-1"
    >
      {displayValue !== undefined ? displayValue : type === "number" ? formatGBP(parseFloat(value) || 0) : value || "-"}
      {saved && (
        <Check className="h-3.5 w-3.5 text-emerald-500 animate-in fade-in duration-300" />
      )}
    </span>
  );
}

// ---- Service Row (shared between views) ------------------------------------

function ServiceRow({
  row,
  showClient,
  showCategory,
  onSave,
  onDelete,
}: {
  row: PlatformCostRecord;
  showClient: boolean;
  showCategory: boolean;
  onSave: (id: string, field: "monthlyCost" | "notes" | "billingDay", value: string) => Promise<void>;
  onDelete?: (id: string, label: string) => void;
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
      <td className="px-4 py-3">
        <span className="flex items-center gap-2">
          {showCategory && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{
                backgroundColor:
                  CATEGORY_COLORS[row.category] ?? "oklch(0.5 0 0)",
              }}
            />
          )}
          {row.url ? (
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline text-foreground inline-flex items-center gap-1"
            >
              {row.label}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          ) : (
            <span>{row.label}</span>
          )}
        </span>
      </td>
      {showClient && (
        <td className="px-4 py-3">
          {row.client ? (
            <span className="text-xs font-mono text-muted-foreground">
              {row.client}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-muted/50 border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Shared
            </span>
          )}
        </td>
      )}
      <td className="px-4 py-3 text-center">
        <EditableCell
          value={row.billingDay != null ? String(row.billingDay) : ""}
          type="number"
          onSave={(v) => onSave(row.id, "billingDay", v)}
          displayValue={row.billingDay != null ? ordinal(row.billingDay) : "-"}
        />
      </td>
      <td className="px-4 py-3 text-right">
        <EditableCell
          value={String(row.monthlyCost)}
          type="number"
          onSave={(v) => onSave(row.id, "monthlyCost", v)}
        />
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        <EditableCell
          value={row.notes ?? ""}
          type="text"
          onSave={(v) => onSave(row.id, "notes", v)}
        />
      </td>
      {onDelete && (
        <td className="px-2 py-3">
          <button
            onClick={() => onDelete(row.id, row.label)}
            className="text-muted-foreground hover:text-red-500 transition-colors p-1 rounded"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      )}
    </tr>
  );
}

// ---- View Toggle Tabs -------------------------------------------------------

function ViewTabs({
  active,
  onChange,
}: {
  active: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
      {(["category", "client"] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            active === mode
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          By {capitalize(mode)}
        </button>
      ))}
    </div>
  );
}

// ---- Category View ----------------------------------------------------------

function CategoryView({
  data,
  onSave,
  onDelete,
}: {
  data: CostData;
  onSave: (id: string, field: "monthlyCost" | "notes" | "billingDay", value: string) => Promise<void>;
  onDelete: (id: string, label: string) => void;
}) {
  const grouped = useMemo(() => {
    const result: Array<{
      category: string;
      subtotal: number;
      items: PlatformCostRecord[];
    }> = [];

    for (const cat of CATEGORY_ORDER) {
      const items = data.services.filter((s) => s.category === cat);
      if (items.length > 0) {
        result.push({
          category: cat,
          subtotal: items.reduce((sum, s) => sum + s.monthlyCost, 0),
          items,
        });
      }
    }
    // Any categories not in CATEGORY_ORDER
    const knownCats = new Set(CATEGORY_ORDER);
    const otherItems = data.services.filter((s) => !knownCats.has(s.category));
    if (otherItems.length > 0) {
      result.push({
        category: "other",
        subtotal: otherItems.reduce((sum, s) => sum + s.monthlyCost, 0),
        items: otherItems,
      });
    }
    return result;
  }, [data.services]);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <Card density="compact" key={group.category}>
          <CardHeader
            className="border-b"
            style={{
              borderLeft: `4px solid ${CATEGORY_COLORS[group.category] ?? "oklch(0.5 0 0)"}`,
            }}
          >
            <CardTitle className="text-sm flex items-center justify-between">
              <span>{capitalize(group.category)}</span>
              <span className="text-muted-foreground font-normal">
                {formatGBP(group.subtotal)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="!px-0">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[35%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Service</th>
                  <th className="text-left px-4 py-2">Client</th>
                  <th className="text-center px-4 py-2">Bills On</th>
                  <th className="text-right px-4 py-2">Monthly Cost</th>
                  <th className="text-left px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((row) => (
                  <ServiceRow
                    key={row.id}
                    row={row}
                    showClient
                    showCategory={false}
                    onSave={onSave}
                    onDelete={onDelete}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---- Client View ------------------------------------------------------------

function ClientView({
  data,
  onSave,
  onDelete,
}: {
  data: CostData;
  onSave: (id: string, field: "monthlyCost" | "notes" | "billingDay", value: string) => Promise<void>;
  onDelete: (id: string, label: string) => void;
}) {
  const grouped = useMemo(() => {
    const byClient: Record<string, PlatformCostRecord[]> = {};

    for (const s of data.services) {
      const key = s.client ?? "shared";
      if (!byClient[key]) byClient[key] = [];
      byClient[key].push(s);
    }

    // Sort: "shared" last, rest alphabetical
    const keys = Object.keys(byClient).sort((a, b) => {
      if (a === "shared") return 1;
      if (b === "shared") return -1;
      return a.localeCompare(b);
    });

    return keys.map((key) => ({
      client: key,
      items: byClient[key],
      subtotal: byClient[key].reduce((sum, s) => sum + s.monthlyCost, 0),
    }));
  }, [data.services]);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <Card density="compact" key={group.client}>
          <CardHeader className="border-b">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>
                {group.client === "shared" ? (
                  <span className="inline-flex items-center gap-2">
                    Shared
                    <span className="inline-flex items-center rounded-full bg-muted/50 border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      Not client-specific
                    </span>
                  </span>
                ) : (
                  capitalize(group.client)
                )}
              </span>
              <span className="text-muted-foreground font-normal">
                {formatGBP(group.subtotal)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="!px-0">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[45%]" />
                <col className="w-[15%]" />
                <col className="w-[20%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Service</th>
                  <th className="text-center px-4 py-2">Bills On</th>
                  <th className="text-right px-4 py-2">Monthly Cost</th>
                  <th className="text-left px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((row) => (
                  <ServiceRow
                    key={row.id}
                    row={row}
                    showClient={false}
                    showCategory
                    onSave={onSave}
                    onDelete={onDelete}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---- Main Page --------------------------------------------------------------

export default function PlatformCostsPage() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("category");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/platform-costs");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CostData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSave = async (
    id: string,
    field: "monthlyCost" | "notes" | "billingDay",
    rawValue: string
  ) => {
    const payload: Record<string, unknown> = { id };
    if (field === "monthlyCost") {
      const parsed = parseFloat(rawValue);
      if (isNaN(parsed) || parsed < 0) throw new Error("Invalid amount");
      payload.monthlyCost = parsed;
    } else if (field === "billingDay") {
      if (rawValue === "" || rawValue === "-") {
        payload.billingDay = null;
      } else {
        const parsed = parseInt(rawValue, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 31) throw new Error("Must be 1-31");
        payload.billingDay = parsed;
      }
    } else {
      payload.notes = rawValue;
    }

    const res = await fetch("/api/platform-costs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const updated = (await res.json()) as PlatformCostRecord;

    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      const services = prev.services.map((s) =>
        s.id === id ? { ...s, ...updated } : s
      );
      const totalMonthly = services.reduce(
        (sum, s) => sum + s.monthlyCost,
        0
      );
      const byCategory: Record<string, number> = {};
      const byClient: Record<string, number> = {};
      for (const s of services) {
        byCategory[s.category] =
          (byCategory[s.category] ?? 0) + s.monthlyCost;
        const ck = s.client ?? "shared";
        byClient[ck] = (byClient[ck] ?? 0) + s.monthlyCost;
      }
      return { services, totalMonthly, byCategory, byClient };
    });
  };

  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleCreate = async (formData: FormData) => {
    setAddError(null);
    const service = formData.get("service") as string;
    const label = formData.get("label") as string;
    const monthlyCost = parseFloat(formData.get("monthlyCost") as string);
    const category = formData.get("category") as string;
    const client = (formData.get("client") as string) || null;

    if (!service || !label || isNaN(monthlyCost) || !category) {
      setAddError("Service, label, cost, and category are required");
      return;
    }

    try {
      const res = await fetch("/api/platform-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, label, monthlyCost, category, client }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setShowAddForm(false);
      void fetchData();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create");
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete "${label}"?`)) return;
    try {
      const res = await fetch("/api/platform-costs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Failed to delete");
      void fetchData();
    } catch {
      alert("Failed to delete cost record");
    }
  };

  const serviceCount = data?.services.length ?? 0;

  return (
    <div>
      <Header
        title="Platform Costs"
        description="Monthly service expenses (GBP)"
      />

      <div className="p-6 space-y-6">
        {/* Error state */}
        {error && (
          <ErrorBanner
            message={`Failed to load data: ${error}`}
            onRetry={() => void fetchData()}
          />
        )}

        {/* Summary cards — 2 rows on mobile, single row on desktop */}
        <div className="grid grid-cols-2 gap-4">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : data ? (
            <>
              <SummaryCard
                label="Total Monthly Burn"
                value={formatGBP(data.totalMonthly)}
                detail={`${serviceCount} services`}
                accent
                wide
              />
              <SummaryCard
                label="Services"
                value={String(serviceCount)}
                detail={CATEGORY_ORDER.map((cat) => `${data.services.filter((s) => s.category === cat).length} ${cat}`).join(" · ")}
              />
            </>
          ) : null}
        </div>

        {/* View toggle + services */}
        {!loading && data && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <ViewTabs active={viewMode} onChange={setViewMode} />
              <p className="text-xs text-muted-foreground">
                Click any cost or note to edit inline
              </p>
            </div>

            {viewMode === "category" ? (
              <CategoryView data={data} onSave={handleSave} onDelete={handleDelete} />
            ) : (
              <ClientView data={data} onSave={handleSave} onDelete={handleDelete} />
            )}

            {/* Add Service Form */}
            {showAddForm ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Add Service</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleCreate(new FormData(e.currentTarget));
                    }}
                    className="grid grid-cols-2 md:grid-cols-5 gap-3"
                  >
                    <Input name="service" placeholder="Service key" required />
                    <Input name="label" placeholder="Display label" required />
                    <Input name="monthlyCost" type="number" step="0.01" min="0" placeholder="Monthly cost" required />
                    <select name="category" className="rounded-md border border-input bg-background px-3 py-2 text-sm" required>
                      <option value="">Category</option>
                      {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
                    </select>
                    <Input name="client" placeholder="Client slug (optional)" />
                    <div className="col-span-2 md:col-span-5 flex gap-2">
                      <button type="submit" className="px-4 py-2 text-sm bg-foreground text-background rounded-md hover:opacity-90">
                        Save
                      </button>
                      <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                        Cancel
                      </button>
                      {addError && <span className="text-sm text-red-500 self-center">{addError}</span>}
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-4 w-4" /> Add service
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
