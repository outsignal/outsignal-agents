export interface ProviderBalance {
  provider: string;
  status: "ok" | "warning" | "critical" | "unavailable" | "error";
  creditsRemaining: number | null;
  details: string;
  thresholds: { warning: number; critical: number } | null;
}

const TIMEOUT_MS = 10_000;

function makeController(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function statusFromCredits(
  remaining: number,
  warning: number,
  critical: number,
): "ok" | "warning" | "critical" {
  if (remaining < critical) return "critical";
  if (remaining < warning) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Individual provider checks
// ---------------------------------------------------------------------------

async function checkProspeo(): Promise<ProviderBalance> {
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) return { provider: "Prospeo", status: "error", creditsRemaining: null, details: "PROSPEO_API_KEY not set", thresholds: null };

  const { signal, clear } = makeController();
  try {
    const res = await fetch("https://api.prospeo.io/account-information", {
      headers: { "X-KEY": apiKey },
      signal,
    });
    const data = await res.json();
    const remaining: number = data.response?.remaining_credits ?? data.remaining_credits ?? 0;
    const thresholds = { warning: 500, critical: 100 };
    return {
      provider: "Prospeo",
      status: statusFromCredits(remaining, thresholds.warning, thresholds.critical),
      creditsRemaining: remaining,
      details: `${remaining} credits remaining`,
      thresholds,
    };
  } catch (err: unknown) {
    return { provider: "Prospeo", status: "error", creditsRemaining: null, details: `Fetch failed: ${(err as Error).message}`, thresholds: null };
  } finally {
    clear();
  }
}

async function checkFindyMail(): Promise<ProviderBalance> {
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) return { provider: "FindyMail", status: "error", creditsRemaining: null, details: "FINDYMAIL_API_KEY not set", thresholds: null };

  const { signal, clear } = makeController();
  try {
    const res = await fetch("https://app.findymail.com/api/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    const data = await res.json();
    const emailCredits: number = data.credits ?? data.email_credits ?? 0;
    const verifierCredits: number = data.verifier_credits ?? 0;
    const thresholds = { warning: 500, critical: 100 };
    return {
      provider: "FindyMail",
      status: statusFromCredits(emailCredits, thresholds.warning, thresholds.critical),
      creditsRemaining: emailCredits,
      details: `${emailCredits} email credits, ${verifierCredits} verifier credits`,
      thresholds,
    };
  } catch (err: unknown) {
    return { provider: "FindyMail", status: "error", creditsRemaining: null, details: `Fetch failed: ${(err as Error).message}`, thresholds: null };
  } finally {
    clear();
  }
}

async function checkApify(): Promise<ProviderBalance> {
  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken) return { provider: "Apify", status: "error", creditsRemaining: null, details: "APIFY_API_TOKEN not set", thresholds: null };

  const { signal, clear } = makeController();
  try {
    const res = await fetch("https://api.apify.com/v2/users/me/limits", {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal,
    });
    const data = await res.json();
    const limits = data.data ?? data;
    const monthlyUsageUsd: number = limits.current?.monthlyUsageUsd ?? limits.currentMonthlyUsageUsd ?? 0;
    const monthlyLimitUsd: number = limits.limits?.maxMonthlyUsageUsd ?? limits.monthlyUsageLimitUsd ?? 0;
    const remainingUsd = Math.max(0, monthlyLimitUsd - monthlyUsageUsd);
    const thresholds = { warning: 5, critical: 1 };
    return {
      provider: "Apify",
      status: statusFromCredits(remainingUsd, thresholds.warning, thresholds.critical),
      creditsRemaining: Math.round(remainingUsd * 100) / 100,
      details: `$${remainingUsd.toFixed(2)} remaining ($${monthlyUsageUsd.toFixed(2)} used of $${monthlyLimitUsd.toFixed(2)} limit)`,
      thresholds,
    };
  } catch (err: unknown) {
    return { provider: "Apify", status: "error", creditsRemaining: null, details: `Fetch failed: ${(err as Error).message}`, thresholds: null };
  } finally {
    clear();
  }
}

async function checkAdyntel(): Promise<ProviderBalance> {
  const apiKey = process.env.ADYNTEL_API_KEY;
  if (!apiKey) return { provider: "Adyntel", status: "error", creditsRemaining: null, details: "ADYNTEL_API_KEY not set", thresholds: null };
  const email = "jonathan@outsignal.ai";

  const { signal, clear } = makeController();
  try {
    const url = `https://api.adyntel.com/credits_check?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal });
    const data = await res.json();
    const remaining: number = data.credits ?? data.remaining_credits ?? data.balance ?? 0;
    const thresholds = { warning: 500, critical: 100 };
    return {
      provider: "Adyntel",
      status: statusFromCredits(remaining, thresholds.warning, thresholds.critical),
      creditsRemaining: remaining,
      details: `${remaining} credits remaining`,
      thresholds,
    };
  } catch (err: unknown) {
    return { provider: "Adyntel", status: "error", creditsRemaining: null, details: `Fetch failed: ${(err as Error).message}`, thresholds: null };
  } finally {
    clear();
  }
}

async function checkAiArk(): Promise<ProviderBalance> {
  const apiKey = process.env.AIARK_API_KEY;
  if (!apiKey) return { provider: "AI Ark", status: "error", creditsRemaining: null, details: "AIARK_API_KEY not set", thresholds: null };

  const { signal, clear } = makeController();
  try {
    const res = await fetch("https://api.ai-ark.com/api/developer-portal/v1/companies", {
      method: "POST",
      headers: {
        "X-TOKEN": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: { domain: ["google.com"] }, page: 0, limit: 1 }),
      signal,
    });

    if (res.status === 402 || res.status === 403) {
      return { provider: "AI Ark", status: "critical", creditsRemaining: 0, details: "Credits exhausted (API returned 402/403)", thresholds: null };
    }
    if (res.ok) {
      return { provider: "AI Ark", status: "ok", creditsRemaining: null, details: "API responding (no balance endpoint available)", thresholds: null };
    }
    return { provider: "AI Ark", status: "error", creditsRemaining: null, details: `Unexpected status ${res.status}`, thresholds: null };
  } catch (err: unknown) {
    return { provider: "AI Ark", status: "error", creditsRemaining: null, details: `Fetch failed: ${(err as Error).message}`, thresholds: null };
  } finally {
    clear();
  }
}

function checkBounceBan(): ProviderBalance {
  return {
    provider: "BounceBan",
    status: "unavailable",
    creditsRemaining: null,
    details: "No balance API — check dashboard manually",
    thresholds: null,
  };
}

function checkKitt(): ProviderBalance {
  return {
    provider: "Kitt",
    status: "unavailable",
    creditsRemaining: null,
    details: "No balance API — check dashboard manually",
    thresholds: null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function checkAllProviderBalances(): Promise<ProviderBalance[]> {
  const results = await Promise.allSettled([
    checkProspeo(),
    checkFindyMail(),
    checkApify(),
    checkAdyntel(),
    checkAiArk(),
  ]);

  const balances: ProviderBalance[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const names = ["Prospeo", "FindyMail", "Apify", "Adyntel", "AI Ark"];
    return {
      provider: names[i],
      status: "error" as const,
      creditsRemaining: null,
      details: `Unexpected error: ${(r.reason as Error).message}`,
      thresholds: null,
    };
  });

  balances.push(checkBounceBan(), checkKitt());

  return balances;
}
