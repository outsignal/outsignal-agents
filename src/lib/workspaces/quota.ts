/**
 * Workspace quota tracking and billing window utilities.
 * Quota usage is always derived from DiscoveredPerson records — never cached counters.
 */
import { prisma } from "@/lib/db";

/** Valid workspace capability modules */
export type WorkspaceModule = "email" | "email-signals" | "linkedin" | "linkedin-signals";

const VALID_MODULES: WorkspaceModule[] = ["email", "email-signals", "linkedin", "linkedin-signals"];

/**
 * Parse enabledModules JSON string from Workspace model.
 * Returns array of valid module names. Falls back to ["email"] on parse error.
 */
export function parseModules(raw: string): WorkspaceModule[] {
  try {
    const parsed = JSON.parse(raw) as string[];
    return parsed.filter((m): m is WorkspaceModule =>
      VALID_MODULES.includes(m as WorkspaceModule)
    );
  } catch {
    return ["email"];
  }
}

/**
 * Check if a workspace has a specific module enabled.
 */
export function hasModule(enabledModulesJson: string, module: WorkspaceModule): boolean {
  return parseModules(enabledModulesJson).includes(module);
}

/**
 * Compute the start of the current rolling 30-day billing window.
 * The anchor is the workspace's billingCycleAnchor or createdAt.
 * We find the most recent window start that is <= now.
 */
export function computeBillingWindowStart(anchor: Date): Date {
  const now = new Date();
  const anchorMs = anchor.getTime();
  const windowMs = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

  // How many full 30-day windows have elapsed since anchor?
  const elapsed = now.getTime() - anchorMs;
  const windowCount = Math.floor(elapsed / windowMs);

  return new Date(anchorMs + windowCount * windowMs);
}

export interface QuotaUsage {
  staticLeadsUsed: number;
  signalLeadsUsed: number;
  totalLeadsUsed: number;
  campaignsUsed: number;
  billingWindowStart: Date;
  billingWindowEnd: Date;
}

/**
 * Get quota usage for a workspace in the current billing window.
 * Counts DiscoveredPerson records with promotedAt in the window.
 * Counts Campaign records with createdAt in the window (excluding cancelled).
 */
export async function getWorkspaceQuotaUsage(workspaceSlug: string): Promise<QuotaUsage> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { slug: workspaceSlug },
  });

  const anchor = ws.billingCycleAnchor ?? ws.createdAt;
  const billingWindowStart = computeBillingWindowStart(anchor);
  const billingWindowEnd = new Date(billingWindowStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Count promoted/duplicate DiscoveredPerson records in window
  // TODO Phase 17+: Add discoverySource-based split for static vs signal pools
  const totalLeadsUsed = await prisma.discoveredPerson.count({
    where: {
      workspaceSlug,
      promotedAt: {
        gte: billingWindowStart,
        lt: billingWindowEnd,
      },
      status: { in: ["promoted", "duplicate"] },
    },
  });

  // Count campaigns created in window (excluding cancelled)
  const campaignsUsed = await prisma.campaign.count({
    where: {
      workspaceSlug,
      createdAt: {
        gte: billingWindowStart,
        lt: billingWindowEnd,
      },
      status: { not: "cancelled" },
    },
  });

  return {
    staticLeadsUsed: totalLeadsUsed, // All leads count as static until signal campaigns exist
    signalLeadsUsed: 0,               // Signal pool tracking added in Phase 18
    totalLeadsUsed,
    campaignsUsed,
    billingWindowStart,
    billingWindowEnd,
  };
}
