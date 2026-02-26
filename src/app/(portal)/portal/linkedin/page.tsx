import { getPortalSession } from "@/lib/portal-session";
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
import { prisma } from "@/lib/db";
import { ConnectButton } from "@/components/linkedin/connect-button";

export default async function PortalLinkedInPage() {
  const { workspaceSlug } = await getPortalSession();

  const senders = await prisma.sender.findMany({
    where: { workspaceSlug },
    orderBy: { createdAt: "desc" },
  });

  // Get today's usage per sender
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dailyUsage = await prisma.linkedInDailyUsage.findMany({
    where: {
      senderId: { in: senders.map((s) => s.id) },
      date: todayStart,
    },
  });

  const usageMap = new Map(dailyUsage.map((u) => [u.senderId, u]));

  const healthColors: Record<string, string> = {
    healthy: "bg-emerald-100 text-emerald-800",
    warning: "bg-yellow-100 text-yellow-800",
    paused: "bg-orange-100 text-orange-800",
    blocked: "bg-red-100 text-red-800",
    session_expired: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">LinkedIn</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your LinkedIn senders and connections
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Senders</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-right">Connections</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead>Session</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {senders.map((sender) => {
                const usage = usageMap.get(sender.id);
                return (
                  <TableRow key={sender.id}>
                    <TableCell className="font-medium">
                      {sender.name}
                      {sender.linkedinProfileUrl && (
                        <a
                          href={sender.linkedinProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Profile
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${healthColors[sender.healthStatus] ?? ""}`}
                      >
                        {sender.healthStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {usage?.connectionsSent ?? 0}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {usage?.messagesSent ?? 0}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {usage?.profileViews ?? 0}
                    </TableCell>
                    <TableCell>
                      <ConnectButton
                        senderId={sender.id}
                        sessionStatus={sender.sessionStatus}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {senders.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No LinkedIn senders configured yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
