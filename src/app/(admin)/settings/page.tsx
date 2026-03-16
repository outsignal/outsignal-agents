export const dynamic = "force-dynamic";

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
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { ApiTokenForm } from "@/components/settings/api-token-form";

async function getWorkspaceStatuses() {
  const workspaces = await getAllWorkspaces();
  const results = await Promise.allSettled(
    workspaces.map(async (ws) => {
      if (!ws.hasApiToken) {
        return { ...ws, connected: false };
      }
      const config = await getWorkspaceBySlug(ws.slug);
      if (!config) return { ...ws, connected: false };
      const client = new EmailBisonClient(config.apiToken);
      const connected = await client.testConnection();
      return { ...ws, connected, apiTokenPreview: config.apiToken.slice(0, 8) + "..." };
    }),
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return { ...workspaces[i], connected: false };
  });
}

export default async function SettingsPage() {
  const workspaces = await getWorkspaceStatuses();
  return (
    <div>
      <Header
        title="Settings"
        description="Manage workspace connections and configuration"
      />
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Workspaces</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((ws) => (
                    <TableRow key={ws.slug}>
                      <TableCell className="font-medium">{ws.name}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {ws.slug}
                      </TableCell>
                      <TableCell>
                        {ws.connected ? (
                          <Badge variant="success" className="text-xs">
                            Connected
                          </Badge>
                        ) : ws.hasApiToken ? (
                          <Badge variant="destructive" className="text-xs">
                            Error
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            {ws.status === "pending_emailbison"
                              ? "Pending Token"
                              : ws.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!ws.hasApiToken ? (
                          <ApiTokenForm slug={ws.slug} />
                        ) : (
                          <span className="text-xs text-muted-foreground">Configured</span>
                        )}
                      </TableCell>
                    </TableRow>
                ))}
                {workspaces.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No workspaces configured. Use the Onboard Client page to
                      add your first client.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Webhook Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              To receive real-time bounce and reply data, configure webhooks in
              Email Bison for each workspace:
            </p>
            <div className="rounded-lg bg-muted p-4">
              <p className="font-medium text-foreground mb-1">Webhook URL:</p>
              <code className="text-xs">
                {`${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/emailbison?workspace={slug}`}
              </code>
            </div>
            <p className="text-muted-foreground">
              Enable these events: Email Sent, Reply Received, Bounce,
              Interested, Unsubscribed.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
