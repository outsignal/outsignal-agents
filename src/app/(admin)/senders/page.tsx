import { PageShell } from "@/components/layout/page-shell";
import { SendersOverview } from "@/components/admin/senders-overview";

export default function SendersPage() {
  return (
    <PageShell
      title="LinkedIn Accounts"
      description="Manage LinkedIn accounts across all workspaces"
    >
      <SendersOverview />
    </PageShell>
  );
}
