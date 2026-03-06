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

interface ClientFilterProps {
  workspaces: WorkspaceOption[];
}

const TIME_RANGE_OPTIONS = [
  { value: "1", label: "Today" },
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
] as const;

export function ClientFilter({ workspaces }: ClientFilterProps) {
  const [workspace, setWorkspace] = useQueryState("workspace", {
    defaultValue: "all",
    shallow: false,
  });
  const [days, setDays] = useQueryState("days", {
    defaultValue: "7",
    shallow: false,
  });

  return (
    <div className="flex items-center gap-2">
      <Select value={workspace} onValueChange={setWorkspace}>
        <SelectTrigger size="sm" className="w-[180px]">
          <SelectValue placeholder="All Campaigns" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Campaigns</SelectItem>
          {workspaces.map((ws) => (
            <SelectItem key={ws.slug} value={ws.slug}>
              {ws.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={days} onValueChange={setDays}>
        <SelectTrigger size="sm" className="w-[140px]">
          <SelectValue placeholder="Last 7 days" />
        </SelectTrigger>
        <SelectContent>
          {TIME_RANGE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
