"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ThumbsUp,
  ThumbsDown,
  Minus,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Suggestion {
  id: string;
  workspaceSlug: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  bodyText: string;
  aiSuggestedReply: string;
  suggestionFeedback: "good" | "bad" | "needs_work" | null;
  suggestionFeedbackAt: string | null;
  createdAt: string;
  person: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
}

interface Stats {
  total: number;
  good: number;
  bad: number;
  needsWork: number;
  unrated: number;
}

interface Pagination {
  page: number;
  totalPages: number;
  total: number;
}

type FeedbackFilter = "all" | "unrated" | "good" | "bad" | "needs_work";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str: string, max: number) {
  const clean = str.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "\u2026" : clean;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function personDisplayName(s: Suggestion) {
  if (s.person) {
    const parts = [s.person.firstName, s.person.lastName]
      .filter(Boolean)
      .join(" ");
    if (parts) return parts;
    return s.person.email;
  }
  return s.senderName || s.senderEmail;
}

function pct(n: number, total: number) {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SuggestionsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    good: 0,
    bad: 0,
    needsWork: 0,
    unrated: 0,
  });
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState("__all__");
  const [feedbackFilter, setFeedbackFilter] =
    useState<FeedbackFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Derive unique workspaces from stats-agnostic fetch
  const [workspaces, setWorkspaces] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (workspace !== "__all__") params.set("workspace", workspace);
      if (feedbackFilter !== "all") params.set("feedback", feedbackFilter);
      params.set("page", String(page));

      const res = await fetch(`/api/admin/suggestions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      setSuggestions(data.suggestions);
      setStats(data.stats);
      setPagination(data.pagination);

      // Collect unique workspaces from suggestions
      const slugs = new Set<string>(
        data.suggestions.map((s: Suggestion) => s.workspaceSlug)
      );
      setWorkspaces((prev) => {
        const merged = new Set([...prev, ...slugs]);
        return Array.from(merged).sort();
      });
    } catch {
      toast.error("Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }, [workspace, feedbackFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [workspace, feedbackFilter]);

  const handleRate = async (
    replyId: string,
    feedback: "good" | "bad" | "needs_work"
  ) => {
    // Optimistic update
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === replyId
          ? {
              ...s,
              suggestionFeedback: feedback,
              suggestionFeedbackAt: new Date().toISOString(),
            }
          : s
      )
    );

    // Optimistic stats update
    setStats((prev) => {
      const old = suggestions.find((s) => s.id === replyId);
      if (!old) return prev;
      const next = { ...prev };
      // Decrement old feedback bucket
      if (old.suggestionFeedback === "good") next.good--;
      else if (old.suggestionFeedback === "bad") next.bad--;
      else if (old.suggestionFeedback === "needs_work") next.needsWork--;
      else next.unrated--;
      // Increment new feedback bucket
      if (feedback === "good") next.good++;
      else if (feedback === "bad") next.bad++;
      else next.needsWork++;
      return next;
    });

    try {
      const res = await fetch("/api/admin/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyId, feedback }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Feedback saved");
    } catch {
      toast.error("Failed to save feedback");
      fetchData(); // Revert on error
    }
  };

  const startIdx = (pagination.page - 1) * 20 + 1;
  const endIdx = Math.min(pagination.page * 20, pagination.total);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="AI Suggestions"
        description="Review and rate AI-generated reply suggestions"
      />

      <div className="flex-1 overflow-auto p-4 sm:p-8 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Total Generated"
            value={stats.total}
            icon="Sparkles"
            loading={loading}
            accentColor="#635BFF"
          />
          <MetricCard
            label="Rated Good"
            value={stats.good}
            detail={pct(stats.good, stats.total)}
            icon="CheckCircle"
            loading={loading}
            accentColor="#10b981"
          />
          <MetricCard
            label="Needs Work"
            value={stats.needsWork}
            detail={pct(stats.needsWork, stats.total)}
            icon="AlertTriangle"
            loading={loading}
            accentColor="#f59e0b"
          />
          <MetricCard
            label="Unrated"
            value={stats.unrated}
            icon="Circle"
            loading={loading}
            accentColor="#6b7280"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select value={workspace} onValueChange={setWorkspace}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All workspaces</SelectItem>
              {workspaces.map((ws) => (
                <SelectItem key={ws} value={ws}>
                  {ws}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={feedbackFilter}
            onValueChange={(v) => setFeedbackFilter(v as FeedbackFilter)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unrated">Unrated</SelectItem>
              <SelectItem value="good">Good</SelectItem>
              <SelectItem value="bad">Bad</SelectItem>
              <SelectItem value="needs_work">Needs Work</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Sparkles className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">
                No AI suggestions generated yet
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Original Reply</TableHead>
                  <TableHead>AI Suggestion</TableHead>
                  <TableHead className="w-16 text-center">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((s) => {
                  const isExpanded = expandedId === s.id;
                  return (
                    <SuggestionRow
                      key={s.id}
                      suggestion={s}
                      isExpanded={isExpanded}
                      onToggle={() =>
                        setExpandedId(isExpanded ? null : s.id)
                      }
                      onRate={handleRate}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {!loading && suggestions.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {startIdx}&ndash;{endIdx} of {pagination.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row Component
// ---------------------------------------------------------------------------

function SuggestionRow({
  suggestion: s,
  isExpanded,
  onToggle,
  onRate,
}: {
  suggestion: Suggestion;
  isExpanded: boolean;
  onToggle: () => void;
  onRate: (id: string, fb: "good" | "bad" | "needs_work") => void;
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
      >
        <TableCell className="pl-3 pr-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(s.createdAt)}
        </TableCell>
        <TableCell className="font-medium">{personDisplayName(s)}</TableCell>
        <TableCell className="text-muted-foreground">
          {s.workspaceSlug}
        </TableCell>
        <TableCell className="text-sm max-w-[200px]">
          {truncate(s.bodyText, 80)}
        </TableCell>
        <TableCell className="text-sm text-primary/80 max-w-[200px]">
          {truncate(s.aiSuggestedReply, 80)}
        </TableCell>
        <TableCell className="text-center">
          <RatingIcon feedback={s.suggestionFeedback} />
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="p-0">
            <div className="px-6 py-4 space-y-4 bg-muted/20">
              {/* Original reply */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Original Reply
                </p>
                <div className="rounded-md bg-muted/60 p-3 text-sm whitespace-pre-wrap">
                  {s.bodyText}
                </div>
              </div>

              {/* AI suggestion */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  AI Suggestion
                </p>
                <div className="rounded-md bg-primary/5 p-3 text-sm whitespace-pre-wrap">
                  {s.aiSuggestedReply}
                </div>
              </div>

              {/* Rating buttons */}
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground mr-2">
                  Rate:
                </p>
                <Button
                  size="sm"
                  variant={
                    s.suggestionFeedback === "good" ? "default" : "outline"
                  }
                  className={cn(
                    "gap-1.5",
                    s.suggestionFeedback === "good"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRate(s.id, "good");
                  }}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  Good
                </Button>
                <Button
                  size="sm"
                  variant={
                    s.suggestionFeedback === "needs_work"
                      ? "default"
                      : "outline"
                  }
                  className={cn(
                    "gap-1.5",
                    s.suggestionFeedback === "needs_work"
                      ? "bg-amber-500 hover:bg-amber-600 text-white"
                      : "text-amber-600 border-amber-300 hover:bg-amber-50"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRate(s.id, "needs_work");
                  }}
                >
                  <Minus className="h-3.5 w-3.5" />
                  Needs Work
                </Button>
                <Button
                  size="sm"
                  variant={
                    s.suggestionFeedback === "bad" ? "default" : "outline"
                  }
                  className={cn(
                    "gap-1.5",
                    s.suggestionFeedback === "bad"
                      ? "bg-red-600 hover:bg-red-700 text-white"
                      : "text-red-600 border-red-300 hover:bg-red-50"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRate(s.id, "bad");
                  }}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                  Bad
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rating Icon
// ---------------------------------------------------------------------------

function RatingIcon({
  feedback,
}: {
  feedback: "good" | "bad" | "needs_work" | null;
}) {
  if (feedback === "good") {
    return <ThumbsUp className="h-4 w-4 text-emerald-500 mx-auto" />;
  }
  if (feedback === "bad") {
    return <ThumbsDown className="h-4 w-4 text-red-500 mx-auto" />;
  }
  if (feedback === "needs_work") {
    return <Minus className="h-4 w-4 text-amber-500 mx-auto" />;
  }
  return <Minus className="h-4 w-4 text-gray-300 mx-auto" />;
}
