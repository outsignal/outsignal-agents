"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Reply } from "@/lib/emailbison/types";

interface InboxReplyDetailProps {
  reply: Reply;
}

export function InboxReplyDetail({ reply }: InboxReplyDetailProps) {
  const [expanded, setExpanded] = useState(false);

  const fromDisplay = reply.from_name
    ? `${reply.from_name}`
    : reply.from_email_address;

  const dateStr = new Date(reply.date_received).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const typeBadgeVariant =
    reply.type === "Bounced" ? "destructive" as const : "success" as const;

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell className="w-[24px] pr-0">
          {!reply.read && (
            <div className="h-2 w-2 rounded-full bg-blue-500" />
          )}
        </TableCell>
        <TableCell>
          <div className={`text-sm ${!reply.read ? "font-bold" : "font-medium"}`}>
            {fromDisplay}
          </div>
          <div className="text-xs text-muted-foreground">
            {reply.from_email_address}
          </div>
        </TableCell>
        <TableCell>
          <span className={`text-sm ${!reply.read ? "font-bold" : ""}`}>
            {reply.subject ?? "(No subject)"}
          </span>
          {reply.text_body && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 max-w-md">
              {reply.text_body.slice(0, 120)}
            </p>
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {reply.primary_to_email_address}
        </TableCell>
        <TableCell>
          <Badge variant={typeBadgeVariant} className="text-xs">
            {reply.type}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex gap-1 flex-wrap">
            {reply.interested && (
              <Badge className="text-xs bg-brand text-brand-foreground">
                Interested
              </Badge>
            )}
            {reply.automated_reply && (
              <Badge variant="secondary" className="text-xs">
                Auto
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
          {dateStr}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-0">
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-muted-foreground">From: </span>
                  {reply.from_name && `${reply.from_name} `}
                  &lt;{reply.from_email_address}&gt;
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">To: </span>
                  {reply.primary_to_email_address}
                </div>
                {reply.cc && reply.cc.length > 0 && (
                  <div>
                    <span className="font-medium text-muted-foreground">CC: </span>
                    {reply.cc.map((r) => r.email).join(", ")}
                  </div>
                )}
                <div>
                  <span className="font-medium text-muted-foreground">Date: </span>
                  {new Date(reply.date_received).toLocaleString()}
                </div>
              </div>

              <div className="flex gap-2 text-xs">
                <Badge variant="secondary">Campaign #{reply.campaign_id}</Badge>
                <Badge variant="secondary">Lead #{reply.lead_id}</Badge>
                <Badge variant="secondary">Sender #{reply.sender_email_id}</Badge>
                {reply.read ? (
                  <Badge variant="secondary">Read</Badge>
                ) : (
                  <Badge className="bg-blue-100 text-blue-800">Unread</Badge>
                )}
                {reply.interested && (
                  <Badge className="bg-brand text-brand-foreground">
                    Interested
                  </Badge>
                )}
                {reply.automated_reply && (
                  <Badge variant="secondary">Auto-Reply</Badge>
                )}
              </div>

              <div className="border rounded-lg bg-white p-4">
                {reply.html_body ? (
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(reply.html_body) }}
                  />
                ) : reply.text_body ? (
                  <pre className="whitespace-pre-wrap text-sm font-sans">
                    {reply.text_body}
                  </pre>
                ) : (
                  <p className="text-muted-foreground text-sm italic">
                    No message body
                  </p>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
