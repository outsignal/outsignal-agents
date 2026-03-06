import { z } from "zod";

// POST /api/onboarding-invites
export const createOnboardingInviteSchema = z.object({
  clientName: z.string().min(1, "clientName is required"),
  clientEmail: z.string().email().optional(),
  proposalId: z.string().optional(),
  createWorkspace: z.boolean().optional(),
});

// PATCH /api/onboarding-invites/[id]
export const updateOnboardingInviteSchema = z.object({
  clientName: z.string().min(1).optional(),
  clientEmail: z.string().email().nullable().optional(),
  status: z.string().optional(),
  createWorkspace: z.boolean().optional(),
  workspaceSlug: z.string().nullable().optional(),
  sendEmail: z.boolean().optional(),
});

// POST /api/onboard
export const onboardSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  senderFullName: z.string().min(1, "Sender name is required"),
  createWorkspace: z.boolean().optional(),
  vertical: z.string().optional(),
  notificationEmails: z.string().optional(),
  linkedinUsername: z.string().optional(),
  linkedinPasswordNote: z.string().optional(),
  senderJobTitle: z.string().optional(),
  senderPhone: z.string().optional(),
  senderAddress: z.string().optional(),
  icpCountries: z.string().optional(),
  icpIndustries: z.string().optional(),
  icpCompanySize: z.string().optional(),
  icpDecisionMakerTitles: z.string().optional(),
  icpKeywords: z.string().optional(),
  icpExclusionCriteria: z.string().optional(),
  coreOffers: z.string().optional(),
  pricingSalesCycle: z.string().optional(),
  differentiators: z.string().optional(),
  painPoints: z.string().optional(),
  caseStudies: z.string().optional(),
  leadMagnets: z.string().optional(),
  existingMessaging: z.string().optional(),
  supportingMaterials: z.string().optional(),
  exclusionList: z.string().optional(),
  website: z.string().optional(),
  senderEmailDomains: z.union([z.string(), z.array(z.string())]).optional(),
  targetVolume: z.string().optional(),
  onboardingNotes: z.string().optional(),
  proposalToken: z.string().optional(),
  onboardingInviteToken: z.string().optional(),
});
