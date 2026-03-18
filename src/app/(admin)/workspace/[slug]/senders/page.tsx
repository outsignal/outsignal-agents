import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { WorkspaceSendersContent } from "@/components/workspace/workspace-senders-content";

interface WorkspaceSendersPageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceSendersPage({
  params,
}: WorkspaceSendersPageProps) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { slug: true, name: true },
  });

  if (!workspace) notFound();

  const senders = await prisma.sender.findMany({
    where: { workspaceSlug: slug },
    select: {
      id: true,
      name: true,
      emailAddress: true,
      emailSenderName: true,
      linkedinProfileUrl: true,
      loginMethod: true,
      sessionStatus: true,
      linkedinTier: true,
      healthStatus: true,
      emailBounceStatus: true,
      warmupDay: true,
      status: true,
      lastPolledAt: true,
      lastKeepaliveAt: true,
      updatedAt: true,
    },
    orderBy: { name: "asc" },
  });

  // Serialize dates for client component
  const serialized = senders.map((s) => ({
    ...s,
    lastPolledAt: s.lastPolledAt?.toISOString() ?? null,
    lastKeepaliveAt: s.lastKeepaliveAt?.toISOString() ?? null,
    updatedAt: s.updatedAt.toISOString(),
  }));

  // Split: email senders have no LinkedIn profile and loginMethod "none"
  const emailSenders = serialized.filter(
    (s) => s.loginMethod === "none" && !s.linkedinProfileUrl,
  );
  const linkedinSenders = serialized.filter(
    (s) => s.loginMethod !== "none" || !!s.linkedinProfileUrl,
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Senders</h2>
        <p className="text-sm text-muted-foreground">
          Email and LinkedIn senders for {workspace.name}
        </p>
      </div>

      <WorkspaceSendersContent
        emailSenders={emailSenders}
        linkedinSenders={linkedinSenders}
      />
    </div>
  );
}
