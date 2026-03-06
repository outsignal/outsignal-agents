import { z } from "zod";

// PATCH /api/workspace/[slug]/configure
export const configureWorkspaceSchema = z.object({
  name: z.string().optional(),
  vertical: z.string().nullable().optional(),
  apiToken: z.string().optional(),
  status: z.string().optional(),
  slackChannelId: z.string().nullable().optional(),
  notificationEmails: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  linkedinUsername: z.string().nullable().optional(),
  linkedinPasswordNote: z.string().nullable().optional(),
  senderFullName: z.string().nullable().optional(),
  senderJobTitle: z.string().nullable().optional(),
  senderPhone: z.string().nullable().optional(),
  senderAddress: z.string().nullable().optional(),
  icpCountries: z.string().nullable().optional(),
  icpIndustries: z.string().nullable().optional(),
  icpCompanySize: z.string().nullable().optional(),
  icpDecisionMakerTitles: z.string().nullable().optional(),
  icpKeywords: z.string().nullable().optional(),
  icpExclusionCriteria: z.string().nullable().optional(),
  coreOffers: z.string().nullable().optional(),
  pricingSalesCycle: z.string().nullable().optional(),
  differentiators: z.string().nullable().optional(),
  painPoints: z.string().nullable().optional(),
  caseStudies: z.string().nullable().optional(),
  leadMagnets: z.string().nullable().optional(),
  existingMessaging: z.string().nullable().optional(),
  supportingMaterials: z.string().nullable().optional(),
  exclusionList: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  senderEmailDomains: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  targetVolume: z.string().nullable().optional(),
  onboardingNotes: z.string().nullable().optional(),
  clientEmails: z.union([z.string(), z.array(z.string())]).nullable().optional(),
});

// PATCH /api/workspaces/[slug]/package
export const updatePackageSchema = z.object({
  enabledModules: z.array(z.enum(["email", "email-signals", "linkedin", "linkedin-signals"])).min(1).optional(),
  monthlyLeadQuota: z.number().min(0).optional(),
  monthlyLeadQuotaStatic: z.number().min(0).optional(),
  monthlyLeadQuotaSignal: z.number().min(0).optional(),
  monthlyCampaignAllowance: z.number().min(0).optional(),
});

// PATCH /api/workspaces/[slug]/signals
export const updateSignalsSchema = z.object({
  signalDailyCapUsd: z.number().min(0).optional(),
  signalEnabledTypes: z.array(
    z.enum(["job_change", "funding", "hiring_spike", "tech_adoption", "news", "social_mention"])
  ).optional(),
  signalCompetitors: z.array(z.string()).optional(),
  signalWatchlistDomains: z.array(z.string()).optional(),
});
