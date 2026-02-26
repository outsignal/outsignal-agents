import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
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

interface LinkedInPageProps {
  params: Promise<{ slug: string }>;
}

export default async function LinkedInPage({ params }: LinkedInPageProps) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      senders: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!workspace) notFound();

  const healthColors: Record<string, string> = {
    healthy: "bg-emerald-100 text-emerald-800",
    warning: "bg-yellow-100 text-yellow-800",
    paused: "bg-orange-100 text-orange-800",
    blocked: "bg-red-100 text-red-800",
    session_expired: "bg-red-100 text-red-800",
  };

  const statusColors: Record<string, string> = {
    setup: "bg-gray-100 text-gray-800",
    active: "bg-emerald-100 text-emerald-800",
    paused: "bg-yellow-100 text-yellow-800",
    disabled: "bg-red-100 text-red-800",
  };

  return (
    <div>
      <Header
        title="LinkedIn"
        description={`Manage LinkedIn senders for ${workspace.name}`}
      />
      <div className="p-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Senders</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Warmup</TableHead>
                  <TableHead>Session</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.senders.map((sender) => (
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
                    <TableCell className="text-sm text-muted-foreground">
                      {sender.emailAddress ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${statusColors[sender.status] ?? ""}`}
                      >
                        {sender.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${healthColors[sender.healthStatus] ?? ""}`}
                      >
                        {sender.healthStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {sender.warmupDay > 0
                        ? `Day ${sender.warmupDay}`
                        : "Not started"}
                    </TableCell>
                    <TableCell>
                      <ConnectButton
                        senderId={sender.id}
                        senderName={sender.name}
                        sessionStatus={sender.sessionStatus}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {workspace.senders.length === 0 && (
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
    </div>
  );
}
