"use client";

import { Mail, Linkedin, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface WorkspaceSender {
  id: string;
  name: string;
  emailAddress: string | null;
  emailSenderName: string | null;
  linkedinProfileUrl: string | null;
  loginMethod: string;
  sessionStatus: string;
  linkedinTier: string;
  healthStatus: string;
  emailBounceStatus: string;
  warmupDay: number;
  status: string;
  lastPolledAt: string | null;
  lastKeepaliveAt: string | null;
  updatedAt: string;
}

interface WorkspaceSendersContentProps {
  emailSenders: WorkspaceSender[];
  linkedinSenders: WorkspaceSender[];
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function truncateUrl(url: string, maxLen = 30): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const display = u.hostname + path;
    return display.length > maxLen ? display.slice(0, maxLen) + "\u2026" : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "\u2026" : url;
  }
}

function OnlineIndicator({ lastPolledAt }: { lastPolledAt: string | null }) {
  const isOnline =
    lastPolledAt && Date.now() - new Date(lastPolledAt).getTime() < 10 * 60_000;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          isOnline ? "bg-emerald-500 animate-pulse" : "bg-red-500",
        )}
      />
      <span
        className={cn(
          "text-xs font-medium",
          isOnline ? "text-emerald-600" : "text-red-500",
        )}
      >
        {lastPolledAt
          ? isOnline
            ? `Online \u00b7 ${formatRelativeTime(lastPolledAt)}`
            : `Offline \u00b7 ${formatRelativeTime(lastPolledAt)}`
          : "Offline \u00b7 Never seen"}
      </span>
    </div>
  );
}

function SenderStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="success" dot>
          Active
        </Badge>
      );
    case "paused":
      return (
        <Badge variant="warning" dot>
          Paused
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="destructive" dot>
          Disabled
        </Badge>
      );
    case "setup":
      return (
        <Badge variant="secondary" dot>
          Setup
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status || "\u2014"}</Badge>;
  }
}

function SessionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="success" dot>
          Active
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="warning" dot>
          Expired
        </Badge>
      );
    case "not_setup":
      return (
        <Badge variant="secondary" dot>
          Not Setup
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status || "\u2014"}</Badge>;
  }
}

export function WorkspaceSendersContent({
  emailSenders,
  linkedinSenders,
}: WorkspaceSendersContentProps) {
  const defaultTab = linkedinSenders.length > 0 ? "linkedin" : "email";

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList variant="line">
        <TabsTrigger value="email">
          <Mail className="h-4 w-4" />
          Email ({emailSenders.length})
        </TabsTrigger>
        <TabsTrigger value="linkedin">
          <Linkedin className="h-4 w-4" />
          LinkedIn ({linkedinSenders.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="email" className="mt-4">
        {emailSenders.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="No email senders"
            description="No email sending accounts are linked to this workspace."
          />
        ) : (
          <>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Bounce Status</TableHead>
                    <TableHead>Last Synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emailSenders.map((sender) => (
                    <TableRow key={sender.id}>
                      <TableCell className="font-medium">
                        {sender.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sender.emailAddress ?? "\u2014"}
                      </TableCell>
                      <TableCell>
                        <SenderStatusBadge status={sender.status} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={sender.healthStatus}
                          type="health"
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={sender.emailBounceStatus}
                          type="health"
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelativeTime(sender.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {emailSenders.length} email sender
              {emailSenders.length !== 1 ? "s" : ""}
            </p>
          </>
        )}
      </TabsContent>

      <TabsContent value="linkedin" className="mt-4">
        {linkedinSenders.length === 0 ? (
          <EmptyState
            icon={Linkedin}
            title="No LinkedIn senders"
            description="No LinkedIn senders are linked to this workspace."
          />
        ) : (
          <>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>LinkedIn Profile</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Worker</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedinSenders.map((sender) => (
                    <TableRow key={sender.id}>
                      <TableCell className="font-medium">
                        {sender.name}
                      </TableCell>
                      <TableCell>
                        {sender.linkedinProfileUrl ? (
                          <a
                            href={sender.linkedinProfileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                          >
                            {truncateUrl(sender.linkedinProfileUrl)}
                            <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <SessionStatusBadge status={sender.sessionStatus} />
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {sender.linkedinTier}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={sender.healthStatus}
                          type="health"
                        />
                      </TableCell>
                      <TableCell>
                        <OnlineIndicator lastPolledAt={sender.lastPolledAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {linkedinSenders.length} LinkedIn sender
              {linkedinSenders.length !== 1 ? "s" : ""}
            </p>
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
