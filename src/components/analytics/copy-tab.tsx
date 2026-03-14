"use client";

import { useState, useEffect, useCallback } from "react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { SubjectLineRankings } from "./subject-line-rankings";
import { ElementMultiplierCards } from "./element-multiplier-cards";
import { TopTemplatesList } from "./top-templates-list";
import { TemplateDetailPanel } from "./template-detail-panel";
import type { BodyElements } from "@/lib/analytics/body-elements";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CopyTabProps {
  workspace: string | null;
  period: string;
  vertical: string | null;
}

export interface SubjectLine {
  text: string;
  campaignCount: number;
  campaignName: string | null;
  step: number | null;
  totalSends: number;
  openRate: number;
  replyRate: number;
  isVariantB: boolean;
}

interface SubjectLinesResponse {
  subjectLines: SubjectLine[];
  total: number;
  view: "global" | "per-campaign";
  filters: { workspace: string | null; vertical: string | null };
}

export interface Correlation {
  element: string;
  displayName: string;
  globalMultiplier: number | null;
  globalSampleWith: number;
  globalSampleWithout: number;
  verticalMultiplier: number | null;
  verticalSampleWith: number;
  verticalSampleWithout: number;
  verticalName: string | null;
  lowConfidence: boolean;
}

export interface CtaSubtype {
  subtype: string;
  avgReplyRate: number;
  sampleSize: number;
}

interface CorrelationsResponse {
  correlations: Correlation[];
  ctaSubtypes: CtaSubtype[];
  totalStepsAnalyzed: number;
  filters: { workspace: string | null; vertical: string | null };
}

export interface Template {
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  step: number;
  subjectLine: string;
  body: string;
  elements: BodyElements;
  replyRate: number;
  interestedRate: number;
  compositeScore: number;
  totalSends: number;
  copyStrategy: string | null;
}

interface TopTemplatesResponse {
  templates: Template[];
  total: number;
  filters: { workspace: string | null; vertical: string | null };
}

// ---------------------------------------------------------------------------
// Loading skeletons
// ---------------------------------------------------------------------------

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CopyTab({ workspace, period, vertical }: CopyTabProps) {
  // Subject lines
  const [subjectView, setSubjectView] = useState<"global" | "per-campaign">(
    "global",
  );
  const [subjectData, setSubjectData] =
    useState<SubjectLinesResponse | null>(null);
  const [subjectLoading, setSubjectLoading] = useState(true);
  const [subjectError, setSubjectError] = useState<string | null>(null);

  // Correlations
  const [corrData, setCorrData] = useState<CorrelationsResponse | null>(null);
  const [corrLoading, setCorrLoading] = useState(true);
  const [corrError, setCorrError] = useState<string | null>(null);

  // Top templates
  const [templatesData, setTemplatesData] =
    useState<TopTemplatesResponse | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // Template detail panel
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );

  // ─── Build query params ────────────────────────────────────────────────
  function buildParams(extra?: Record<string, string>): string {
    const sp = new URLSearchParams();
    if (workspace) sp.set("workspace", workspace);
    if (vertical) sp.set("vertical", vertical);
    if (period) sp.set("period", period);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) sp.set(k, v);
    }
    return sp.toString();
  }

  // ─── Fetch subject lines ──────────────────────────────────────────────
  const fetchSubjectLines = useCallback(async () => {
    setSubjectLoading(true);
    setSubjectError(null);
    try {
      const qs = buildParams({ view: subjectView });
      const res = await fetch(`/api/analytics/copy/subject-lines?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SubjectLinesResponse;
      setSubjectData(json);
    } catch (err) {
      setSubjectError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubjectLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, vertical, subjectView]);

  // ─── Fetch correlations ───────────────────────────────────────────────
  const fetchCorrelations = useCallback(async () => {
    setCorrLoading(true);
    setCorrError(null);
    try {
      const qs = buildParams();
      const res = await fetch(`/api/analytics/copy/correlations?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CorrelationsResponse;
      setCorrData(json);
    } catch (err) {
      setCorrError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCorrLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, vertical]);

  // ─── Fetch top templates ──────────────────────────────────────────────
  const fetchTopTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const qs = buildParams();
      const res = await fetch(`/api/analytics/copy/top-templates?${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as TopTemplatesResponse;
      setTemplatesData(json);
    } catch (err) {
      setTemplatesError(
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setTemplatesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, vertical]);

  // ─── Effects ──────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchSubjectLines();
  }, [fetchSubjectLines]);

  useEffect(() => {
    void fetchCorrelations();
  }, [fetchCorrelations]);

  useEffect(() => {
    void fetchTopTemplates();
  }, [fetchTopTemplates]);

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Subject Line Rankings */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Subject Line Rankings</h2>
        {subjectError && (
          <ErrorBanner
            message={`Failed to load subject lines: ${subjectError}`}
            onRetry={() => void fetchSubjectLines()}
          />
        )}
        {subjectLoading ? (
          <SectionSkeleton rows={5} />
        ) : (
          subjectData && (
            <SubjectLineRankings
              subjectLines={subjectData.subjectLines}
              total={subjectData.total}
              view={subjectView}
              onViewChange={setSubjectView}
            />
          )
        )}
      </section>

      {/* Element Correlations */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Element Correlations</h2>
        {corrError && (
          <ErrorBanner
            message={`Failed to load correlations: ${corrError}`}
            onRetry={() => void fetchCorrelations()}
          />
        )}
        {corrLoading ? (
          <CardGridSkeleton />
        ) : (
          corrData && (
            <ElementMultiplierCards
              correlations={corrData.correlations}
              ctaSubtypes={corrData.ctaSubtypes}
              totalStepsAnalyzed={corrData.totalStepsAnalyzed}
            />
          )
        )}
      </section>

      {/* Top Templates */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Top Templates</h2>
        {templatesError && (
          <ErrorBanner
            message={`Failed to load templates: ${templatesError}`}
            onRetry={() => void fetchTopTemplates()}
          />
        )}
        {templatesLoading ? (
          <SectionSkeleton rows={5} />
        ) : (
          templatesData && (
            <TopTemplatesList
              templates={templatesData.templates}
              total={templatesData.total}
              onSelectTemplate={setSelectedTemplate}
            />
          )
        )}
      </section>

      {/* Template detail panel */}
      <TemplateDetailPanel
        template={selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
      />
    </div>
  );
}
