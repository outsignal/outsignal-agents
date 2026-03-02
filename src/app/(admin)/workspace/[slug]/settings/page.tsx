import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { getWorkspaceBySlug, getWorkspaceDetails } from "@/lib/workspaces";
import { WorkspaceSettingsForm } from "@/components/workspace/workspace-settings-form";

interface SettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceSettingsPage({
  params,
}: SettingsPageProps) {
  const { slug } = await params;

  const config = await getWorkspaceBySlug(slug);
  if (!config) notFound();

  const details = await getWorkspaceDetails(slug);

  // Merge: DB fields take priority, fall back to env config
  const workspace = {
    slug,
    name: details?.name ?? config.name,
    vertical: details?.vertical ?? config.vertical ?? null,
    apiToken: details?.apiToken ?? config.apiToken,
    status: details?.status ?? config.status,
    slackChannelId: details?.slackChannelId ?? null,
    notificationEmails: details?.notificationEmails ?? null,
    linkedinUsername: details?.linkedinUsername ?? null,
    linkedinPasswordNote: details?.linkedinPasswordNote ?? null,
    senderFullName: details?.senderFullName ?? null,
    senderJobTitle: details?.senderJobTitle ?? null,
    senderPhone: details?.senderPhone ?? null,
    senderAddress: details?.senderAddress ?? null,
    icpCountries: details?.icpCountries ?? null,
    icpIndustries: details?.icpIndustries ?? null,
    icpCompanySize: details?.icpCompanySize ?? null,
    icpDecisionMakerTitles: details?.icpDecisionMakerTitles ?? null,
    icpKeywords: details?.icpKeywords ?? null,
    icpExclusionCriteria: details?.icpExclusionCriteria ?? null,
    coreOffers: details?.coreOffers ?? null,
    pricingSalesCycle: details?.pricingSalesCycle ?? null,
    differentiators: details?.differentiators ?? null,
    painPoints: details?.painPoints ?? null,
    caseStudies: details?.caseStudies ?? null,
    leadMagnets: details?.leadMagnets ?? null,
    existingMessaging: details?.existingMessaging ?? null,
    supportingMaterials: details?.supportingMaterials ?? null,
    exclusionList: details?.exclusionList ?? null,
    website: details?.website ?? null,
    senderEmailDomains: details?.senderEmailDomains ?? null,
    targetVolume: details?.targetVolume ?? null,
    onboardingNotes: details?.onboardingNotes ?? null,
    clientEmails: details?.clientEmails ?? null,
  };

  return (
    <div>
      <Header
        title={`${workspace.name} — Settings`}
        description="Manage workspace configuration, ICP, and campaign brief"
      />
      <div className="p-8 max-w-4xl">
        <WorkspaceSettingsForm workspace={workspace} />
      </div>
    </div>
  );
}
