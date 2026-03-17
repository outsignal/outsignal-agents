import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/page-shell";
import { getWorkspaceBySlug, getWorkspaceDetails } from "@/lib/workspaces";
import { WorkspaceSettingsForm } from "@/components/workspace/workspace-settings-form";
import { PackageQuotasForm } from "@/components/workspace/package-quotas-form";
import { prisma } from "@/lib/db";
import { parseModules, getWorkspaceQuotaUsage } from "@/lib/workspaces/quota";

interface SettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceSettingsPage({
  params,
}: SettingsPageProps) {
  const { slug } = await params;

  const config = await getWorkspaceBySlug(slug);
  if (!config) notFound();

  // Fetch workspace details and package data in parallel
  const [details, dbWorkspace, usage] = await Promise.all([
    getWorkspaceDetails(slug),
    prisma.workspace.findUnique({ where: { slug } }),
    getWorkspaceQuotaUsage(slug).catch(() => null),
  ]);

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

  // Build package data for the PackageQuotasForm (only if DB record exists)
  const packageData = dbWorkspace && usage
    ? {
        slug,
        enabledModules: parseModules(dbWorkspace.enabledModules ?? '["email"]'),
        monthlyLeadQuota: dbWorkspace.monthlyLeadQuota ?? 2000,
        monthlyLeadQuotaStatic: dbWorkspace.monthlyLeadQuotaStatic ?? 2000,
        monthlyLeadQuotaSignal: dbWorkspace.monthlyLeadQuotaSignal ?? 0,
        monthlyCampaignAllowance: dbWorkspace.monthlyCampaignAllowance ?? 2,
        usage,
      }
    : null;

  return (
    <PageShell
      title={`${workspace.name} — Settings`}
      description="Manage workspace configuration, ICP, and campaign brief"
      breadcrumbs={[
        { label: "Workspaces", href: "/" },
        { label: workspace.name, href: `/workspace/${slug}` },
        { label: "Settings" },
      ]}
      noPadding
    >
      <div className="p-6 max-w-4xl space-y-6">
        <WorkspaceSettingsForm workspace={workspace} />
        {packageData && <PackageQuotasForm data={packageData} />}
      </div>
    </PageShell>
  );
}
