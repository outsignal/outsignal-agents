import { NextRequest, NextResponse } from "next/server";
import {
  extractDomainParts,
  generateDomainSuggestions,
  checkDomainAvailability,
} from "@/lib/porkbun";

export async function POST(request: NextRequest) {
  try {
    const { website } = await request.json();

    if (!website || typeof website !== "string") {
      return NextResponse.json(
        { error: "Website URL is required" },
        { status: 400 },
      );
    }

    const { baseName, tld } = extractDomainParts(website);
    const domains = generateDomainSuggestions(baseName, tld);

    // Check availability in parallel
    const results = await Promise.allSettled(
      domains.map(async (domain) => {
        const available = await checkDomainAvailability(domain);
        return { domain, available };
      }),
    );

    const suggestions = results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      return { domain: domains[i], available: false };
    });

    return NextResponse.json({ suggestions, baseName, tld });
  } catch (error) {
    console.error("Domain suggestion error:", error);
    return NextResponse.json(
      { error: "Failed to check domain availability" },
      { status: 500 },
    );
  }
}
