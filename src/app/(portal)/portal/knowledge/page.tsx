import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BookOpen, FileText, Clock } from "lucide-react";

function timeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function primaryTag(tags: string | null): string {
  if (!tags) return "General";
  const first = tags.split(",")[0]?.trim();
  return first || "General";
}

export default async function PortalKnowledgePage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }

  // Fetch all knowledge documents (global resources)
  const documents = await prisma.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      tags: true,
      source: true,
      createdAt: true,
    },
    take: 100,
  });

  // Group documents by first tag
  const categories = new Map<string, typeof documents>();
  for (const doc of documents) {
    const cat = primaryTag(doc.tags);
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(doc);
  }

  const sortedCategories = [...categories.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-foreground">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resources and guides to help you get the most from your campaigns
          </p>
        </div>
        {documents.length > 0 && (
          <Badge variant="secondary" className="text-xs font-mono">
            {documents.length} articles
          </Badge>
        )}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge articles yet"
          description="Knowledge base articles and campaign guides will appear here as your Outsignal team publishes resources for your workspace."
        />
      ) : (
        sortedCategories.map(([category, docs]) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                {category}
                <Badge variant="secondary" className="text-xs font-mono ml-1">
                  {docs.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium text-foreground">
                          {doc.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {doc.source === "url" ? "Web resource" : "Uploaded document"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground font-mono tabular-nums">
                          {timeAgo(doc.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
