import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { WorkspaceNav } from "@/components/workspace/workspace-nav";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { name: true, slug: true, vertical: true },
  });

  if (!workspace) {
    notFound();
  }

  return (
    <div>
      <div className="border-b border-border bg-background px-4 sm:px-8 pt-4">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
          <Link
            href="/"
            className="hover:text-foreground transition-colors"
          >
            Workspaces
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-foreground font-medium">
            {workspace.name}
          </span>
        </nav>

        {/* Workspace heading + vertical badge + portal link */}
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-2xl font-heading font-bold tracking-tight">
            {workspace.name}
          </h1>
          {workspace.vertical && (
            <Badge variant="secondary" className="text-xs">
              {workspace.vertical}
            </Badge>
          )}
          <a
            href={`https://portal.outsignal.ai/portal/${slug}/inbox`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-brand transition-colors"
          >
            Open portal
            <ExternalLink className="size-3.5" />
          </a>
        </div>

        <WorkspaceNav slug={slug} workspaceName={workspace.name} />
      </div>
      <div className="p-4 sm:p-8">{children}</div>
    </div>
  );
}
