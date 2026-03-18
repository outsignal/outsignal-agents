import { AlertTriangle, AlertCircle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardAlert } from "@/app/api/dashboard/stats/route";

interface AlertsSectionProps {
  alerts: DashboardAlert[];
}

const alertTypeLabel: Record<DashboardAlert["type"], string> = {
  flagged_sender: "Sender",
  failed_agent_run: "Agent Run",
  disconnected_inbox: "Inbox",
  disconnected_linkedin: "LinkedIn",
  no_linkedin_senders: "LinkedIn",
  unclassified_replies: "Replies",
  low_reply_rate: "Reply Rate",
  no_activity: "Activity",
};

export function AlertsSection({ alerts }: AlertsSectionProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {alerts.map((alert, i) => {
        const isError = alert.severity === "error";
        const Icon = isError ? AlertCircle : AlertTriangle;

        return (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 rounded-md px-3.5 py-2.5 text-sm border",
              isError
                ? "bg-red-50 border-red-200"
                : "bg-amber-50 border-amber-200"
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 mt-0.5 flex-shrink-0",
                isError ? "text-red-500" : "text-amber-500"
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs font-medium rounded px-1.5 py-0.5",
                    isError
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  )}
                >
                  {alertTypeLabel[alert.type]}
                </span>
                <span
                  className={cn(
                    "font-medium truncate",
                    isError ? "text-red-900" : "text-amber-900"
                  )}
                >
                  {alert.title}
                </span>
              </div>
              <p
                className={cn(
                  "text-xs mt-0.5 truncate",
                  isError
                    ? "text-red-700/80"
                    : "text-amber-700/80"
                )}
              >
                {alert.detail}
              </p>
            </div>
            {alert.link && (
              <Link
                href={alert.link}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1 text-xs font-medium hover:underline",
                  isError ? "text-red-600" : "text-amber-600"
                )}
              >
                View
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
