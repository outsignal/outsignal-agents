"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface WorkspaceFilterSelectProps {
  workspaces: Array<{ slug: string; name: string }>;
  currentWorkspace: string;
}

export function WorkspaceFilterSelect({
  workspaces,
  currentWorkspace,
}: WorkspaceFilterSelectProps) {
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(value: string) {
    const params = new URLSearchParams();
    if (value !== "all") {
      params.set("workspace", value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <Select value={currentWorkspace || "all"} onValueChange={handleChange}>
      <SelectTrigger className="w-48">
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
  );
}
