"use client";

import { useQueryState } from "nuqs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface WorkspaceOption {
  slug: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "draft", label: "Draft" },
  { value: "deployed", label: "Deployed" },
  { value: "approved", label: "Approved" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "internal_review", label: "Internal Review" },
] as const;

interface CampaignFiltersProps {
  workspaces: WorkspaceOption[];
}

export function CampaignFilters({ workspaces }: CampaignFiltersProps) {
  const [workspace, setWorkspace] = useQueryState("workspace", {
    defaultValue: "all",
    shallow: false,
  });
  const [status, setStatus] = useQueryState("status", {
    defaultValue: "all",
    shallow: false,
  });

  return (
    <div className="flex items-center gap-2">
      <Select value={workspace} onValueChange={setWorkspace}>
        <SelectTrigger size="sm" className="w-[180px]">
          <SelectValue placeholder="All Workspaces" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Workspaces</SelectItem>
          {workspaces.map((ws) => (
            <SelectItem key={ws.slug} value={ws.slug}>
              {ws.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger size="sm" className="w-[170px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
