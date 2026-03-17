import { PageShell } from "@/components/layout/page-shell";
import { SendersOverview } from "@/components/admin/senders-overview";

export default function SendersPage() {
  return (
    <PageShell
      title="Senders"
      description="Manage email and LinkedIn senders across all workspaces"
    >
      <SendersOverview />
    </PageShell>
  );
}
