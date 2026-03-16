import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function PortalPageDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;
  const { slug } = await params;

  // Find the Client linked to this workspace
  const client = await prisma.client.findFirst({
    where: { workspaceSlug },
    select: { id: true },
  });

  if (!client) {
    notFound();
  }

  // Fetch page by slug and verify it belongs to this client
  const page = await prisma.page.findUnique({
    where: { slug },
  });

  if (!page || page.clientId !== client.id) {
    notFound();
  }

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/portal/pages"
          className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Pages
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">
          {page.title}
        </span>
      </div>

      {/* Title + meta */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">{page.title}</h1>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          Last updated: {formatDate(page.updatedAt)}
        </p>
      </div>

      {/* Content */}
      <Card>
        <CardContent className="pt-6">
          {page.content ? (
            <div className="prose prose-sm max-w-none prose-headings:font-heading prose-headings:tracking-tight prose-a:text-primary prose-code:text-sm prose-pre:bg-muted prose-pre:border prose-pre:border-border">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {page.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-muted-foreground italic text-sm">
              This page has no content yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
