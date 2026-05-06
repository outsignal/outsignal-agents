import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  isNeedsWebsiteIcpReasoning,
  isUnscorableIcpReasoning,
} from "@/lib/icp/status";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceScore {
  workspace: string;
  icpScore: number | null;
  icpReasoning: string | null;
  status: string;
}

export interface PersonHeaderProps {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  location: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  status: string;
  workspaces: WorkspaceScore[];
}

// ─── Status badge rendering ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; className: string }
  > = {
    new: {
      label: "New",
      className: "bg-secondary text-secondary-foreground border-border",
    },
    contacted: {
      label: "Contacted",
      className: "bg-blue-50 text-blue-700 border-blue-200",
    },
    replied: {
      label: "Replied",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    interested: {
      label: "Interested",
      className: "bg-brand/15 text-brand-foreground border-brand/20",
    },
    bounced: {
      label: "Bounced",
      className: "bg-red-50 text-red-700 border-red-200",
    },
    unsubscribed: {
      label: "Unsubscribed",
      className: "border-border text-muted-foreground",
    },
  };

  const config = map[status] ?? {
    label: status,
    className: "bg-secondary text-secondary-foreground border-border",
  };

  return (
    <Badge
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </Badge>
  );
}

// ─── ICP score badge color ────────────────────────────────────────────────────

function icpScoreClass(score: number): string {
  if (score >= 80) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 60) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

// ─── PersonHeader component ───────────────────────────────────────────────────

export function PersonHeader({
  email,
  firstName,
  lastName,
  company,
  jobTitle,
  location,
  linkedinUrl,
  phone,
  status,
  workspaces,
}: PersonHeaderProps) {
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") || null;

  const jobLine = [jobTitle, company].filter(Boolean).join(" at ");

  return (
    <div className="border-b border-border px-8 py-6">
      {/* Name row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-semibold text-foreground tracking-tight">
            {fullName ?? (
              <span className="text-muted-foreground font-normal italic">
                No name
              </span>
            )}
          </h1>

          {/* Job title + company */}
          {jobLine && (
            <p className="text-sm text-muted-foreground mt-0.5">{jobLine}</p>
          )}
        </div>

        {/* Status badge */}
        <StatusBadge status={status} />
      </div>

      {/* Metadata pills row */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {/* Email */}
        <span className="text-sm text-muted-foreground font-mono">{email}</span>

        {/* Phone */}
        {phone && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <a
              href={`tel:${phone}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {phone}
            </a>
          </>
        )}

        {/* Location */}
        {location && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-sm text-muted-foreground">{location}</span>
          </>
        )}

        {/* LinkedIn link */}
        {linkedinUrl && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600 transition-colors"
            >
              LinkedIn
              <ExternalLink className="w-3 h-3" />
            </a>
          </>
        )}
      </div>

      {/* ICP score badges per workspace */}
      {workspaces.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className="text-xs text-muted-foreground mr-0.5">ICP:</span>
          {workspaces.map((ws) => {
            if (ws.icpScore !== null) {
              return (
                <span
                  key={ws.workspace}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${icpScoreClass(ws.icpScore)}`}
                >
                  {ws.workspace}: {ws.icpScore}
                </span>
              );
            }
            if (isUnscorableIcpReasoning(ws.icpReasoning)) {
              return (
                <span
                  key={ws.workspace}
                  className="inline-flex items-center px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-xs font-medium text-red-700"
                >
                  {ws.workspace}: Unscorable
                </span>
              );
            }
            if (isNeedsWebsiteIcpReasoning(ws.icpReasoning)) {
              return (
                <span
                  key={ws.workspace}
                  className="inline-flex items-center px-2 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-xs font-medium text-sky-700"
                >
                  {ws.workspace}: Needs website
                </span>
              );
            }
            return null;
          })}
          {workspaces.every(
            (ws) => ws.icpScore === null && !ws.icpReasoning?.trim(),
          ) && (
            <span className="text-xs text-muted-foreground italic">
              Not scored
            </span>
          )}
        </div>
      )}
    </div>
  );
}
