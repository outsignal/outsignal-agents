import { notFound } from "next/navigation";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Reply } from "@/lib/emailbison/types";
import { InboxReplyDetail } from "@/components/inbox/reply-detail";

interface InboxPageProps {
  params: Promise<{ slug: string }>;
}

export default async function InboxPage({ params }: InboxPageProps) {
  const { slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const client = new EmailBisonClient(workspace.apiToken);

  let replies: Reply[] = [];
  let error: string | null = null;

  try {
    replies = await client.getReplies();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to fetch replies";
  }

  // Sort by date received, newest first
  replies.sort(
    (a, b) =>
      new Date(b.date_received).getTime() -
      new Date(a.date_received).getTime(),
  );

  const inboxReplies = replies.filter((r) => r.folder === "Inbox");
  const bouncedReplies = replies.filter((r) => r.folder === "Bounced");
  const unreadCount = replies.filter((r) => !r.read).length;
  const interestedCount = replies.filter((r) => r.interested).length;
  const autoReplyCount = replies.filter((r) => r.automated_reply).length;

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard label="Total Replies" value={replies.length} />
        <MetricCard
          label="Unread"
          value={unreadCount}
          trend={unreadCount > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="Interested"
          value={interestedCount}
          trend={interestedCount > 0 ? "up" : "neutral"}
        />
        <MetricCard
          label="Bounced"
          value={bouncedReplies.length}
          trend={bouncedReplies.length > 0 ? "down" : "neutral"}
        />
        <MetricCard
          label="Auto-Replies"
          value={autoReplyCount}
          detail="Filtered automatically"
        />
      </div>

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox">
            Inbox ({inboxReplies.length})
          </TabsTrigger>
          <TabsTrigger value="bounced">
            Bounced ({bouncedReplies.length})
          </TabsTrigger>
          <TabsTrigger value="all">All ({replies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <ReplyTable replies={inboxReplies} />
        </TabsContent>

        <TabsContent value="bounced">
          <ReplyTable replies={bouncedReplies} />
        </TabsContent>

        <TabsContent value="all">
          <ReplyTable replies={replies} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReplyTable({ replies }: { replies: Reply[] }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[24px]"></TableHead>
              <TableHead>From</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {replies.map((reply, index) => (
              <InboxReplyDetail key={`${reply.id}-${index}`} reply={reply} />
            ))}
            {replies.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-muted-foreground"
                >
                  No replies found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
