/**
 * Signal campaign pipeline processor.
 *
 * processSignalCampaigns() is the core automated pipeline that connects
 * signal events to lead discovery, ICP scoring, and auto-deployment.
 *
 * Flow per active signal campaign:
 *   1. Check daily lead cap — stop if already hit
 *   2. Find recent SignalEvents matching campaign's workspace + signal types
 *   3. Skip company domains already processed for this campaign
 *   4. Discover people at signaled companies via Apollo adapter
 *   5. Stage discovered people (DiscoveredPerson table)
 *   6. Dedup + promote to Person table (enqueues enrichment)
 *   7. ICP score promoted leads against campaign threshold
 *   8. Record all evaluated leads in SignalCampaignLead junction
 *   9. Add passing leads to campaign's target list
 *  10. Auto-deploy to EmailBison (email channel) and/or LinkedIn (action queue)
 *  11. Send batch Slack notification listing added leads
 *  12. Update lastSignalProcessedAt timestamp
 */

import { isCreditExhaustion } from "@/lib/enrichment/credit-exhaustion";
import { prisma } from "@/lib/db";
import { apolloAdapter } from "@/lib/discovery/adapters/apollo";
import { stageDiscoveredPeople } from "@/lib/discovery/staging";
import { deduplicateAndPromote } from "@/lib/discovery/promotion";
import { scorePersonIcp } from "@/lib/icp/scorer";
import { resolveIcpContextForWorkspaceSlug } from "@/lib/icp/resolver";
import { addPeopleToList } from "@/lib/leads/operations";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { EMAILBISON_STANDARD_SEQUENCE_CUSTOM_VARIABLES } from "@/lib/emailbison/custom-variable-names";
import { buildEmailLeadPayload } from "@/lib/emailbison/lead-payload";
import { chainActions } from "@/lib/linkedin/chain";
import { applyTimingJitter } from "@/lib/linkedin/jitter";
import { createSequenceRulesForCampaign } from "@/lib/linkedin/sequencing";
import { assignSenderForPerson } from "@/lib/linkedin/sender";
import { notify } from "@/lib/notify";
import { postMessage } from "@/lib/slack";
import type { DiscoveryFilter } from "@/lib/discovery/types";

import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CampaignWithWorkspace = Prisma.CampaignGetPayload<{
  include: { workspace: true };
}>;

export interface PipelineResult {
  campaignsProcessed: number;
  totalLeadsAdded: number;
  totalSignalsMatched: number;
  errors: string[];
}

interface CampaignProcessResult {
  signalsMatched: number;
  leadsAdded: number;
  leadsDeployed: number;
}

const VENDOR_UNAVAILABLE_STATUS_CODES = new Set([
  403, 404, 408, 409, 422, 429, 500, 502, 503, 504,
]);

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function extractNumericStatus(error: unknown): number | null {
  const record = asRecord(error);
  if (!record) return null;

  const direct = record.status ?? record.statusCode;
  const directNumber =
    typeof direct === "number"
      ? direct
      : typeof direct === "string" && direct.trim().length > 0
        ? Number(direct)
        : NaN;
  if (!Number.isNaN(directNumber)) return directNumber;

  const response = asRecord(record.response);
  if (!response) return null;
  const responseStatus = response.status ?? response.statusCode;
  const responseNumber =
    typeof responseStatus === "number"
      ? responseStatus
      : typeof responseStatus === "string" && responseStatus.trim().length > 0
        ? Number(responseStatus)
        : NaN;
  return Number.isNaN(responseNumber) ? null : responseNumber;
}

function extractErrorCode(error: unknown): string {
  const record = asRecord(error);
  if (!record) return "";

  const direct = record.code;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim().toUpperCase();
  }

  const cause = asRecord(record.cause);
  const nested = cause?.code;
  if (typeof nested === "string" && nested.trim().length > 0) {
    return nested.trim().toUpperCase();
  }

  return "";
}

export function isVendorUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = extractNumericStatus(error);
  const code = extractErrorCode(error);

  return (
    /apollo disabled/i.test(message) ||
    (statusCode !== null &&
      VENDOR_UNAVAILABLE_STATUS_CODES.has(statusCode)) ||
    NETWORK_ERROR_CODES.has(code) ||
    /\bstatus code (403|404|408|409|422|429|500|502|503|504)\b/i.test(
      message,
    ) ||
    /\b(timed? out|timeout|connection refused|network error|ssl|certificate verify failed)\b/i.test(
      message,
    )
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Process all active signal campaigns.
 *
 * Iterates over active signal campaigns, discovering and deploying leads
 * at companies that have emitted matching signals since the last run.
 *
 * Called by the Railway signal worker after each signal polling cycle
 * via POST /api/pipeline/signal-campaigns/process.
 */
export async function processSignalCampaigns(): Promise<PipelineResult> {
  const result: PipelineResult = {
    campaignsProcessed: 0,
    totalLeadsAdded: 0,
    totalSignalsMatched: 0,
    errors: [],
  };

  // Find all active signal campaigns with workspace info
  const campaigns = await prisma.campaign.findMany({
    where: { type: "signal", status: "active" },
    include: { workspace: true },
  });

  if (campaigns.length === 0) {
    console.log("[Pipeline] No active signal campaigns");
    return result;
  }

  console.log(`[Pipeline] Processing ${campaigns.length} active signal campaign(s)`);

  for (const campaign of campaigns) {
    try {
      const campaignResult = await processSingleCampaign(campaign);
      result.campaignsProcessed++;
      result.totalLeadsAdded += campaignResult.leadsAdded;
      result.totalSignalsMatched += campaignResult.signalsMatched;
    } catch (error) {
      if (isCreditExhaustion(error)) {
        result.errors.push(`${campaign.name}: Credit exhaustion — pipeline paused`);
        break; // stop processing remaining campaigns
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] Error processing campaign "${campaign.name}":`, error);
      result.errors.push(`${campaign.name}: ${msg}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-campaign processing
// ---------------------------------------------------------------------------

async function processSingleCampaign(
  campaign: CampaignWithWorkspace,
): Promise<CampaignProcessResult> {
  const workspaceSlug = campaign.workspaceSlug;

  // 1. Check daily lead cap
  const todayStr = new Date().toISOString().slice(0, 10);
  const leadsAddedToday = await prisma.signalCampaignLead.count({
    where: {
      campaignId: campaign.id,
      addedAt: { gte: new Date(todayStr) },
      outcome: "added",
    },
  });

  if (leadsAddedToday >= campaign.dailyLeadCap) {
    console.log(
      `[Pipeline] Daily cap hit for "${campaign.name}" (${leadsAddedToday}/${campaign.dailyLeadCap})`,
    );
    return { signalsMatched: 0, leadsAdded: 0, leadsDeployed: 0 };
  }

  const remainingCapacity = campaign.dailyLeadCap - leadsAddedToday;

  // 2. Find recent signals matching this campaign
  const signalTypes: string[] = JSON.parse(campaign.signalTypes ?? "[]");
  // Default: 7 hours back (gives a buffer for the Railway cron that runs every few hours)
  const sinceDate =
    campaign.lastSignalProcessedAt ?? new Date(Date.now() - 7 * 60 * 60 * 1000);

  const signals = await prisma.signalEvent.findMany({
    where: {
      workspaceSlug,
      signalType: { in: signalTypes },
      status: "active",
      detectedAt: { gt: sinceDate },
    },
    distinct: ["companyDomain"], // One entry per company (dedup across signal types)
    orderBy: { detectedAt: "desc" },
  });

  if (signals.length === 0) {
    // Update lastSignalProcessedAt even with no signals to avoid reprocessing
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { lastSignalProcessedAt: new Date() },
    });
    return { signalsMatched: 0, leadsAdded: 0, leadsDeployed: 0 };
  }

  console.log(
    `[Pipeline] Campaign "${campaign.name}": ${signals.length} new signal(s) from ${signals.length} company domain(s)`,
  );

  // 3. Parse ICP criteria for discovery filter
  const icpCriteria = JSON.parse(campaign.icpCriteria ?? "{}") as {
    industries?: string[];
    titles?: string[];
    companySizes?: string[];
    locations?: string[];
    keywords?: string[];
  };

  // 4. Discover people at signaled companies — skip domains already processed
  const companyDomains = signals.map(s => s.companyDomain).filter(Boolean) as string[];

  const existingDomains = await prisma.signalCampaignLead.findMany({
    where: {
      campaignId: campaign.id,
      companyDomain: { in: companyDomains },
    },
    select: { companyDomain: true },
    distinct: ["companyDomain"],
  });
  const processedDomainSet = new Set(
    existingDomains.map(e => e.companyDomain).filter(Boolean) as string[],
  );
  const newDomains = companyDomains.filter(d => !processedDomainSet.has(d));

  if (newDomains.length === 0) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { lastSignalProcessedAt: new Date() },
    });
    return { signalsMatched: signals.length, leadsAdded: 0, leadsDeployed: 0 };
  }

  // Use Apollo as primary discovery source with ICP filters + company domain filter
  const filter: DiscoveryFilter = {
    jobTitles: icpCriteria.titles,
    industries: icpCriteria.industries,
    companySizes: icpCriteria.companySizes,
    locations: icpCriteria.locations,
    keywords: icpCriteria.keywords,
    companyDomains: newDomains,
  };

  let discoveryResult;
  try {
    // Fetch 2× cap to provide a scoring buffer — Apollo is free
    discoveryResult = await apolloAdapter.search(
      filter,
      Math.min(remainingCapacity * 2, 50),
    );
  } catch (error) {
    if (isCreditExhaustion(error)) {
      // Re-throw to halt the campaign loop — don't update lastSignalProcessedAt
      // so these signals get retried after credits are topped up
      throw error;
    }
    if (isVendorUnavailableError(error)) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn(
        `[Pipeline] Discovery skipped for campaign "${campaign.name}" — vendor unavailable: ${errorMessage}`,
      );
      await notify({
        type: "system",
        severity: "warning",
        title: "Signal campaign discovery skipped",
        workspaceSlug,
        message:
          `Signal campaign "${campaign.name}" could not run discovery because the vendor was unavailable: ${errorMessage}`,
        metadata: {
          campaignId: campaign.id,
          campaignName: campaign.name,
          adapter: "apollo",
          source: "signal_campaigns",
        },
      });
      return { signalsMatched: signals.length, leadsAdded: 0, leadsDeployed: 0 };
    }
    console.error(`[Pipeline] Discovery failed for campaign "${campaign.name}":`, error);
    throw error;
  }

  if (discoveryResult.people.length === 0) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { lastSignalProcessedAt: new Date() },
    });
    return { signalsMatched: signals.length, leadsAdded: 0, leadsDeployed: 0 };
  }

  // 5. Stage discovered people
  const icpContext = await resolveIcpContextForWorkspaceSlug({
    workspaceSlug,
    campaignId: campaign.id,
  });
  const stagingResult = await stageDiscoveredPeople({
    people: discoveryResult.people,
    discoverySource: "apollo",
    workspaceSlug,
    searchQuery: JSON.stringify({
      filter,
      campaign: campaign.name,
      signalDomains: newDomains,
    }),
    // rawResponses: parallel array of the same raw response object
    rawResponses: discoveryResult.people.map(() => discoveryResult.rawResponse),
    discoveryRunContext: {
      workspaceId: icpContext.workspaceId,
      icpProfileId: icpContext.profileId,
      icpProfileVersionId: icpContext.versionId,
      icpProfileSnapshot: icpContext.snapshot,
      triggeredBy: "signal-campaign",
      triggeredVia: "signal-campaign",
    },
    icpProfileVersionId: icpContext.versionId,
  });

  // 6. Dedup and promote to Person table (also enqueues enrichment)
  const promotionResult = await deduplicateAndPromote(workspaceSlug, [stagingResult.runId], {
    campaignId: campaign.id,
  });

  if (promotionResult.promotedIds.length === 0) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { lastSignalProcessedAt: new Date() },
    });
    return { signalsMatched: signals.length, leadsAdded: 0, leadsDeployed: 0 };
  }

  // 7. ICP score promoted leads
  // scorePersonIcp throws if workspace has no icpCriteriaPrompt — catch per-person.
  const passingLeads: Array<{ personId: string; icpScore: number }> = [];
  const belowThresholdLeads: Array<{ personId: string; icpScore: number }> = [];

  for (const personId of promotionResult.promotedIds) {
    if (passingLeads.length >= remainingCapacity) break; // Respect daily cap

    try {
      const scoreResult = await scorePersonIcp(personId, workspaceSlug, false, {
        campaignId: campaign.id,
        icpContext,
      });
      if (scoreResult.score >= campaign.icpScoreThreshold) {
        passingLeads.push({ personId, icpScore: scoreResult.score });
      } else {
        belowThresholdLeads.push({ personId, icpScore: scoreResult.score });
      }
    } catch (error) {
      console.warn(`[Pipeline] ICP scoring failed for person ${personId}:`, error);
      // Score failure = skip this person; don't add without scoring
    }
  }

  // 8. Record all evaluated leads in SignalCampaignLead (dedup junction)
  const signalLookup = new Map(signals.map(s => [s.companyDomain, s.id]));

  for (const lead of passingLeads) {
    const person = await prisma.person.findUnique({
      where: { id: lead.personId },
      select: { companyDomain: true },
    });
    await prisma.signalCampaignLead.upsert({
      where: { campaignId_personId: { campaignId: campaign.id, personId: lead.personId } },
      create: {
        campaignId: campaign.id,
        personId: lead.personId,
        outcome: "added",
        icpScore: lead.icpScore,
        signalEventId: person?.companyDomain
          ? (signalLookup.get(person.companyDomain) ?? null)
          : null,
        companyDomain: person?.companyDomain ?? null,
      },
      update: {}, // No-op on conflict — already recorded
    });
  }

  for (const lead of belowThresholdLeads) {
    const person = await prisma.person.findUnique({
      where: { id: lead.personId },
      select: { companyDomain: true },
    });
    await prisma.signalCampaignLead.upsert({
      where: { campaignId_personId: { campaignId: campaign.id, personId: lead.personId } },
      create: {
        campaignId: campaign.id,
        personId: lead.personId,
        outcome: "below_threshold",
        icpScore: lead.icpScore,
        signalEventId: person?.companyDomain
          ? (signalLookup.get(person.companyDomain) ?? null)
          : null,
        companyDomain: person?.companyDomain ?? null,
      },
      update: {},
    });
  }

  // 9. Add passing leads to campaign's target list
  if (passingLeads.length > 0 && campaign.targetListId) {
    await addPeopleToList(
      campaign.targetListId,
      passingLeads.map(l => l.personId),
    );
  }

  // 10. Auto-deploy passing leads
  const channels: string[] = JSON.parse(campaign.channels ?? '["email"]');
  let leadsDeployed = 0;

  if (
    channels.includes("email") &&
    campaign.signalEmailBisonCampaignId &&
    campaign.workspace.apiToken
  ) {
    const ebClient = new EmailBisonClient(campaign.workspace.apiToken);
    await ebClient.ensureCustomVariables([
      ...EMAILBISON_STANDARD_SEQUENCE_CUSTOM_VARIABLES,
    ]);

    for (const lead of passingLeads) {
      const person = await prisma.person.findUnique({
        where: { id: lead.personId },
        select: {
          email: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          company: true,
          companyDomain: true,
          location: true,
        },
      });
      // Skip leads without a real email
      if (!person || !person.email) continue;

      try {
        await ebClient.createLead(
          buildEmailLeadPayload(
            {
              email: person.email,
              firstName: person.firstName,
              lastName: person.lastName,
              jobTitle: person.jobTitle,
              company: person.company,
              companyDomain: person.companyDomain,
              location: person.location,
            },
            campaign.description,
          ),
        );
        leadsDeployed++;
        // Throttle — 100ms between leads to avoid EmailBison rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(
          `[Pipeline] Failed to deploy lead ${person.email} to EmailBison:`,
          error,
        );
      }
    }
  }

  if (channels.includes("linkedin")) {
    const linkedinSeq = JSON.parse(campaign.linkedinSequence ?? "[]") as Array<{
      position: number;
      type: string;
      body?: string;
      delayDays?: number;
    }>;

    if (linkedinSeq.length > 0) {
      // ── Connection gate split ────────────────────────────────────────
      // Split the sequence at the connect step. Pre-connect steps (profile_view,
      // connect) are scheduled immediately via chainActions. Post-connect steps
      // (follow-up messages) become CampaignSequenceRules triggered by
      // connection_accepted — they are NOT pre-scheduled.
      const sorted = [...linkedinSeq].sort((a, b) => a.position - b.position);

      // Ensure profile_view is the first step (industry standard warm-up)
      if (sorted.length > 0 && sorted[0].type !== "profile_view") {
        sorted.unshift({ position: 0, type: "profile_view", delayDays: 0 });
      }

      const connectIndex = sorted.findLastIndex((step) => step.type === "connect" || step.type === "connection_request");

      const preConnectSteps = connectIndex >= 0
        ? sorted.slice(0, connectIndex + 1)
        : sorted; // No connect step — all steps are pre-connect
      const postConnectSteps = connectIndex >= 0
        ? sorted.slice(connectIndex + 1)
        : []; // No connect step — no post-connect steps

      for (const lead of passingLeads) {
        const person = await prisma.person.findUnique({
          where: { id: lead.personId },
          select: { id: true, linkedinUrl: true, email: true },
        });
        if (!person?.linkedinUrl) continue;

        const mode = channels.includes("email") ? "email_linkedin" : "linkedin_only";
        const sender = await assignSenderForPerson(workspaceSlug, { mode });
        if (!sender) continue;

        try {
          // Stagger by ~15 minutes per lead (jittered 12-18 min) to avoid LinkedIn rate limits
          const connectScheduledFor = new Date(Date.now() + leadsDeployed * applyTimingJitter(15 * 60 * 1000));

          // Schedule ONLY pre-connect steps (profile_view + connect) via chainActions
          const actionIds = await chainActions({
            senderId: sender.id,
            personId: person.id,
            workspaceSlug,
            sequence: preConnectSteps.map(step => ({
              position: step.position,
              type: step.type,
              body: step.body,
              delayDays: step.delayDays,
            })),
            baseScheduledFor: connectScheduledFor,
            priority: 3, // Higher priority — signal-triggered is time-sensitive
            campaignName: campaign.name,
          });

          console.log(
            `[Pipeline] Split sequence: ${preConnectSteps.length} pre-connect, ${postConnectSteps.length} post-connect rules for person ${person.id}`,
          );
        } catch (error) {
          console.error(
            `[Pipeline] Failed to enqueue LinkedIn action for person ${person.id}:`,
            error,
          );
        }
      }

      // Create CampaignSequenceRules for post-connect follow-up messages.
      // These fire when connection_accepted is detected by the connection-poller.
      // Always called (even if postConnectSteps is empty) to clean up stale rules
      // from a previous run (idempotent support).
      const postConnectRules = postConnectSteps.map((step, idx) => ({
        position: step.position,
        type: step.type,
        body: step.body,
        delayHours: (step.delayDays ?? (idx === 0 ? 1 : 2)) * 24,
        triggerEvent: "connection_accepted" as const,
      }));

      await createSequenceRulesForCampaign({
        workspaceSlug,
        campaignName: campaign.name,
        linkedinSequence: postConnectRules,
      });
    }
  }

  // 11. Send batch Slack notification
  if (passingLeads.length > 0 && campaign.workspace.slackChannelId) {
    await sendPipelineNotification(
      campaign.workspace.slackChannelId,
      campaign.workspace.name,
      campaign.name,
      passingLeads.length,
      leadsDeployed,
      signals.map(s => s.signalType),
      passingLeads,
    );
  }

  // 12. Update lastSignalProcessedAt
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { lastSignalProcessedAt: new Date() },
  });

  return {
    signalsMatched: signals.length,
    leadsAdded: passingLeads.length,
    leadsDeployed,
  };
}

// ---------------------------------------------------------------------------
// Slack notification
// ---------------------------------------------------------------------------

async function sendPipelineNotification(
  channelId: string,
  workspaceName: string,
  campaignName: string,
  leadsAdded: number,
  leadsDeployed: number,
  signalTypes: string[],
  leads: Array<{ personId: string; icpScore: number }>,
): Promise<void> {
  // Fetch first 5 lead names for display
  const personIds = leads.slice(0, 5).map(l => l.personId);
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { firstName: true, lastName: true, company: true, jobTitle: true },
  });

  const leadList = people
    .map(
      p =>
        `• ${[p.firstName, p.lastName].filter(Boolean).join(" ")} — ${p.jobTitle ?? "N/A"} at ${p.company ?? "N/A"}`,
    )
    .join("\n");

  const uniqueTypes = [...new Set(signalTypes)].join(", ");
  const headerText = `[${workspaceName}] ${leadsAdded} new lead${leadsAdded === 1 ? "" : "s"} added to signal campaign "${campaignName}"`;

  try {
    await postMessage(channelId, headerText, [
      {
        type: "header",
        text: { type: "plain_text", text: headerText },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Signal types:* ${uniqueTypes}\n*Leads added:* ${leadsAdded}\n*Leads deployed:* ${leadsDeployed}`,
        },
      },
      ...(leadList
        ? [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: `*New leads:*\n${leadList}${leadsAdded > 5 ? `\n_...and ${leadsAdded - 5} more_` : ""}`,
              },
            },
          ]
        : []),
    ]);
  } catch (error) {
    console.error("[Pipeline] Failed to send Slack notification:", error);
  }
}
