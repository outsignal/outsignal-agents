"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Mail,
  Send,
  Users,
  ShieldCheck,
  Building2,
  Settings,
  Linkedin,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkspaceNavProps {
  slug: string;
  workspaceName: string;
}

interface TabItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

export function WorkspaceNav({ slug }: WorkspaceNavProps) {
  const pathname = usePathname();

  const tabs: TabItem[] = [
    { label: "Overview", href: `/workspace/${slug}`, icon: LayoutDashboard, exact: true },
    { label: "Inbox", href: `/workspace/${slug}/inbox`, icon: Mail },
    { label: "Senders", href: `/workspace/${slug}/senders`, icon: Send },
    { label: "LinkedIn", href: `/workspace/${slug}/linkedin`, icon: Linkedin },
    { label: "Deliverability", href: `/workspace/${slug}/deliverability`, icon: ShieldCheck },
    { label: "Members", href: `/workspace/${slug}/members`, icon: Users },
    { label: "Profile", href: `/workspace/${slug}/profile`, icon: Building2 },
    { label: "Settings", href: `/workspace/${slug}/settings`, icon: Settings },
  ];

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-border px-2">
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(tab.href + "/");

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-b-2 border-brand text-foreground"
                : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
