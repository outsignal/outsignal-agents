import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";
import Link from "next/link";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function PortalPagesPage() {
  const { workspaceSlug } = await getPortalSession();

  // Find the Client linked to this workspace
  const client = await prisma.client.findFirst({
    where: { workspaceSlug },
    select: { id: true },
  });

  const pages = client
    ? await prisma.page.findMany({
        where: { clientId: client.id },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          updatedAt: true,
        },
      })
    : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold">Pages</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Documents and resources shared with you
        </p>
      </div>

      {/* Pages Grid */}
      {pages.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No pages shared yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Your account manager will share documents and resources here
                when they are ready.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pages.map((page) => (
            <Link key={page.id} href={`/portal/pages/${page.slug}`}>
              <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {page.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Updated {formatDate(page.updatedAt)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
