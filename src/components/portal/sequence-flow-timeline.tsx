"use client";

import { useState } from "react";
import {
  Mail,
  Eye,
  UserPlus,
  MessageSquare,
  Reply,
  ThumbsUp,
  Send,
  Play,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Data types ──────────────────────────────────────────────────────────────

interface EmailTimelineStep {
  type: "email";
  position: number;
  subject: string;
  subjectVariantB?: string;
  body: string;
  delayDays: number;
}

interface LinkedInTimelineStep {
  type: "linkedin";
  position: number;
  actionType:
    | "profile_view"
    | "connect_request"
    | "connection_request"
    | "message"
    | "follow_up"
    | "like_post"
    | "inmail";
  body?: string;
  delayDays: number;
  notes?: string;
}

export type TimelineStep = EmailTimelineStep | LinkedInTimelineStep;

interface Props {
  steps: TimelineStep[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseBody(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

const linkedInActionMeta: Record<
  LinkedInTimelineStep["actionType"],
  { label: string; icon: React.ReactNode }
> = {
  profile_view: {
    label: "View Profile",
    icon: <Eye className="h-4 w-4" />,
  },
  connect_request: {
    label: "Connection Request",
    icon: <UserPlus className="h-4 w-4" />,
  },
  connection_request: {
    label: "Connection Request",
    icon: <UserPlus className="h-4 w-4" />,
  },
  message: {
    label: "Send Message",
    icon: <MessageSquare className="h-4 w-4" />,
  },
  follow_up: {
    label: "Follow-up Message",
    icon: <Reply className="h-4 w-4" />,
  },
  like_post: {
    label: "Like Post",
    icon: <ThumbsUp className="h-4 w-4" />,
  },
  inmail: {
    label: "Send InMail",
    icon: <Send className="h-4 w-4" />,
  },
};

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DelayPill({
  delayDays,
  isFirst,
}: {
  delayDays: number;
  isFirst: boolean;
}) {
  if (isFirst) {
    return (
      <div className="flex items-center gap-2 py-1.5">
        <div className="w-8 shrink-0" />
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          Start
        </span>
      </div>
    );
  }
  if (delayDays === 0) return null;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-8 shrink-0" />
      <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
        {delayDays === 1 ? "1 day later" : `${delayDays} days later`}
      </span>
    </div>
  );
}

function EmailCard({
  step,
  expanded,
  onToggle,
  showChannel,
}: {
  step: EmailTimelineStep;
  expanded: boolean;
  onToggle: () => void;
  showChannel: boolean;
}) {
  const body = normaliseBody(step.body);

  return (
    <div
      onClick={onToggle}
      className="flex-1 min-w-0 border rounded-lg p-3 hover:bg-muted/20 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[#635BFF]/10 text-[#635BFF] text-[10px] font-semibold">
            {step.position}
          </span>
          <span className="font-medium text-sm truncate">
            {step.subject || "(No subject)"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showChannel && (
            <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
              Email
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {step.subjectVariantB && !expanded && (
        <p className="text-xs text-muted-foreground mb-1.5 pl-7">
          <span className="font-medium">B:</span> {step.subjectVariantB}
        </p>
      )}

      {!expanded && (
        <p className="text-xs text-muted-foreground pl-7 line-clamp-2 leading-relaxed">
          {body}
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {step.subjectVariantB && (
            <div>
              <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1">
                Subject (Variant B)
              </p>
              <p className="text-sm font-medium">{step.subjectVariantB}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1.5">
              Body
            </p>
            <div className="text-sm leading-relaxed whitespace-pre-line bg-muted/30 rounded-md px-3 py-2.5">
              {body}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkedInCard({
  step,
  expanded,
  onToggle,
  showChannel,
}: {
  step: LinkedInTimelineStep;
  expanded: boolean;
  onToggle: () => void;
  showChannel: boolean;
}) {
  const meta = linkedInActionMeta[step.actionType] ?? {
    label: step.actionType?.replace(/_/g, " ") ?? "LinkedIn Action",
    icon: <MessageSquare className="h-4 w-4" />,
  };
  const body = step.body ? normaliseBody(step.body) : null;
  const hasBody = !!body;

  return (
    <div
      onClick={hasBody ? onToggle : undefined}
      className={cn(
        "flex-1 min-w-0 border rounded-lg p-3 transition-colors",
        hasBody
          ? "hover:bg-muted/20 cursor-pointer"
          : "cursor-default",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[#635BFF]/10 text-[#635BFF] text-[10px] font-semibold">
            {step.position}
          </span>
          <span className="text-blue-600 shrink-0">{meta.icon}</span>
          <span className="font-medium text-sm">{meta.label}</span>
        </div>
        {step.notes && (
          <p className="text-xs text-muted-foreground mt-0.5 pl-7">{step.notes}</p>
        )}
        <div className="flex items-center gap-2 shrink-0">
          {showChannel && (
            <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
              LinkedIn
            </span>
          )}
          {hasBody && (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          )}
        </div>
      </div>

      {hasBody && !expanded && (
        <p className="text-xs text-muted-foreground mt-1.5 pl-7 line-clamp-2 leading-relaxed">
          {body}
        </p>
      )}

      {hasBody && expanded && (
        <div className="mt-3 border-t pt-3">
          <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground mb-1.5">
            Message
          </p>
          <div className="text-sm leading-relaxed whitespace-pre-line bg-muted/30 rounded-md px-3 py-2.5">
            {body}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SequenceFlowTimeline({ steps }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No sequence steps configured yet.
      </p>
    );
  }

  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const isMultiChannel =
    sorted.some((s) => s.type === "email") &&
    sorted.some((s) => s.type === "linkedin");

  function toggle(position: number) {
    setExpandedStep((prev) => (prev === position ? null : position));
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-0">
        {/* Start marker */}
        <div className="relative flex items-center gap-3 pb-2">
          <div className="relative z-10 shrink-0 h-8 w-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center ring-2 ring-background">
            <Play className="h-3.5 w-3.5 fill-current" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Campaign Start
          </span>
        </div>

        {sorted.map((step, idx) => {
          const isFirst = idx === 0;
          const expanded = expandedStep === step.position;

          return (
            <div key={`${step.type}-${step.position}`}>
              {/* Delay pill */}
              <DelayPill delayDays={step.delayDays} isFirst={isFirst} />

              {/* Step row */}
              <div className="relative flex items-start gap-3 py-1">
                {/* Node */}
                <div
                  className={cn(
                    "relative z-10 shrink-0 h-8 w-8 rounded-full flex items-center justify-center ring-2 ring-background",
                    step.type === "email"
                      ? "bg-[#635BFF]/10 text-[#635BFF]"
                      : "bg-blue-50 text-blue-600",
                  )}
                >
                  {step.type === "email" ? (
                    <Mail className="h-3.5 w-3.5" />
                  ) : (
                    <LinkedInIcon className="h-3.5 w-3.5" />
                  )}
                </div>

                {/* Card */}
                {step.type === "email" ? (
                  <EmailCard
                    step={step}
                    expanded={expanded}
                    onToggle={() => toggle(step.position)}
                    showChannel={isMultiChannel}
                  />
                ) : (
                  <LinkedInCard
                    step={step}
                    expanded={expanded}
                    onToggle={() => toggle(step.position)}
                    showChannel={isMultiChannel}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* End marker */}
        <div className="relative flex items-center gap-3 pt-2">
          <div className="relative z-10 shrink-0 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center ring-2 ring-background">
            <CheckCircle2 className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Sequence Complete
          </span>
        </div>
      </div>
    </div>
  );
}
