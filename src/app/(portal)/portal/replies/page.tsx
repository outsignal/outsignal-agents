import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Star } from "lucide-react";

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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Reply {
  id: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  bodyPreview: string | null;
  receivedAt: string;
  isInterested: boolean;
}

interface ReplyPayload {
  from_name?: string;
  from_email?: string;
  subject?: string;
  text_body?: string;
  body_preview?: string;
  lead_name?: string;
  lead_email?: string;
}

export default async function PortalRepliesPage() {
  const { workspaceSlug } = await getPortalSession();

  const events = await prisma.webhookEvent.findMany({
    where: {
      workspace: workspaceSlug,
      eventType: { in: ["LEAD_REPLIED", "LEAD_INTERESTED", "POLLED_REPLY"] },
      isAutomated: false,
    },
    orderBy: { receivedAt: "desc" },
    take: 50,
  });

  const replies: Reply[] = events.map((event) => {
    let parsed: ReplyPayload = {};
    try {
      parsed = JSON.parse(event.payload) as ReplyPayload;
    } catch {
      // payload may not be valid JSON
    }

    const fromName = parsed.from_name || parsed.lead_name || null;
    const fromEmail = parsed.from_email || parsed.lead_email || event.leadEmail || null;
    const subject = parsed.subject || null;

    let bodyPreview: string | null = null;
    const rawBody = parsed.text_body || parsed.body_preview || null;
    if (rawBody) {
      bodyPreview = stripHtml(rawBody).slice(0, 200);
    }

    return {
      id: event.id,
      fromName,
      fromEmail,
      subject,
      bodyPreview,
      receivedAt: event.receivedAt.toISOString(),
      isInterested: event.eventType === "LEAD_INTERESTED",
    };
  });

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
        {replies.length > 0 && (
          <Badge className="bg-emerald-100 text-emerald-800 ml-auto text-sm">
            {replies.length}
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
          {replies.map((reply) => (
            <Card key={reply.id}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* From line */}
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {reply.fromName || reply.fromEmail || "Unknown sender"}
                      </p>
                      {reply.isInterested && (
                        <Badge className="bg-amber-100 text-amber-800 text-xs shrink-0">
                          <Star className="h-3 w-3 mr-1" />
                          Interested
                        </Badge>
                      )}
                    </div>

                    {/* Email (if name is shown) */}
                    {reply.fromName && reply.fromEmail && (
                      <p className="text-xs text-muted-foreground truncate">
                        {reply.fromEmail}
                      </p>
                    )}

                    {/* Subject */}
                    {reply.subject && (
                      <p className="text-sm text-foreground truncate">
                        {reply.subject}
                      </p>
                    )}

                    {/* Body preview */}
                    {reply.bodyPreview && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {reply.bodyPreview}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {timeAgo(reply.receivedAt)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
