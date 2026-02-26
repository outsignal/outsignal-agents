/**
 * One-time script to set up existing clients who don't have DB records.
 * Fetches their website, uses AI to extract structured data, creates
 * a Slack channel, and creates a workspace DB record.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/setup-client.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { WebClient } from "@slack/web-api";

const prisma = new PrismaClient();

interface ClientInput {
  slug: string;
  name: string;
  apiToken: string;
  contactEmail: string;
  websiteUrl: string;
  vertical?: string; // override AI if already known
}

// --- Clients to set up ---
const clients: ClientInput[] = [
  {
    slug: "rise",
    name: "Rise",
    apiToken: "11|R8hdq8uNJf3WlUdbEiin4z8KeTmEqGvubGvEjNUn09a86c02",
    contactEmail: "jonathan@riseheadwear.com",
    websiteUrl: "https://riseheadwear.com",
    vertical: "Branded Merchandise",
  },
  {
    slug: "myacq",
    name: "MyAcq",
    apiToken: "16|dgLdXU9AfMr2Ee7bfZSjIcGRxaGMUvTcxtULBd6Q6ccdbe7b",
    contactEmail: "will@myacq.co",
    websiteUrl: "https://myacq.co/",
  },
  {
    slug: "1210-solutions",
    name: "1210 Solutions",
    apiToken: "17|WZWCUJLeIkevxMjvmF544FyUah7nQvZdVmVy6uKe4cedace1",
    contactEmail: "daniel@1210solutions.co.uk",
    websiteUrl: "https://www.1210solutions.co.uk/",
  },
];

async function fetchWebsiteText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Outsignal/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();
  // Strip HTML tags, scripts, styles
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 8000);
}

async function analyzeWithAI(
  client: ClientInput,
  websiteText: string,
): Promise<Record<string, string | null>> {
  const prompt = `You are analyzing a business to extract structured data for a cold outbound campaign platform.

Company: ${client.name}
Website: ${client.websiteUrl}
Known vertical: ${client.vertical || "Unknown"}

Website content:
${websiteText}

Extract the following fields as a JSON object. Use null for anything you cannot determine. Be specific and actionable — these will be used to configure outbound email campaigns.

{
  "vertical": "Industry in 2-4 words (e.g., 'Custom Headwear', 'Branded Merchandise')",
  "icpCountries": "Target countries, comma-separated (e.g., 'United Kingdom, United States')",
  "icpIndustries": "Target customer industries, comma-separated",
  "icpCompanySize": "Target company sizes (e.g., '50-500 employees')",
  "icpDecisionMakerTitles": "Job titles of decision makers, comma-separated",
  "icpKeywords": "Keywords for targeting, comma-separated",
  "icpExclusionCriteria": "Who to exclude from targeting",
  "coreOffers": "Main products/services offered",
  "differentiators": "What makes them unique",
  "painPoints": "Customer problems they solve",
  "pricingSalesCycle": "Any pricing or sales cycle info",
  "website": "Normalized website URL"
}

Return ONLY the JSON object, no markdown formatting or explanation.`;

  const result = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    prompt,
  });

  try {
    return JSON.parse(result.text);
  } catch {
    console.error("Failed to parse AI response:", result.text);
    return {};
  }
}

const ADMIN_EMAIL = "jonathan@outsignal.ai";

function getSlackClient(): WebClient | null {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  return new WebClient(token);
}

async function lookupUserByEmail(email: string): Promise<string | null> {
  const slack = getSlackClient();
  if (!slack) return null;
  try {
    const result = await slack.users.lookupByEmail({ email });
    return result.user?.id ?? null;
  } catch (err: unknown) {
    const slackErr = err as { data?: { error?: string } };
    if (slackErr.data?.error === "users_not_found") return null;
    throw err;
  }
}

async function createSlackChannelWithMembers(
  name: string,
  emails: string[],
): Promise<string | null> {
  const slack = getSlackClient();
  if (!slack) {
    console.warn("  SLACK_BOT_TOKEN not set, skipping channel creation");
    return null;
  }

  const channelName = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

  const result = await slack.conversations.create({
    name: channelName,
    is_private: true,
  });

  if (!result.channel?.id) {
    throw new Error("Failed to create Slack channel");
  }

  const channelId = result.channel.id;

  // Invite users by email
  const userIds: string[] = [];
  const notFound: string[] = [];
  for (const email of emails) {
    try {
      const userId = await lookupUserByEmail(email);
      if (userId) {
        userIds.push(userId);
        console.log(`  Found Slack user for ${email}: ${userId}`);
      } else {
        notFound.push(email);
        console.log(`  No Slack user found for ${email}`);
      }
    } catch (err) {
      console.error(`  Failed to look up ${email}:`, err);
      notFound.push(email);
    }
  }

  if (userIds.length > 0) {
    try {
      await slack.conversations.invite({
        channel: channelId,
        users: userIds.join(","),
      });
      console.log(`  Invited ${userIds.length} user(s) to channel`);
    } catch (err) {
      console.error("  Failed to invite users:", err);
    }
  }

  if (notFound.length > 0) {
    console.warn(`  Could not find Slack users for: ${notFound.join(", ")}`);
  }

  return channelId;
}

async function inviteToExistingChannel(
  channelId: string,
  emails: string[],
): Promise<void> {
  const slack = getSlackClient();
  if (!slack) return;

  const userIds: string[] = [];
  for (const email of emails) {
    try {
      const userId = await lookupUserByEmail(email);
      if (userId) {
        userIds.push(userId);
        console.log(`  Found Slack user for ${email}: ${userId}`);
      } else {
        console.log(`  No Slack user found for ${email}`);
      }
    } catch (err) {
      console.error(`  Failed to look up ${email}:`, err);
    }
  }

  if (userIds.length > 0) {
    try {
      await slack.conversations.invite({
        channel: channelId,
        users: userIds.join(","),
      });
      console.log(`  Invited ${userIds.length} user(s) to channel`);
    } catch (err) {
      console.error("  Failed to invite users:", err);
    }
  }
}

async function postSlackMessage(
  channelId: string,
  text: string,
): Promise<void> {
  const slack = getSlackClient();
  if (!slack) return;
  await slack.chat.postMessage({ channel: channelId, text });
}

async function setupClient(client: ClientInput): Promise<void> {
  console.log(`\n=== Setting up ${client.name} ===`);

  // Check if DB record already exists
  const existing = await prisma.workspace.findUnique({
    where: { slug: client.slug },
  });
  if (existing) {
    console.log(`  DB record already exists for ${client.slug}, skipping creation.`);
    console.log(`  Use the settings page to update fields.`);
    return;
  }

  // 1. Fetch website
  console.log(`  Fetching ${client.websiteUrl}...`);
  let websiteText = "";
  try {
    websiteText = await fetchWebsiteText(client.websiteUrl);
    console.log(`  Fetched ${websiteText.length} chars of text`);
  } catch (err) {
    console.error(`  Failed to fetch website:`, err);
  }

  // 2. AI analysis
  console.log("  Analyzing with AI...");
  let aiData: Record<string, string | null> = {};
  if (websiteText) {
    try {
      aiData = await analyzeWithAI(client, websiteText);
      console.log("  AI analysis complete:", JSON.stringify(aiData, null, 2));
    } catch (err) {
      console.error("  AI analysis failed:", err);
    }
  }

  // 3. Create Slack channel with admin + client invited
  const channelEmails = [ADMIN_EMAIL, client.contactEmail];
  console.log(`  Creating Slack channel: client-${client.slug} (inviting: ${channelEmails.join(", ")})...`);
  let slackChannelId: string | null = null;
  try {
    slackChannelId = await createSlackChannelWithMembers(
      `client-${client.slug}`,
      channelEmails,
    );
    console.log(`  Slack channel created: ${slackChannelId}`);
  } catch (err) {
    console.error("  Failed to create Slack channel:", err);
  }

  // 4. Create workspace DB record
  console.log("  Creating workspace DB record...");
  const workspace = await prisma.workspace.create({
    data: {
      slug: client.slug,
      name: client.name,
      vertical: client.vertical || aiData.vertical || null,
      apiToken: client.apiToken,
      status: "active",
      slackChannelId,
      notificationEmails: JSON.stringify([client.contactEmail]),
      website: aiData.website || client.websiteUrl,
      icpCountries: aiData.icpCountries || null,
      icpIndustries: aiData.icpIndustries || null,
      icpCompanySize: aiData.icpCompanySize || null,
      icpDecisionMakerTitles: aiData.icpDecisionMakerTitles || null,
      icpKeywords: aiData.icpKeywords || null,
      icpExclusionCriteria: aiData.icpExclusionCriteria || null,
      coreOffers: aiData.coreOffers || null,
      differentiators: aiData.differentiators || null,
      painPoints: aiData.painPoints || null,
      pricingSalesCycle: aiData.pricingSalesCycle || null,
    },
  });

  console.log(`  Workspace created: ${workspace.slug} (id: ${workspace.id})`);

  // 5. Post welcome message to Slack
  if (slackChannelId) {
    try {
      await postSlackMessage(
        slackChannelId,
        `Client set up: *${workspace.name}*\nVertical: ${workspace.vertical ?? "N/A"}\nWebsite: ${workspace.website ?? "N/A"}\nContact: ${client.contactEmail}\nStatus: Active`,
      );
      console.log("  Welcome message posted to Slack");
    } catch {
      // Non-critical
    }
  }

  console.log(`  ✓ ${client.name} setup complete!`);
}

async function inviteExisting() {
  console.log("\n=== Inviting users to existing channels ===");
  const workspaces = await prisma.workspace.findMany({
    where: { slackChannelId: { not: null } },
  });

  for (const ws of workspaces) {
    if (!ws.slackChannelId) continue;
    const client = clients.find((c) => c.slug === ws.slug);
    const emails = [ADMIN_EMAIL];
    if (client) emails.push(client.contactEmail);

    console.log(`\n  Channel for ${ws.name} (${ws.slackChannelId}):`);
    await inviteToExistingChannel(ws.slackChannelId, emails);
  }
}

async function main() {
  const mode = process.argv[2];
  try {
    if (mode === "--invite-existing") {
      await inviteExisting();
    } else {
      for (const client of clients) {
        await setupClient(client);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
