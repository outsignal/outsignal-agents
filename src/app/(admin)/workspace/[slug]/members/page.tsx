import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { MembersTable } from "@/components/workspace/members-table";

interface MembersPageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceMembersPage({
  params,
}: MembersPageProps) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!workspace) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-heading font-semibold tracking-tight">
          Members
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage client access, portal permissions, and notification preferences.
        </p>
      </div>

      <MembersTable slug={slug} />
    </div>
  );
}
