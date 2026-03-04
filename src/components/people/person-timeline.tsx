"use client";

import {
  Mail,
  Eye,
  MessageSquare,
  AlertCircle,
  UserPlus,
  MessageCircle,
  Sparkles,
  Circle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string;
  type:
    | "email_sent"
    | "email_opened"
    | "email_replied"
    | "email_bounced"
    | "linkedin_connect"
    | "linkedin_message"
    | "linkedin_profile_view"
    | "enrichment"
    | "other";
  title: string;
  detail?: string;
  workspace?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ─── Icon + color mapping ─────────────────────────────────────────────────────

function eventConfig(type: TimelineEvent["type"]) {
  switch (type) {
    case "email_sent":
      return { icon: Mail, color: "text-blue-500", dot: "bg-blue-500" };
    case "email_opened":
      return { icon: Eye, color: "text-green-500", dot: "bg-green-500" };
    case "email_replied":
      return { icon: MessageSquare, color: "text-brand", dot: "bg-brand" };
    case "email_bounced":
      return { icon: AlertCircle, color: "text-red-500", dot: "bg-red-500" };
    case "linkedin_connect":
      return { icon: UserPlus, color: "text-blue-500", dot: "bg-blue-500" };
    case "linkedin_message":
      return { icon: MessageCircle, color: "text-blue-500", dot: "bg-blue-500" };
    case "linkedin_profile_view":
      return { icon: Eye, color: "text-blue-500", dot: "bg-blue-500" };
    case "enrichment":
      return { icon: Sparkles, color: "text-purple-500", dot: "bg-purple-500" };
    default:
      return { icon: Circle, color: "text-muted-foreground", dot: "bg-muted-foreground" };
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHr = Math.round(diffMin / 60);
  const diffDays = Math.round(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

// ─── PersonTimeline ───────────────────────────────────────────────────────────

interface PersonTimelineProps {
  events: TimelineEvent[];
}

export function PersonTimeline({ events }: PersonTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No activity recorded
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      {/* Vertical connecting line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

      <div className="space-y-0">
        {events.map((event) => {
          const config = eventConfig(event.type);
          const Icon = config.icon;

          return (
            <div key={event.id} className="relative flex items-start gap-3 py-2">
              {/* Dot */}
              <div
                className={`absolute -left-6 top-2.5 w-[7px] h-[7px] rounded-full ${config.dot} ring-2 ring-background z-10`}
              />

              {/* Icon */}
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.color}`} />

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {event.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatRelativeTime(event.timestamp)}
                  </span>
                  {event.workspace && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {event.workspace}
                    </span>
                  )}
                </div>
                {event.detail && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {event.detail}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
