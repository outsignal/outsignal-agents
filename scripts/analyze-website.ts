/**
 * Research Agent CLI — Analyze a client website and extract business intelligence.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/analyze-website.ts <workspace-slug>
 *   npx tsx --tsconfig tsconfig.json scripts/analyze-website.ts --url https://example.com
 *
 * When given a workspace slug, it reads the workspace's website URL from the DB,
 * runs the analysis, and updates empty ICP fields.
 *
 * When given a raw URL with --url, it runs the analysis standalone and prints results.
 */

import { PrismaClient } from "@prisma/client";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  crawlWebsite,
  scrapeUrl,
} from "../src/lib/firecrawl/client";

const prisma = new PrismaClient();

interface AnalysisResult {
  companyOverview: string;
  icpIndicators: {
    industries: string;
    titles: string;
    companySize: string;
    countries: string;
  };
  valuePropositions: string[];
  caseStudies: { client: string; result: string; metrics?: string }[];
  painPoints: string[];
  differentiators: string[];
  pricingSignals?: string;
  contentTone: string;
  suggestions: string[];
}

async function analyzeWebsite(
  url: string,
  workspaceSlug?: string,
): Promise<AnalysisResult> {
  console.log(`  Crawling ${url}...`);
  const pages = await crawlWebsite(url, { maxPages: 10 });
  console.log(`  Crawled ${pages.length} page(s)`);

  // Build context from crawled pages
  const pageContent = pages
    .map((p) => {
      const content = p.markdown.slice(0, 10000);
      return `--- PAGE: ${p.title ?? p.url} (${p.url}) ---\n${content}`;
    })
    .join("\n\n");

  // Load workspace data if slug provided
  let workspaceContext = "";
  if (workspaceSlug) {
    const ws = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
    });
    if (ws) {
      workspaceContext = `\n\nExisting workspace data:
- Vertical: ${ws.vertical ?? "not set"}
- ICP Countries: ${ws.icpCountries ?? "not set"}
- ICP Industries: ${ws.icpIndustries ?? "not set"}
- ICP Company Size: ${ws.icpCompanySize ?? "not set"}
- ICP Decision Maker Titles: ${ws.icpDecisionMakerTitles ?? "not set"}
- ICP Keywords: ${ws.icpKeywords ?? "not set"}
- Core Offers: ${ws.coreOffers ?? "not set"}
- Differentiators: ${ws.differentiators ?? "not set"}
- Pain Points: ${ws.painPoints ?? "not set"}
- Case Studies: ${ws.caseStudies ?? "not set"}

Compare your findings with these fields. Note which ones are missing and could be filled.`;
    }
  }

  console.log("  Analyzing with AI (Opus)...");
  const result = await generateText({
    model: anthropic("claude-opus-4-20250514"),
    system: `You are a business intelligence analyst for a cold outbound agency. You analyze CLIENT websites to extract actionable data for outbound campaigns.

CRITICAL RULES:
- You are analyzing OUR CLIENT'S website — the company we are doing outbound for. Your job is to understand them so we can sell their services to prospects.
- Clearly distinguish between the client company itself and any partners, suppliers, manufacturers, or white-label providers mentioned on their site. Do NOT conflate a manufacturing partner's staff count, facilities, or capacity with the client's own operations.
- Never present marketing claims as verified facts. If something seems inflated, flag it.
- ICP means "who BUYS from this company" — the decision-makers at the companies that would become their customers.
- Pain points are the problems their TARGET CUSTOMERS face, not the client's own problems. These are hooks for outbound messaging.
- Only include case studies with identifiable details. If unnamed, mark as "Unnamed".

Return ONLY a JSON object matching the requested schema, no markdown formatting.`,
    prompt: `Analyze this company's website and extract structured business intelligence for cold outbound campaigns.

Website: ${url}
${workspaceContext}

Website content:
${pageContent}

Return a JSON object with this exact structure:
{
  "companyOverview": "What the company does, their industry, their actual size (distinguish from partners/suppliers), market position. Be factual — don't conflate supply chain partners with the company itself.",
  "icpIndicators": {
    "industries": "Industries of companies who would BUY from this client, comma-separated",
    "titles": "Job titles of decision-makers who would buy, comma-separated",
    "companySize": "Size of companies who would buy from this client",
    "countries": "Target countries/regions where buyers are, comma-separated"
  },
  "valuePropositions": ["Specific value prop we can use in outbound messaging"],
  "caseStudies": [{"client": "Named client", "result": "What was achieved", "metrics": "Specific numbers if available, or 'Not specified'"}],
  "painPoints": ["Problem their TARGET CUSTOMERS face that this company solves — these become email hooks"],
  "differentiators": ["Concrete differentiators, not marketing fluff — certifications, unique processes, track record"],
  "pricingSignals": "Pricing model, MOQs, contract lengths, or 'Quote-based, not publicly listed'",
  "contentTone": "Their brand voice — this guides how we write outbound copy that matches their style",
  "suggestions": ["Actionable campaign strategy suggestion based on the analysis"]
}

Return ONLY the JSON object.`,
  });

  try {
    // Try to extract JSON from the response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    return JSON.parse(jsonMatch[0]) as AnalysisResult;
  } catch (err) {
    console.error("  Failed to parse AI response:", result.text.slice(0, 500));
    throw new Error(
      `Failed to parse analysis: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);

  let url: string | undefined;
  let workspaceSlug: string | undefined;

  // Parse args
  const urlIndex = args.indexOf("--url");
  if (urlIndex !== -1 && args[urlIndex + 1]) {
    url = args[urlIndex + 1];
  } else if (args[0] && !args[0].startsWith("--")) {
    workspaceSlug = args[0];
  }

  if (!url && !workspaceSlug) {
    console.error(
      "Usage:\n  npx tsx scripts/analyze-website.ts <workspace-slug>\n  npx tsx scripts/analyze-website.ts --url https://example.com",
    );
    process.exit(1);
  }

  try {
    // If workspace slug, look up the URL
    if (workspaceSlug && !url) {
      const ws = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
      });
      if (!ws) {
        console.error(`Workspace '${workspaceSlug}' not found`);
        process.exit(1);
      }
      if (!ws.website) {
        console.error(
          `Workspace '${workspaceSlug}' has no website URL set`,
        );
        process.exit(1);
      }
      url = ws.website;
      if (!url.startsWith("http")) url = `https://${url}`;
    }

    console.log(`\n=== Research Agent: Analyzing ${url} ===`);

    const analysis = await analyzeWebsite(url!, workspaceSlug);

    console.log("\n--- Analysis Results ---");
    console.log(JSON.stringify(analysis, null, 2));

    // Save to database
    const slug = workspaceSlug ?? "standalone";
    console.log("\n  Saving analysis to database...");
    const record = await prisma.websiteAnalysis.create({
      data: {
        workspaceSlug: slug,
        url: url!,
        crawlData: JSON.stringify(
          (await crawlWebsite(url!, { maxPages: 1 })).map((p) => ({
            url: p.url,
            title: p.title,
          })),
        ).slice(0, 100), // Just save metadata, not full content
        analysis: JSON.stringify(analysis),
        suggestions: JSON.stringify(analysis.suggestions),
        status: "complete",
      },
    });
    console.log(`  Saved: ${record.id}`);

    // If workspace, update empty ICP fields
    if (workspaceSlug) {
      console.log("\n  Updating workspace ICP fields...");
      const ws = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug },
      });
      if (ws) {
        const updates: Record<string, string> = {};

        if (!ws.vertical && analysis.companyOverview) {
          // Extract industry from overview
          updates.vertical = analysis.companyOverview.split(".")[0];
        }
        if (!ws.icpCountries && analysis.icpIndicators.countries)
          updates.icpCountries = analysis.icpIndicators.countries;
        if (!ws.icpIndustries && analysis.icpIndicators.industries)
          updates.icpIndustries = analysis.icpIndicators.industries;
        if (!ws.icpCompanySize && analysis.icpIndicators.companySize)
          updates.icpCompanySize = analysis.icpIndicators.companySize;
        if (
          !ws.icpDecisionMakerTitles &&
          analysis.icpIndicators.titles
        )
          updates.icpDecisionMakerTitles = analysis.icpIndicators.titles;
        if (!ws.coreOffers && analysis.valuePropositions.length > 0)
          updates.coreOffers = analysis.valuePropositions.join("; ");
        if (!ws.differentiators && analysis.differentiators.length > 0)
          updates.differentiators = analysis.differentiators.join("; ");
        if (!ws.painPoints && analysis.painPoints.length > 0)
          updates.painPoints = analysis.painPoints.join("; ");
        if (!ws.caseStudies && analysis.caseStudies.length > 0)
          updates.caseStudies = analysis.caseStudies
            .map(
              (cs) =>
                `${cs.client}: ${cs.result}${cs.metrics ? ` (${cs.metrics})` : ""}`,
            )
            .join("; ");
        if (!ws.pricingSalesCycle && analysis.pricingSignals)
          updates.pricingSalesCycle = analysis.pricingSignals;

        if (Object.keys(updates).length > 0) {
          await prisma.workspace.update({
            where: { slug: workspaceSlug },
            data: updates,
          });
          console.log(
            `  Updated ${Object.keys(updates).length} field(s): ${Object.keys(updates).join(", ")}`,
          );
        } else {
          console.log("  All ICP fields already populated.");
        }
      }
    }

    // Log the agent run
    await prisma.agentRun.create({
      data: {
        agent: "research",
        workspaceSlug: workspaceSlug ?? null,
        input: JSON.stringify({ url, workspaceSlug }),
        output: JSON.stringify(analysis),
        status: "complete",
        triggeredBy: "cli",
      },
    });

    console.log("\n  ✓ Analysis complete!");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
