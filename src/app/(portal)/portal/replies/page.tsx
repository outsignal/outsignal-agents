import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Star } from "lucide-react";
import Link from "next/link";

const PAGE_SIZE = 25;

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const INTENT_COLORS: Record<string, string> = {
  interested: "bg-emerald-100 text-emerald-800",
  not_interested: "bg-red-100 text-red-800",
  out_of_office: "bg-blue-100 text-blue-800",
  wrong_person: "bg-orange-100 text-orange-800",
  unsubscribe: "bg-gray-100 text-gray-600",
  question: "bg-purple-100 text-purple-800",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-emerald-100 text-emerald-800",
  negative: "bg-red-100 text-red-800",
  neutral: "bg-gray-100 text-gray-600",
};

export default async function PortalRepliesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { workspaceSlug } = await getPortalSession();
  const { page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const skip = (currentPage - 1) * PAGE_SIZE;

  const whereClause = {
    workspaceSlug,
    direction: "inbound" as const,
  };

  const [replies, totalCount] = await Promise.all([
    prisma.reply.findMany({
      where: whereClause,
      orderBy: { receivedAt: "desc" },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        senderName: true,
        senderEmail: true,
        leadEmail: true,
        subject: true,
        bodyText: true,
        receivedAt: true,
        interested: true,
        intent: true,
        overrideIntent: true,
        sentiment: true,
        overrideSentiment: true,
        emailBisonParentId: true,
        emailBisonReplyId: true,
      },
    }),
    prisma.reply.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold">Replies</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recent replies from your campaigns
          </p>
        </div>
        {totalCount > 0 && (
          <Badge className="bg-emerald-100 text-emerald-800 ml-auto text-sm">
            {totalCount}
          </Badge>
        )}
      </div>

      {/* Reply List */}
      {replies.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Mail className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No replies yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Replies from your campaign prospects will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {replies.map((reply) => {
            const threadId = reply.emailBisonParentId ?? reply.emailBisonReplyId;
            const displayIntent = reply.overrideIntent ?? reply.intent;
            const displaySentiment = reply.overrideSentiment ?? reply.sentiment;
            const bodyPreview = reply.bodyText
              ? reply.bodyText.replace(/\s+/g, " ").trim().slice(0, 200)
              : null;

            const content = (
              <Card className={threadId ? "hover:bg-muted/50 transition-colors cursor-pointer" : ""}>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* From line */}
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {reply.senderName || reply.senderEmail || reply.leadEmail || "Unknown sender"}
                        </p>
                        {reply.interested && (
                          <Badge className="bg-amber-100 text-amber-800 text-xs shrink-0">
                            <Star className="h-3 w-3 mr-1" />
                            Interested
                          </Badge>
                        )}
                        {displayIntent && INTENT_COLORS[displayIntent] && (
                          <Badge className={`text-xs shrink-0 ${INTENT_COLORS[displayIntent]}`}>
                            {displayIntent.replace(/_/g, " ")}
                          </Badge>
                        )}
                        {displaySentiment && SENTIMENT_COLORS[displaySentiment] && (
                          <Badge className={`text-xs shrink-0 ${SENTIMENT_COLORS[displaySentiment]}`}>
                            {displaySentiment}
                          </Badge>
                        )}
                      </div>

                      {/* Email (if name is shown) */}
                      {reply.senderName && (reply.senderEmail || reply.leadEmail) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {reply.senderEmail || reply.leadEmail}
                        </p>
                      )}

                      {/* Subject */}
                      {reply.subject && (
                        <p className="text-sm text-foreground truncate">
                          {reply.subject}
                        </p>
                      )}

                      {/* Body preview */}
                      {bodyPreview && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {bodyPreview}
                        </p>
                      )}
                    </div>

                    {/* Timestamp */}
                    <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {timeAgo(reply.receivedAt.toISOString())}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );

            if (threadId) {
              return (
                <Link key={reply.id} href={`/portal/inbox?thread=${threadId}`} className="block">
                  {content}
                </Link>
              );
            }

            return <div key={reply.id}>{content}</div>;
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          {currentPage > 1 && (
            <Link
              href={`/portal/replies?page=${currentPage - 1}`}
              className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
            >
              Previous
            </Link>
          )}
          <span className="text-xs text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages && (
            <Link
              href={`/portal/replies?page=${currentPage + 1}`}
              className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
