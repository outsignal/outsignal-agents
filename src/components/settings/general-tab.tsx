"use client";

import { useState, useEffect } from "react";
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
import { ApiTokenForm } from "@/components/settings/api-token-form";
import { Loader2 } from "lucide-react";

interface WorkspaceStatus {
  slug: string;
  name: string;
  status: string;
  hasApiToken: boolean;
  connected: boolean;
  apiTokenPreview?: string;
}

export default function GeneralTab() {
  const [workspaces, setWorkspaces] = useState<WorkspaceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function fetchStatuses() {
      try {
        const res = await fetch("/api/settings/workspace-statuses");
        const json = await res.json();
        if (active) setWorkspaces(json.workspaces ?? []);
      } catch {
        // silent
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchStatuses();
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
              {`${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/emailbison?workspace={slug}`}
            </code>
          </div>
          <p className="text-muted-foreground">
            Enable these events: Email Sent, Reply Received, Bounce,
            Interested, Unsubscribed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
