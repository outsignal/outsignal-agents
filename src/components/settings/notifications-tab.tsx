"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const NotificationHealthPage = dynamic(() => import("@/app/(admin)/notification-health/page"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

const NotificationsPage = dynamic(() => import("@/app/(admin)/notifications/page"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default function NotificationsTab() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-medium">Notification Health</h3>
        </div>
        <NotificationHealthPage />
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-medium">Notifications</h3>
        </div>
        <NotificationsPage />
      </div>
    </div>
  );
}
