"use client";

import {
  EmailActivityChart,
  EmailActivityChartLegend,
  type EmailActivityPoint,
} from "@/components/charts/email-activity-chart";

/** Daily aggregated data point for the portal chart */
export interface PerformanceDayPoint {
  date: string;
  sent: number;
  replied: number;
  bounced: number;
  interested: number;
  unsubscribed: number;
}

interface Props {
  data: PerformanceDayPoint[];
}

/** Map portal PerformanceDayPoint → standardized EmailActivityPoint */
function mapToEmailActivity(data: PerformanceDayPoint[]): EmailActivityPoint[] {
  return data.map((d) => ({
    date: d.date,
    sent: d.sent,
    replied: d.replied,
    bounced: d.bounced,
    interested: d.interested,
    unsubscribed: d.unsubscribed,
  }));
}

export function PortalPerformanceChart({ data }: Props) {
  return <EmailActivityChart data={mapToEmailActivity(data)} />;
}

export function PerformanceChartLegend() {
  return (
    <EmailActivityChartLegend
      keys={["sent", "replied"]}
    />
  );
}
