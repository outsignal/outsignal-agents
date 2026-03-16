"use client";

import type { TimeSeriesPoint } from "@/app/api/dashboard/stats/route";
import {
  EmailActivityChart,
  EmailActivityChartLegend,
  type EmailActivityPoint,
} from "@/components/charts/email-activity-chart";

interface ActivityChartProps {
  data: TimeSeriesPoint[];
}

/** Map admin dashboard TimeSeriesPoint → standardized EmailActivityPoint */
function mapToEmailActivity(data: TimeSeriesPoint[]): EmailActivityPoint[] {
  return data.map((d) => ({
    date: d.date,
    sent: d.sent,
    opens: d.opens,
    replied: d.replies,
    bounced: d.bounces,
  }));
}

export function ActivityChart({ data }: ActivityChartProps) {
  return <EmailActivityChart data={mapToEmailActivity(data)} height={240} />;
}

export function ActivityChartLegend() {
  return <EmailActivityChartLegend keys={["sent", "replied"]} />;
}
