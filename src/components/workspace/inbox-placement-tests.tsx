"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Inbox, Info, Loader2, Play } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderResult {
  provider: string;
  folder: string;
  score: number | null;
}

interface InboxTestRecord {
  id: number;
  status: "pending" | "processing" | "completed" | "failed";
  results: ProviderResult[];
  created_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InboxPlacementTests({ slug }: { slug: string }) {
  const [tests, setTests] = useState<InboxTestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Form state for new test
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromEmail, setFromEmail] = useState("");

  const fetchTests = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${slug}/inbox-test`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        available: boolean;
        tests?: InboxTestRecord[];
        error?: string;
      };

      if (!json.available) {
        setAvailable(false);
        return;
      }

      setTests(json.tests ?? []);
      if (json.error) setError(json.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tests");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void fetchTests();
  }, [fetchTests]);

  // Poll for pending/processing tests
  useEffect(() => {
    const hasPending = tests.some(
      (t) => t.status === "pending" || t.status === "processing",
    );
    if (!hasPending) return;

    const interval = setInterval(() => {
      void fetchTests();
    }, 15000); // Poll every 15s

    return () => clearInterval(interval);
  }, [tests, fetchTests]);

  const handleCreateTest = async () => {
    if (!subject.trim() || !body.trim() || !fromEmail.trim()) return;

    setCreating(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspace/${slug}/inbox-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          from_email: fromEmail.trim(),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // Reset form & refresh
      setSubject("");
      setBody("");
      setFromEmail("");
      setShowForm(false);
      await fetchTests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create test");
    } finally {
      setCreating(false);
    }
  };

  // Not configured
  if (!loading && !available) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center gap-3 justify-center text-muted-foreground">
            <Info className="h-5 w-5" />
            <p className="text-sm">
              Inbox placement tests require EmailGuard. Set the{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                EMAILGUARD_API_TOKEN
              </code>{" "}
              environment variable to enable.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-heading flex items-center gap-2">
          <Inbox className="h-5 w-5" />
          Inbox Placement Tests
        </CardTitle>
        {available && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            Run Inbox Test
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error banner */}
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Create test form */}
        {showForm && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <h4 className="text-sm font-medium">New Inbox Placement Test</h4>
            <div className="space-y-2">
              <div>
                <label
                  htmlFor="inbox-test-from"
                  className="text-xs text-muted-foreground block mb-1"
                >
                  From Email
                </label>
                <input
                  id="inbox-test-from"
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="sender@yourdomain.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="inbox-test-subject"
                  className="text-xs text-muted-foreground block mb-1"
                >
                  Subject
                </label>
                <input
                  id="inbox-test-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Test email subject line"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="inbox-test-body"
                  className="text-xs text-muted-foreground block mb-1"
                >
                  Body
                </label>
                <textarea
                  id="inbox-test-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Test email body content..."
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateTest()}
                disabled={
                  creating ||
                  !subject.trim() ||
                  !body.trim() ||
                  !fromEmail.trim()
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {creating ? "Creating..." : "Run Test"}
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
            <span className="ml-3 text-sm text-muted-foreground">
              Loading test results...
            </span>
          </div>
        )}

        {/* Empty state */}
        {!loading && tests.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No inbox placement tests yet. Click &quot;Run Inbox Test&quot; to
            check where your emails land.
          </p>
        )}

        {/* Results table */}
        {!loading && tests.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="bg-muted">Date</TableHead>
                  <TableHead className="bg-muted">Status</TableHead>
                  <TableHead className="bg-muted">Gmail</TableHead>
                  <TableHead className="bg-muted">Outlook</TableHead>
                  <TableHead className="bg-muted">Yahoo</TableHead>
                  <TableHead className="bg-muted">Other</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.map((test) => {
                  const byProvider = groupByProvider(test.results);
                  return (
                    <TableRow key={test.id}>
                      <TableCell className="text-sm">
                        {new Date(test.created_at).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={test.status} />
                      </TableCell>
                      <TableCell>
                        <FolderBadge result={byProvider.gmail} />
                      </TableCell>
                      <TableCell>
                        <FolderBadge result={byProvider.outlook} />
                      </TableCell>
                      <TableCell>
                        <FolderBadge result={byProvider.yahoo} />
                      </TableCell>
                      <TableCell>
                        {byProvider.other.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {byProvider.other.map((r, i) => (
                              <FolderBadge
                                key={i}
                                result={r}
                                showProvider
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            --
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByProvider(results: ProviderResult[]) {
  const gmail = results.find((r) =>
    r.provider.toLowerCase().includes("gmail"),
  );
  const outlook = results.find(
    (r) =>
      r.provider.toLowerCase().includes("outlook") ||
      r.provider.toLowerCase().includes("microsoft"),
  );
  const yahoo = results.find((r) =>
    r.provider.toLowerCase().includes("yahoo"),
  );
  const other = results.filter(
    (r) => r !== gmail && r !== outlook && r !== yahoo,
  );

  return { gmail: gmail ?? null, outlook: outlook ?? null, yahoo: yahoo ?? null, other };
}

function StatusBadge({
  status,
}: {
  status: "pending" | "processing" | "completed" | "failed";
}) {
  const config: Record<
    string,
    { variant: "secondary" | "warning" | "success" | "destructive"; label: string }
  > = {
    pending: { variant: "secondary", label: "Pending" },
    processing: { variant: "warning", label: "Processing" },
    completed: { variant: "success", label: "Completed" },
    failed: { variant: "destructive", label: "Failed" },
  };

  const c = config[status] ?? config.pending;

  return (
    <Badge variant={c.variant} className="text-xs">
      {status === "processing" && (
        <Loader2 className="h-3 w-3 animate-spin mr-1" />
      )}
      {c.label}
    </Badge>
  );
}

function FolderBadge({
  result,
  showProvider,
}: {
  result: ProviderResult | null;
  showProvider?: boolean;
}) {
  if (!result) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const folder = result.folder?.toLowerCase() ?? "unknown";
  const variant: "success" | "warning" | "destructive" | "secondary" =
    folder === "inbox"
      ? "success"
      : folder === "spam"
        ? "destructive"
        : folder === "missing" || folder === "not received"
          ? "warning"
          : "secondary";

  return (
    <Badge variant={variant} className="text-xs capitalize">
      {showProvider ? `${result.provider}: ` : ""}
      {result.folder}
    </Badge>
  );
}
