import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface WorkspaceSummary {
  slug: string;
  name: string;
  vertical?: string;
  activeCampaigns: number;
  totalLeads: number;
  replyRate: number;
  bounceRate: number;
  flaggedSenders: number;
  error?: string;
}

interface OverviewTableProps {
  summaries: WorkspaceSummary[];
}

export function OverviewTable({ summaries }: OverviewTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Workspace</TableHead>
          <TableHead>Vertical</TableHead>
          <TableHead className="text-right">Active Campaigns</TableHead>
          <TableHead className="text-right">Total Leads</TableHead>
          <TableHead className="text-right">Reply Rate</TableHead>
          <TableHead className="text-right">Bounce Rate</TableHead>
          <TableHead className="text-right">Flagged</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summaries.map((ws) => (
          <TableRow key={ws.slug}>
            <TableCell>
              <Link
                href={`/workspace/${ws.slug}`}
                className="font-medium hover:underline"
              >
                {ws.name}
              </Link>
            </TableCell>
            <TableCell>
              {ws.vertical && (
                <Badge variant="secondary" className="text-xs">
                  {ws.vertical}
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right">{ws.activeCampaigns}</TableCell>
            <TableCell className="text-right">
              {ws.totalLeads.toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              {ws.replyRate.toFixed(1)}%
            </TableCell>
            <TableCell className="text-right">
              <span
                className={
                  ws.bounceRate > 5
                    ? "text-red-600 font-medium"
                    : ws.bounceRate > 2
                      ? "text-amber-600"
                      : ""
                }
              >
                {ws.bounceRate.toFixed(1)}%
              </span>
            </TableCell>
            <TableCell className="text-right">
              {ws.flaggedSenders > 0 ? (
                <Badge variant="destructive" className="text-xs">
                  {ws.flaggedSenders}
                </Badge>
              ) : (
                <span className="text-muted-foreground">0</span>
              )}
            </TableCell>
            <TableCell>
              {ws.error ? (
                <Badge variant="destructive" className="text-xs">
                  Error
                </Badge>
              ) : (
                <Badge
                  className="text-xs bg-brand text-brand-foreground hover:bg-brand/90"
                >
                  Connected
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
        {summaries.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
              No workspaces configured. Add workspace tokens in Settings.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
