import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { WorkspaceProfileForm } from "@/components/workspace/workspace-profile-form";
import { ClientBriefSection } from "@/components/workspace/client-brief-section";
import { readFile } from "fs/promises";
import { join } from "path";

interface ProfilePageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceProfilePage({
  params,
}: ProfilePageProps) {
  const { slug } = await params;

  const [workspace, memberCount] = await Promise.all([
    prisma.workspace.findUnique({ where: { slug } }),
    prisma.member.count({ where: { workspaceSlug: slug, status: { not: "disabled" } } }),
  ]);

  if (!workspace) notFound();

  // Try to read the client brief markdown file
  let clientBriefContent: string | null = null;
  try {
    const briefPath = join(process.cwd(), "docs", "clients", `${slug}.md`);
    clientBriefContent = await readFile(briefPath, "utf-8");
  } catch {
    // No client brief file exists for this workspace
  }

  // Serialize workspace data for client component (strip sensitive fields)
  const profileData = {
    slug: workspace.slug,
    name: workspace.name,
    vertical: workspace.vertical,
    type: workspace.type,
    package: workspace.package,
    status: workspace.status,
    website: workspace.website,
    targetVolume: workspace.targetVolume,
    onboardingNotes: workspace.onboardingNotes,
    senderFullName: workspace.senderFullName,
    senderJobTitle: workspace.senderJobTitle,
    senderPhone: workspace.senderPhone,
    senderAddress: workspace.senderAddress,
    memberCount,
    slackChannelId: workspace.slackChannelId,
    billingCompanyName: workspace.billingCompanyName,
    billingRetainerPence: workspace.billingRetainerPence,
    billingPlatformFeePence: workspace.billingPlatformFeePence,
    billingRenewalDate: workspace.billingRenewalDate?.toISOString() ?? null,
    createdAt: workspace.createdAt.toISOString(),
  };

  return (
    <div className="max-w-4xl space-y-6">
      <WorkspaceProfileForm workspace={profileData} />
      {clientBriefContent && (
        <ClientBriefSection content={clientBriefContent} />
      )}
    </div>
  );
}
