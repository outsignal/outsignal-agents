/**
 * LinkedIn Sequencing Engine — template compilation and sequence rule evaluation.
 *
 * Handles:
 * - Handlebars template compilation for LinkedIn messages
 * - CampaignSequenceRule evaluation triggered by email events or connection accepts
 * - Campaign sequence rule creation at deploy time
 */
import Handlebars from "handlebars";
import { prisma } from "@/lib/db";

// ─── Template Engine ─────────────────────────────────────────────────────────

/**
 * Compile a Handlebars template string against a context object.
 * Uses `noEscape: true` — LinkedIn messages are plain text, not HTML.
 * Gracefully returns the raw template string on compilation error.
 */
export function compileTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  try {
    const compiled = Handlebars.compile(template, { noEscape: true });
    return compiled(context);
  } catch (err) {
    console.warn("[sequencing] Template compilation failed, returning raw template:", err);
    return template;
  }
}

/**
 * Build the Handlebars context object from person and optional email event data.
 * All nullable fields default to empty string for safe rendering.
 */
export function buildTemplateContext(
  person: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    jobTitle?: string | null;
    linkedinUrl?: string | null;
  },
  emailContext?: {
    stepRef?: string;
    subject?: string;
    opened?: boolean;
    clicked?: boolean;
  },
  outreachContext?: {
    lastEmailMonth?: string;
  },
): Record<string, unknown> {
  return {
    // Person fields
    firstName: person.firstName ?? "",
    lastName: person.lastName ?? "",
    companyName: person.company ?? "",
    jobTitle: person.jobTitle ?? "",
    linkedinUrl: person.linkedinUrl ?? "",

    // Email context fields
    emailStepRef: emailContext?.stepRef ?? "",
    emailSubject: emailContext?.subject ?? "",
    emailOpened: emailContext?.opened ?? false,
    emailClicked: emailContext?.clicked ?? false,

    // Outreach history
    lastEmailMonth: outreachContext?.lastEmailMonth ?? "",
  };
}

// ─── Variant Selection ──────────────────────────────────────────────────────

/**
 * Simple string hash (djb2) that returns a positive integer.
 * Used for deterministic variant selection: same person always gets the same variant.
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0; // unsigned 32-bit
  }
  return hash;
}

/**
 * Given a set of rules at the same position (variants), pick one deterministically
 * based on personId + campaignName + position. Uses weighted selection so
 * variantWeight controls traffic split.
 *
 * Returns the chosen rule, or undefined if rules is empty.
 */
function pickVariant<T extends { variantKey: string | null; variantWeight: number }>(
  rules: T[],
  personId: string,
  campaignName: string,
  position: number,
): T | undefined {
  if (rules.length === 0) return undefined;
  if (rules.length === 1) return rules[0];

  const totalWeight = rules.reduce((sum, r) => sum + r.variantWeight, 0);
  const hashValue = djb2Hash(`${personId}:${campaignName}:${position}`);
  const bucket = hashValue % totalWeight;

  let cumulative = 0;
  for (const rule of rules) {
    cumulative += rule.variantWeight;
    if (bucket < cumulative) return rule;
  }

  // Fallback (should not reach here, but safety net)
  return rules[0];
}

// ─── Sequence Rule Evaluation ─────────────────────────────────────────────────

export interface SequenceActionDescriptor {
  actionType: string;
  messageBody: string | null;
  delayMinutes: number;
  sequenceStepRef: string;
  variantKey: string | null;
}

export interface EvaluateSequenceRulesParams {
  workspaceSlug: string;
  campaignName: string;
  triggerEvent: "email_sent" | "connection_accepted";
  triggerStepRef?: string;
  personId: string;
  person: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    jobTitle?: string | null;
    linkedinUrl?: string | null;
    email: string | null;
  };
  emailContext?: {
    stepRef?: string;
    subject?: string;
    opened?: boolean;
    clicked?: boolean;
  };
  senderEmail?: string;
}

/**
 * Evaluate a condition on a CampaignSequenceRule.
 * Returns true if the condition passes (action should fire), false if it fails (else-path should fire).
 * Handles backward compatibility: if conditionType is null, falls back to requireConnected boolean.
 */
async function evaluateCondition(
  rule: { conditionType: string | null; requireConnected: boolean },
  personId: string,
  workspaceSlug: string,
): Promise<boolean> {
  const conditionType = rule.conditionType ?? (rule.requireConnected ? "requireConnected" : null);

  if (!conditionType) return true; // No condition — always passes

  switch (conditionType) {
    case "requireConnected": {
      const conn = await prisma.linkedInConnection.findFirst({
        where: { personId, status: "connected" },
      });
      return !!conn;
    }
    case "hasReplied": {
      const reply = await prisma.reply.findFirst({
        where: { personId, workspaceSlug },
      });
      return !!reply;
    }
    case "emailBounced": {
      const person = await prisma.person.findUnique({
        where: { id: personId },
        select: { status: true },
      });
      return person?.status === "bounced";
    }
    default:
      console.warn(`[sequencing] Unknown conditionType: ${conditionType}, treating as pass`);
      return true;
  }
}

/**
 * Evaluate all CampaignSequenceRules matching the given trigger event for a
 * campaign, returning action descriptors that the caller should enqueue.
 *
 * The caller (webhook handler, deploy engine, etc.) is responsible for
 * calling enqueueAction() with each returned descriptor.
 */
export async function evaluateSequenceRules(
  params: EvaluateSequenceRulesParams,
): Promise<SequenceActionDescriptor[]> {
  const {
    workspaceSlug,
    campaignName,
    triggerEvent,
    triggerStepRef,
    personId,
    person,
    emailContext,
  } = params;

  // 1. Query matching rules
  const rules = await prisma.campaignSequenceRule.findMany({
    where: {
      workspaceSlug,
      campaignName,
      triggerEvent,
      // If a triggerStepRef is provided, filter to rules referencing that step
      ...(triggerStepRef !== undefined
        ? { triggerStepRef }
        : {}),
    },
    orderBy: { position: "asc" },
  });

  const descriptors: SequenceActionDescriptor[] = [];

  // Resolve {{lastEmailMonth}} from this campaign's description field.
  // When setting up LinkedIn retargeting campaigns, store the source email
  // completion month in description as "lastEmailMonth:February" (or similar).
  // This avoids fragile date lookups on synced email campaigns whose DB
  // timestamps don't reflect the real EB completion dates.
  let lastEmailMonth = "";
  try {
    const thisCampaign = await prisma.campaign.findUnique({
      where: { workspaceSlug_name: { workspaceSlug, name: campaignName } },
      select: { description: true },
    });
    if (thisCampaign?.description) {
      const monthMatch = thisCampaign.description.match(/lastEmailMonth:(\w+)/);
      if (monthMatch) {
        lastEmailMonth = monthMatch[1];
      }
    }
  } catch (err) {
    console.warn("[sequencing] Failed to look up lastEmailMonth:", err);
  }

  // 2. Group rules by position to handle A/B variants.
  //    At each position, if multiple rules exist with different variantKeys,
  //    pick ONE deterministically per person (same person always gets same variant).
  //    Rules without a variantKey (legacy) are treated as standalone (no grouping).
  const rulesByPosition = new Map<number, typeof rules>();
  for (const rule of rules) {
    const group = rulesByPosition.get(rule.position) ?? [];
    group.push(rule);
    rulesByPosition.set(rule.position, group);
  }

  // Process each position group
  for (const [, positionRules] of rulesByPosition) {
    const variantRules = positionRules.filter((r) => r.variantKey !== null);
    const nonVariantRules = positionRules.filter((r) => r.variantKey === null);

    // If variant rules exist at this position, pick ONE via deterministic hash.
    // Non-variant rules always fire (backward compatible with existing campaigns).
    const rulesToEvaluate: typeof rules = [...nonVariantRules];

    if (variantRules.length > 0) {
      const chosen = pickVariant(
        variantRules,
        personId,
        campaignName,
        positionRules[0].position,
      );
      if (chosen) {
        rulesToEvaluate.push(chosen);
      }
    }

    for (const rule of rulesToEvaluate) {
      // 3. Evaluate condition (supports both legacy requireConnected and new conditionType)
      const conditionPassed = await evaluateCondition(rule, personId, workspaceSlug);

      // 4. Build template context
      const context = buildTemplateContext(person, emailContext, { lastEmailMonth });

      if (conditionPassed) {
        const messageBody = rule.messageTemplate
          ? compileTemplate(rule.messageTemplate, context)
          : null;

        descriptors.push({
          actionType: rule.actionType,
          messageBody,
          delayMinutes: rule.delayMinutes,
          sequenceStepRef: `rule_${rule.id}`,
          variantKey: rule.variantKey,
        });
      } else if (rule.elseActionType) {
        const messageBody = rule.elseMessageTemplate
          ? compileTemplate(rule.elseMessageTemplate, context)
          : null;

        descriptors.push({
          actionType: rule.elseActionType,
          messageBody,
          delayMinutes: rule.elseDelayMinutes ?? rule.delayMinutes,
          sequenceStepRef: `rule_${rule.id}_else`,
          variantKey: rule.variantKey,
        });
      }
    }
  }

  return descriptors;
}

// ─── Campaign Sequence Rule Creation ─────────────────────────────────────────

export interface LinkedInSequenceStep {
  position: number;
  type: string;           // "connect" | "message" | "profile_view"
  /**
   * Optional message template (Handlebars).
   *
   * For "message" actions: the message body sent to the prospect.
   * For "connect" actions: serves as the **connection note** attached to the
   * connection request. Leave blank (undefined/null) for a noteless connection
   * request, which is the recommended default for cold outreach (higher accept rates).
   */
  body?: string;
  delayHours?: number;    // Delay before executing
  triggerEvent?: string;  // Override trigger event
  triggerStepRef?: string;
  requireConnected?: boolean;
  // New if/else fields
  conditionType?: string;
  conditionStepRef?: string;
  elseActionType?: string;
  elseMessageTemplate?: string;
  elseDelayHours?: number;
  // A/B variant fields
  variantKey?: string;     // e.g. "A", "B", "C" — multiple steps at same position with different keys
  variantWeight?: number;  // Relative weight for traffic split (default 1 = equal)
}

export interface CreateSequenceRulesParams {
  workspaceSlug: string;
  campaignName: string;
  linkedinSequence: LinkedInSequenceStep[];
}

/**
 * Create CampaignSequenceRule records from a campaign's linkedinSequence array.
 * Called during campaign deploy to set up the sequencing engine.
 *
 * Existing rules for the campaign are deleted first to allow idempotent deploys.
 */
export async function createSequenceRulesForCampaign(
  params: CreateSequenceRulesParams,
): Promise<void> {
  const { workspaceSlug, campaignName, linkedinSequence } = params;

  // Delete existing rules for this campaign (idempotent deploy support)
  await prisma.campaignSequenceRule.deleteMany({
    where: { workspaceSlug, campaignName },
  });

  if (linkedinSequence.length === 0) return;

  const data = linkedinSequence.map((step) => ({
    workspaceSlug,
    campaignName,
    triggerEvent:
      step.triggerEvent ?? (step.position === 1 ? "delay_after_previous" : "email_sent"),
    triggerStepRef: step.triggerEvent === "email_sent" || (!step.triggerEvent && step.position !== 1)
      ? (step.triggerStepRef ?? `email_${step.position}`)
      : (step.triggerStepRef ?? null),
    actionType: step.type,
    messageTemplate: step.body ?? null,
    delayMinutes: (step.delayHours ?? 0) * 60,
    requireConnected: step.requireConnected ?? step.type === "message",
    conditionType: step.conditionType ?? null,
    conditionStepRef: step.conditionStepRef ?? null,
    elseActionType: step.elseActionType ?? null,
    elseMessageTemplate: step.elseMessageTemplate ?? null,
    elseDelayMinutes: step.elseDelayHours != null ? step.elseDelayHours * 60 : null,
    position: step.position,
    variantKey: step.variantKey ?? null,
    variantWeight: step.variantWeight ?? 1,
  }));

  await prisma.campaignSequenceRule.createMany({ data });
}
