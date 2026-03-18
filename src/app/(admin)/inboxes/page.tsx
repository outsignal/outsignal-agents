import { PageShell } from "@/components/layout/page-shell";
import { InboxesOverview } from "@/components/admin/inboxes-overview";

export default function InboxesPage() {
  return (
    <PageShell
      title="Inboxes"
      description="Email sending accounts across all workspaces"
    >
      <InboxesOverview />
    </PageShell>
  );
}
