"use client";

import { Header } from "@/components/layout/header";
import { SettingsHub } from "@/components/settings/settings-hub";

export default function SettingsPage() {
  return (
    <div>
      <Header
        title="Settings"
        description="Manage workspace connections, operations, and configuration"
      />
      <SettingsHub />
    </div>
  );
}
