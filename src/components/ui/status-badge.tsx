"use client";

import { Badge } from "@/components/ui/badge";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "ghost"
  | "link"
  | "brand"
  | "success"
  | "warning"
  | "info"
  | "purple";

type StatusType =
  | "health"
  | "intent"
  | "invoice"
  | "enrichment"
  | "sentiment"
  | "generic";

interface StatusConfig {
  variant: BadgeVariant;
  dot?: boolean;
  label?: string;
}

const STATUS_MAPS: Record<StatusType, Record<string, StatusConfig>> = {
  health: {
    healthy: { variant: "success", dot: true, label: "Healthy" },
    warning: { variant: "warning", dot: true, label: "Warning" },
    critical: { variant: "destructive", dot: true, label: "Critical" },
    paused: { variant: "secondary", dot: true, label: "Paused" },
    blocked: { variant: "destructive", dot: true, label: "Blocked" },
    session_expired: { variant: "warning", dot: true, label: "Session Expired" },
    unknown: { variant: "secondary", label: "Unknown" },
  },
  intent: {
    interested: { variant: "success", label: "Interested" },
    meeting_booked: { variant: "success", label: "Meeting Booked" },
    objection: { variant: "warning", label: "Objection" },
    not_interested: { variant: "destructive", label: "Not Interested" },
    unsubscribe: { variant: "destructive", label: "Unsubscribe" },
    contacted: { variant: "info", label: "Contacted" },
    referral: { variant: "purple", label: "Referral" },
    out_of_office: { variant: "secondary", label: "Out of Office" },
    auto_reply: { variant: "secondary", label: "Auto Reply" },
  },
  invoice: {
    paid: { variant: "success", label: "Paid" },
    sent: { variant: "info", label: "Sent" },
    draft: { variant: "secondary", label: "Draft" },
    overdue: { variant: "destructive", label: "Overdue" },
  },
  enrichment: {
    enriched: { variant: "success", label: "Enriched" },
    partial: { variant: "warning", label: "Partial" },
    none: { variant: "secondary", label: "None" },
  },
  sentiment: {
    positive: { variant: "success", label: "Positive" },
    negative: { variant: "destructive", label: "Negative" },
    neutral: { variant: "secondary", label: "Neutral" },
  },
  generic: {},
};

// Map variant names for generic fallback
const VARIANT_NAMES: Set<string> = new Set([
  "default",
  "secondary",
  "destructive",
  "outline",
  "ghost",
  "link",
  "brand",
  "success",
  "warning",
  "info",
  "purple",
]);

interface StatusBadgeProps {
  status: string;
  type?: StatusType;
  className?: string;
}

export function StatusBadge({
  status,
  type = "generic",
  className,
}: StatusBadgeProps) {
  const typeMap = STATUS_MAPS[type] ?? STATUS_MAPS.generic;
  const config = typeMap[status];

  if (config) {
    return (
      <Badge
        variant={config.variant}
        dot={config.dot}
        className={className}
      >
        {config.label ?? status}
      </Badge>
    );
  }

  // Generic fallback: if the status string matches a variant name, use it
  const fallbackVariant: BadgeVariant = VARIANT_NAMES.has(status)
    ? (status as BadgeVariant)
    : "secondary";

  return (
    <Badge variant={fallbackVariant} className={className}>
      {status}
    </Badge>
  );
}
