import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageSquare, Star } from "lucide-react";
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

export default async function PortalRepliesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;
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
          <p className="text-sm text-stone-500 mt-1">
            Recent replies from your campaigns
          </p>
        </div>
        {totalCount > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[28px] h-7 rounded-full bg-stone-100 text-stone-600 text-sm font-medium px-2 font-mono tabular-nums">
            {totalCount}
          </span>
        )}
      </div>

      {/* Reply List */}
      {replies.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No replies yet"
          description="Replies from your campaign prospects will appear here."
        />
      ) : (
        <div className="rounded-lg border border-stone-200 overflow-hidden">
          {/* Table header */}
          <div className="hidden md:grid md:grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 bg-stone-50 border-b border-stone-200">
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">From</span>
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Intent</span>
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Sentiment</span>
            <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">Received</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-stone-100">
            {replies.map((reply) => {
              const threadId = reply.emailBisonParentId ?? reply.emailBisonReplyId;
              const displayIntent = reply.overrideIntent ?? reply.intent;
              const displaySentiment = reply.overrideSentiment ?? reply.sentiment;
              const bodyPreview = reply.bodyText
                ? reply.bodyText.replace(/\s+/g, " ").trim().slice(0, 200)
                : null;

              const row = (
                <div className={`px-4 py-3.5 bg-white ${threadId ? "hover:bg-stone-50 transition-colors cursor-pointer" : ""}`}>
                  {/* Desktop layout */}
                  <div className="hidden md:grid md:grid-cols-[1fr_auto_auto_auto] gap-4 items-center">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-900 truncate">
                          {reply.senderName || reply.senderEmail || reply.leadEmail || "Unknown sender"}
                        </span>
                        {reply.interested && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                            <Star className="h-2.5 w-2.5" />
                            Interested
                          </span>
                        )}
                      </div>
                      {reply.senderName && (reply.senderEmail || reply.leadEmail) && (
                        <p className="text-xs text-stone-400 font-mono truncate">
                          {reply.senderEmail || reply.leadEmail}
                        </p>
                      )}
                      {reply.subject && (
                        <p className="text-sm text-stone-600 truncate">{reply.subject}</p>
                      )}
                      {bodyPreview && (
                        <p className="text-xs text-stone-400 line-clamp-1">{bodyPreview}</p>
                      )}
                    </div>

                    <div className="shrink-0 w-28 text-right">
                      {displayIntent && (
                        <StatusBadge status={displayIntent} type="intent" />
                      )}
                    </div>

                    <div className="shrink-0 w-20 text-right">
                      {displaySentiment && (
                        <StatusBadge status={displaySentiment} type="sentiment" />
                      )}
                    </div>

                    <span className="text-xs text-stone-400 font-mono tabular-nums whitespace-nowrap shrink-0 w-16 text-right">
                      {timeAgo(reply.receivedAt.toISOString())}
                    </span>
                  </div>

                  {/* Mobile layout */}
                  <div className="md:hidden space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-stone-900 truncate">
                            {reply.senderName || reply.senderEmail || reply.leadEmail || "Unknown sender"}
                          </span>
                          {reply.interested && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                              <Star className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                        {reply.senderName && (reply.senderEmail || reply.leadEmail) && (
                          <p className="text-xs text-stone-400 font-mono truncate">
                            {reply.senderEmail || reply.leadEmail}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-stone-400 font-mono tabular-nums whitespace-nowrap shrink-0">
                        {timeAgo(reply.receivedAt.toISOString())}
                      </span>
                    </div>
                    {reply.subject && (
                      <p className="text-sm text-stone-600 truncate">{reply.subject}</p>
                    )}
                    {bodyPreview && (
                      <p className="text-xs text-stone-400 line-clamp-2">{bodyPreview}</p>
                    )}
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {displayIntent && (
                        <StatusBadge status={displayIntent} type="intent" />
                      )}
                      {displaySentiment && (
                        <StatusBadge status={displaySentiment} type="sentiment" />
                      )}
                    </div>
                  </div>
                </div>
              );

              if (threadId) {
                return (
                  <Link key={reply.id} href={`/portal/inbox?thread=${threadId}`} className="block">
                    {row}
                  </Link>
                );
              }

              return <div key={reply.id}>{row}</div>;
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          {currentPage > 1 && (
            <Link
              href={`/portal/replies?page=${currentPage - 1}`}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Previous
            </Link>
          )}
          <span className="text-xs text-stone-500 font-mono tabular-nums">
            {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages && (
            <Link
              href={`/portal/replies?page=${currentPage + 1}`}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
