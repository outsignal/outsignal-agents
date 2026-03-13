import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// =============================================================================
// Types
// =============================================================================

type ConnectionStatus = "connected" | "disconnected" | "degraded" | "no_api";

interface ProviderStatus {
  id: string;
  name: string;
  category:
    | "enrichment"
    | "ai"
    | "discovery"
    | "scraping"
    | "signals"
    | "notifications"
    | "infrastructure";
  status: ConnectionStatus;
  configured: boolean;
  credits?: { used?: number; remaining?: number; total?: number };
  plan?: string;
  billing?: { nextDate?: string; period?: string };
  dashboardUrl?: string;
  error?: string;
  lastChecked: string;
}

interface WebhookHealth {
  id: string;
  name: string;
  lastEventAt: string | null;
  last24hCount: number;
  status: "healthy" | "warning" | "inactive";
}

// =============================================================================
// Helper — fetch with timeout
// =============================================================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Provider check functions
// =============================================================================

async function checkLeadMagic(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const apiKey = process.env.LEADMAGIC_API_KEY;

  if (!apiKey) {
    return {
      id: "leadmagic",
      name: "LeadMagic",
      category: "enrichment",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://app.leadmagic.io",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.leadmagic.io/account/credits",
      { headers: { "X-API-KEY": apiKey } }
    );
    const data = await res.json();

    return {
      id: "leadmagic",
      name: "LeadMagic",
      category: "enrichment",
      status: "connected",
      configured: true,
      credits: {
        remaining: data?.credits,
      },
      dashboardUrl: "https://app.leadmagic.io",
      lastChecked: now,
    };
  } catch (err) {
    console.error("[integrations/status] LeadMagic check failed:", err);
    return {
      id: "leadmagic",
      name: "LeadMagic",
      category: "enrichment",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://app.leadmagic.io",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

async function checkProspeo(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const apiKey = process.env.PROSPEO_API_KEY;

  if (!apiKey) {
    return {
      id: "prospeo",
      name: "Prospeo",
      category: "enrichment",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://app.prospeo.io",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.prospeo.io/account-information",
      { headers: { "X-KEY": apiKey } }
    );
    const data = await res.json();

    return {
      id: "prospeo",
      name: "Prospeo",
      category: "enrichment",
      status: "connected",
      configured: true,
      credits: {
        used: data?.response?.used_credits,
        remaining: data?.response?.remaining_credits,
        total: data?.response?.remaining_credits != null && data?.response?.used_credits != null
          ? data.response.remaining_credits + data.response.used_credits
          : undefined,
      },
      plan: data?.response?.current_plan,
      billing: {
        nextDate: data?.response?.next_quota_renewal_date,
      },
      dashboardUrl: "https://app.prospeo.io",
      lastChecked: now,
    };
  } catch (err) {
    console.error("[integrations/status] Prospeo check failed:", err);
    return {
      id: "prospeo",
      name: "Prospeo",
      category: "enrichment",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://app.prospeo.io",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

async function checkFindyMail(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const apiKey = process.env.FINDYMAIL_API_KEY;

  if (!apiKey) {
    return {
      id: "findymail",
      name: "FindyMail",
      category: "enrichment",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://app.findymail.com",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://app.findymail.com/api/credits",
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    const data = await res.json();

    return {
      id: "findymail",
      name: "FindyMail",
      category: "enrichment",
      status: "connected",
      configured: true,
      credits: {
        remaining: data?.credits,
      },
      plan: data?.pricing,
      dashboardUrl: "https://app.findymail.com",
      lastChecked: now,
    };
  } catch (err) {
    return {
      id: "findymail",
      name: "FindyMail",
      category: "enrichment",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://app.findymail.com",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

async function checkFirecrawl(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return {
      id: "firecrawl",
      name: "Firecrawl",
      category: "scraping",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://www.firecrawl.dev/app",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.firecrawl.dev/v1/team/credit-usage",
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    const data = await res.json();

    return {
      id: "firecrawl",
      name: "Firecrawl",
      category: "scraping",
      status: "connected",
      configured: true,
      credits: {
        remaining: data?.data?.remaining_credits,
        total: data?.data?.plan_credits || undefined,
      },
      plan: undefined,
      billing: {
        nextDate: data?.data?.billing_period_end ?? undefined,
      },
      dashboardUrl: "https://www.firecrawl.dev/app",
      lastChecked: now,
    };
  } catch (err) {
    return {
      id: "firecrawl",
      name: "Firecrawl",
      category: "scraping",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://www.firecrawl.dev/app",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

async function checkApollo(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    return {
      id: "apollo",
      name: "Apollo",
      category: "discovery",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://app.apollo.io",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.apollo.io/api/v1/auth/health",
      { headers: { "x-api-key": apiKey } }
    );
    const data = await res.json();

    return {
      id: "apollo",
      name: "Apollo",
      category: "discovery",
      status: data?.is_logged_in ? "connected" as const : "degraded" as const,
      configured: true,
      dashboardUrl: "https://app.apollo.io",
      lastChecked: now,
    };
  } catch (err) {
    return {
      id: "apollo",
      name: "Apollo",
      category: "discovery",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://app.apollo.io",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

async function checkTheirStack(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const apiKey = process.env.THEIRSTACK_API_KEY;

  if (!apiKey) {
    return {
      id: "theirstack",
      name: "TheirStack",
      category: "discovery",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://app.theirstack.com",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.theirstack.com/v0/billing/credit-balance",
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    const data = await res.json();

    const remaining = data?.api_credits != null && data?.used_api_credits != null
      ? data.api_credits - data.used_api_credits
      : undefined;

    return {
      id: "theirstack",
      name: "TheirStack",
      category: "discovery",
      status: "connected",
      configured: true,
      credits: {
        used: data?.used_api_credits,
        remaining,
        total: data?.api_credits,
      },
      dashboardUrl: "https://app.theirstack.com",
      lastChecked: now,
    };
  } catch (err) {
    return {
      id: "theirstack",
      name: "TheirStack",
      category: "discovery",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://app.theirstack.com",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

async function checkApify(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const token = process.env.APIFY_API_TOKEN;

  if (!token) {
    return {
      id: "apify",
      name: "Apify",
      category: "scraping",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://console.apify.com",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://api.apify.com/v2/users/me",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();

    return {
      id: "apify",
      name: "Apify",
      category: "scraping",
      status: "connected",
      configured: true,
      plan: data?.data?.plan?.id ?? undefined,
      credits: {
        remaining: data?.data?.plan?.monthlyUsageCreditsUsd != null && data?.data?.plan?.usageCreditsUsedMonthlyUsd != null
          ? data.data.plan.monthlyUsageCreditsUsd - data.data.plan.usageCreditsUsedMonthlyUsd
          : undefined,
        used: data?.data?.plan?.usageCreditsUsedMonthlyUsd ?? undefined,
        total: data?.data?.plan?.monthlyUsageCreditsUsd ?? undefined,
      },
      dashboardUrl: "https://console.apify.com",
      lastChecked: now,
    };
  } catch (err) {
    console.error("[integrations/status] Apify check failed:", err);
    return {
      id: "apify",
      name: "Apify",
      category: "scraping",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://console.apify.com",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

// =============================================================================
// Env-var-only provider checks (no API call)
// =============================================================================

function checkOpenAI(): ProviderStatus {
  const now = new Date().toISOString();
  const configured = !!process.env.OPENAI_API_KEY;

  return {
    id: "openai",
    name: "OpenAI",
    category: "ai",
    status: configured ? "no_api" : "disconnected",
    configured,
    dashboardUrl: "https://platform.openai.com/usage",
    lastChecked: now,
  };
}

function checkAiArk(): ProviderStatus {
  const now = new Date().toISOString();
  const configured = !!process.env.AIARK_API_KEY;

  return {
    id: "aiark",
    name: "AI Ark",
    category: "enrichment",
    status: configured ? "no_api" : "disconnected",
    configured,
    dashboardUrl: "https://aiark.io",
    lastChecked: now,
  };
}

async function checkSerper(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    return {
      id: "serper",
      name: "Serper",
      category: "discovery",
      status: "disconnected",
      configured: false,
      dashboardUrl: "https://serper.dev/dashboard",
      lastChecked: now,
    };
  }

  try {
    const res = await fetchWithTimeout(
      "https://google.serper.dev/account",
      { headers: { "X-API-KEY": apiKey } }
    );
    const data = await res.json();

    return {
      id: "serper",
      name: "Serper",
      category: "discovery",
      status: "connected",
      configured: true,
      credits: {
        remaining: data?.balance,
      },
      dashboardUrl: "https://serper.dev/dashboard",
      lastChecked: now,
    };
  } catch (err) {
    return {
      id: "serper",
      name: "Serper",
      category: "discovery",
      status: "degraded",
      configured: true,
      dashboardUrl: "https://serper.dev/dashboard",
      error: "Connection check failed",
      lastChecked: now,
    };
  }
}

function checkPredictLeads(): ProviderStatus {
  const now = new Date().toISOString();
  const configured =
    !!process.env.PREDICTLEADS_API_KEY &&
    !!process.env.PREDICTLEADS_API_TOKEN;

  return {
    id: "predictleads",
    name: "PredictLeads",
    category: "signals",
    status: configured ? "no_api" : "disconnected",
    configured,
    dashboardUrl: "https://predictleads.com",
    lastChecked: now,
  };
}

function checkAnthropic(): ProviderStatus {
  const now = new Date().toISOString();
  const configured = !!process.env.ANTHROPIC_API_KEY;

  return {
    id: "anthropic",
    name: "Anthropic",
    category: "ai",
    status: configured ? "no_api" : "disconnected",
    configured,
    dashboardUrl: "https://console.anthropic.com/settings/billing",
    lastChecked: now,
  };
}

function checkResend(): ProviderStatus {
  const now = new Date().toISOString();
  const configured = !!process.env.RESEND_API_KEY;

  return {
    id: "resend",
    name: "Resend",
    category: "notifications",
    status: configured ? "no_api" : "disconnected",
    configured,
    dashboardUrl: "https://resend.com/overview",
    lastChecked: now,
  };
}

function checkSlack(): ProviderStatus {
  const now = new Date().toISOString();
  const configured = !!process.env.SLACK_BOT_TOKEN;

  return {
    id: "slack",
    name: "Slack",
    category: "notifications",
    status: configured ? "no_api" : "disconnected",
    configured,
    dashboardUrl: "https://api.slack.com/apps",
    lastChecked: now,
  };
}

// =============================================================================
// Infrastructure provider checks
// =============================================================================

async function checkNeon(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const configured = !!process.env.DATABASE_URL;
  if (!configured) {
    return { id: "neon", name: "Neon (PostgreSQL)", category: "infrastructure", status: "disconnected", configured: false, dashboardUrl: "https://console.neon.tech", lastChecked: now };
  }
  try {
    // Simple connectivity check
    await prisma.$queryRaw`SELECT 1`;
    return { id: "neon", name: "Neon (PostgreSQL)", category: "infrastructure", status: "connected", configured: true, dashboardUrl: "https://console.neon.tech", lastChecked: now };
  } catch (err) {
    return { id: "neon", name: "Neon (PostgreSQL)", category: "infrastructure", status: "degraded", configured: true, dashboardUrl: "https://console.neon.tech", error: "Database connection failed", lastChecked: now };
  }
}

async function checkRailway(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const workerUrl = process.env.LINKEDIN_WORKER_URL;
  if (!workerUrl) {
    return { id: "railway", name: "Railway (LinkedIn Worker)", category: "infrastructure", status: "disconnected", configured: false, dashboardUrl: "https://railway.com/dashboard", lastChecked: now };
  }
  try {
    const res = await fetchWithTimeout(`${workerUrl}/health`, {}, 5000);
    return { id: "railway", name: "Railway (LinkedIn Worker)", category: "infrastructure", status: res.ok ? "connected" : "degraded", configured: true, dashboardUrl: "https://railway.com/dashboard", lastChecked: now, ...(res.ok ? {} : { error: `Health check returned ${res.status}` }) };
  } catch (err) {
    return { id: "railway", name: "Railway (LinkedIn Worker)", category: "infrastructure", status: "degraded", configured: true, dashboardUrl: "https://railway.com/dashboard", error: "Worker unreachable", lastChecked: now };
  }
}

async function checkVercel(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    return { id: "vercel", name: "Vercel", category: "infrastructure", status: "no_api", configured: true, plan: "Pro", dashboardUrl: "https://vercel.com/outsignals-projects/cold-outbound-dashboard", lastChecked: now };
  }
  try {
    const res = await fetchWithTimeout(
      "https://api.vercel.com/v6/deployments?projectId=cold-outbound-dashboard&limit=1&state=READY",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    const latest = data?.deployments?.[0];
    const readyAt = latest?.ready ? new Date(latest.ready).toISOString() : undefined;
    return {
      id: "vercel", name: "Vercel", category: "infrastructure",
      status: "connected", configured: true, plan: "Pro",
      dashboardUrl: "https://vercel.com/outsignals-projects/cold-outbound-dashboard",
      lastChecked: now,
      ...(readyAt ? { billing: { nextDate: readyAt, period: "Last deploy" } } : {}),
    };
  } catch (err) {
    return { id: "vercel", name: "Vercel", category: "infrastructure", status: "degraded", configured: true, plan: "Pro", dashboardUrl: "https://vercel.com/outsignals-projects/cold-outbound-dashboard", error: "API check failed", lastChecked: now };
  }
}

async function checkTriggerDev(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const secretKey = process.env.TRIGGER_SECRET_KEY;
  if (!secretKey) {
    return { id: "triggerdev", name: "Trigger.dev", category: "infrastructure", status: "disconnected", configured: false, dashboardUrl: "https://cloud.trigger.dev", lastChecked: now };
  }
  try {
    // Check recent runs via Trigger.dev management API
    const res = await fetchWithTimeout(
      "https://api.trigger.dev/api/v1/runs?limit=1",
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (res.ok) {
      return { id: "triggerdev", name: "Trigger.dev", category: "infrastructure", status: "connected", configured: true, dashboardUrl: "https://cloud.trigger.dev", lastChecked: now };
    }
    return { id: "triggerdev", name: "Trigger.dev", category: "infrastructure", status: "degraded", configured: true, dashboardUrl: "https://cloud.trigger.dev", error: `API returned ${res.status}`, lastChecked: now };
  } catch (err) {
    return { id: "triggerdev", name: "Trigger.dev", category: "infrastructure", status: "degraded", configured: true, dashboardUrl: "https://cloud.trigger.dev", error: "API check failed", lastChecked: now };
  }
}

async function checkEmailBison(): Promise<ProviderStatus> {
  const now = new Date().toISOString();
  const token = process.env.EMAILBISON_ADMIN_TOKEN;
  if (!token) {
    return { id: "emailbison", name: "EmailBison", category: "infrastructure", status: "disconnected", configured: false, dashboardUrl: "https://app.outsignal.ai", lastChecked: now };
  }
  try {
    // Lightweight connection test — fetch first page of sender emails
    const res = await fetchWithTimeout(
      "https://app.outsignal.ai/api/sender-emails?page=1",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      return { id: "emailbison", name: "EmailBison", category: "infrastructure", status: "connected", configured: true, dashboardUrl: "https://app.outsignal.ai", lastChecked: now };
    }
    return { id: "emailbison", name: "EmailBison", category: "infrastructure", status: "degraded", configured: true, dashboardUrl: "https://app.outsignal.ai", error: `API returned ${res.status}`, lastChecked: now };
  } catch (err) {
    return { id: "emailbison", name: "EmailBison", category: "infrastructure", status: "degraded", configured: true, dashboardUrl: "https://app.outsignal.ai", error: "API check failed", lastChecked: now };
  }
}

function checkCheapInboxes(): ProviderStatus {
  const now = new Date().toISOString();
  return { id: "cheapinboxes", name: "CheapInboxes", category: "infrastructure", status: "no_api", configured: true, dashboardUrl: "https://cheapinboxes.com", lastChecked: now };
}

// =============================================================================
// Webhook health checks
// =============================================================================

async function checkWebhookHealth(): Promise<WebhookHealth[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    emailBisonCount,
    emailBisonLatest,
  ] = await Promise.all([
    // EmailBison — webhook events in last 24h
    prisma.webhookEvent.count({
      where: { receivedAt: { gte: twentyFourHoursAgo } },
    }),
    prisma.webhookEvent.findFirst({
      orderBy: { receivedAt: "desc" },
    }),
  ]);

  return [
    {
      id: "emailbison",
      name: "EmailBison Webhooks",
      lastEventAt: emailBisonLatest?.receivedAt?.toISOString() ?? null,
      last24hCount: emailBisonCount,
      status: emailBisonCount > 0 ? "healthy" : "inactive",
    },
  ];
}

// =============================================================================
// GET handler
// =============================================================================

export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Run all provider checks in parallel
    const providerResults = await Promise.allSettled([
      checkLeadMagic(),
      checkProspeo(),
      checkFindyMail(),
      checkFirecrawl(),
      checkApollo(),
      checkSerper(),
      checkTheirStack(),
      checkApify(),
      checkNeon(),
      checkRailway(),
      checkVercel(),
      checkTriggerDev(),
      checkEmailBison(),
    ]);

    // Collect API-checked providers (extract from settled results)
    const apiProviders: ProviderStatus[] = providerResults.map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      // Shouldn't happen since each function has its own try/catch,
      // but handle gracefully just in case
      return {
        id: "unknown",
        name: "Unknown",
        category: "enrichment" as const,
        status: "degraded" as const,
        configured: false,
        error: "Connection check failed",
        lastChecked: new Date().toISOString(),
      };
    });

    // Env-var-only providers (synchronous, no need for Promise.allSettled)
    const envProviders: ProviderStatus[] = [
      checkOpenAI(),
      checkAiArk(),
      checkPredictLeads(),
      checkAnthropic(),
      checkResend(),
      checkSlack(),
      checkCheapInboxes(),
    ];

    const providers = [...apiProviders, ...envProviders];

    // Webhook health checks
    let webhooks: WebhookHealth[] = [];
    try {
      webhooks = await checkWebhookHealth();
    } catch (err) {
      webhooks = [
        {
          id: "emailbison",
          name: "EmailBison Webhooks",
          lastEventAt: null,
          last24hCount: 0,
          status: "inactive",
        },
      ];
      console.error("Webhook health check failed:", err);
    }

    // Summary stats
    const summary = {
      total: providers.length,
      connected: providers.filter((p) => p.status === "connected").length,
      disconnected: providers.filter((p) => p.status === "disconnected").length,
      degraded: providers.filter((p) => p.status === "degraded").length,
      noApi: providers.filter((p) => p.status === "no_api").length,
    };

    return NextResponse.json({
      providers,
      webhooks,
      summary,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Integration status check failed:", err);
    return NextResponse.json(
      {
        error: "Failed to check integration status",
      },
      { status: 500 }
    );
  }
}
