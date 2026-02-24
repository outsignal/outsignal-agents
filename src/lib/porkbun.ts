const PORKBUN_API_BASE = "https://api.porkbun.com/api/json/v3";

interface PorkbunCheckResponse {
  status: string;
  your_ip?: string;
}

export async function checkDomainAvailability(
  domain: string,
): Promise<boolean> {
  const apiKey = process.env.PORKBUN_API_KEY;
  const secretKey = process.env.PORKBUN_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error("Porkbun API credentials not configured");
  }

  const res = await fetch(`${PORKBUN_API_BASE}/domain/checkDomain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      secretapikey: secretKey,
      domain,
    }),
  });

  const data = (await res.json()) as PorkbunCheckResponse;
  return data.status === "SUCCESS";
}

export function generateDomainSuggestions(
  baseName: string,
  tld: string,
): string[] {
  const prefixes = ["get", "try", "with", "hello", "meet", "use", "go"];
  const suffixes = ["hq", "team", "mail", "sends", "reach", "hub", "now"];

  const suggestions: string[] = [];

  for (const prefix of prefixes) {
    suggestions.push(`${prefix}${baseName}${tld}`);
  }

  for (const suffix of suffixes) {
    suggestions.push(`${baseName}${suffix}${tld}`);
  }

  return suggestions;
}

export function extractDomainParts(websiteUrl: string): {
  baseName: string;
  tld: string;
} {
  // Remove protocol and www
  let domain = websiteUrl
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();

  // Handle compound TLDs like .co.uk, .com.au
  const compoundTlds = [
    ".co.uk",
    ".org.uk",
    ".me.uk",
    ".com.au",
    ".co.nz",
    ".co.za",
    ".co.in",
    ".com.br",
  ];

  for (const ctld of compoundTlds) {
    if (domain.endsWith(ctld)) {
      const baseName = domain.slice(0, -ctld.length);
      return { baseName, tld: ctld };
    }
  }

  // Standard TLD
  const lastDot = domain.lastIndexOf(".");
  if (lastDot === -1) {
    return { baseName: domain, tld: ".com" };
  }

  return {
    baseName: domain.slice(0, lastDot),
    tld: domain.slice(lastDot),
  };
}
