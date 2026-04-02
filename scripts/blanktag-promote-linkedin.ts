/**
 * blanktag-promote-linkedin.ts
 *
 * Promotes ICP-fit DiscoveredPerson records into the BlankTag workspace
 * for LinkedIn-only campaign. Does NOT require email — only linkedinUrl.
 *
 * Filters:
 *   1. Has linkedinUrl
 *   2. Dedup by linkedinUrl
 *   3. companyDomain in Adyntel Google Ads results
 *   4. UK or US person location
 *   5. ICP-fit job title (include list)
 *   6. Exclude junk titles
 *
 * Then:
 *   - Upserts each person into Person table (by linkedinUrl match)
 *   - Creates PersonWorkspace link to blanktag
 *   - Adds all promoted people to the campaign's target list
 *   - Deletes old junk people from the previous target list
 *
 * Usage: cd /Users/jjay/programs/outsignal-agents && npx tsx scripts/blanktag-promote-linkedin.ts
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WORKSPACE_SLUG = "blanktag";
const ADYNTEL_FILE = "data/blanktag-adyntel-results.json";

// Campaign target list (the empty one linked to the campaign)
const TARGET_LIST_ID = "cmn4x4w4g0000zxicipc08h9b";
// Old target list with 27 junk people to delete
const OLD_TARGET_LIST_ID = "cmn3te7b00000zx9yr8jxzzbd";

// ICP title keywords (case-insensitive substring match)
const ICP_TITLE_KEYWORDS = [
  "ceo",
  "chief executive",
  "founder",
  "co-founder",
  "head of marketing",
  "vp marketing",
  "marketing director",
  "head of performance",
  "performance marketing",
  "digital marketing manager",
  "head of digital",
  "digital director",
  "owner",
  "business owner",
  "company owner",
  "head of ecommerce",
  "ecommerce manager",
  "head of growth",
  "managing director",
  "head of brand",
  "brand director",
  "director of marketing",
  "head of paid",
  "paid media",
  "cmo",
  "chief marketing",
  "ecommerce director",
  "dtc",
  "head of acquisition",
  "head of online",
];

// Junk title keywords to exclude (case-insensitive substring match)
const JUNK_TITLE_KEYWORDS = [
  "volunteer",
  "board member",
  "photographer",
  "cartoonist",
  "writer",
  "editor",
  "journalist",
  "producer",
  "assistant",
  "intern",
  "stylist",
  "supervisor",
  "key holder",
  "jeweller",
  "processor",
  "analyst",
  "scholar",
  "contributor",
  "photo editor",
  "appraiser",
  "postdoctoral",
  "ambassador",
  "erp product owner",
  "business operations product owner",
  "facilities operations",
  "franchise owner",
];

// UK/US location patterns (case-insensitive substring match)
const UK_US_LOCATION_PATTERNS = [
  "united kingdom",
  "united states",
  ", uk",
  ", us",
  "england",
  "scotland",
  "wales",
  "london",
  "manchester",
  "birmingham",
  "greater london",
  "britain",
  "america",
  "northern ireland",
  "new york",
  "california",
  "texas",
  "florida",
  "illinois",
  "liverpool",
  "bristol",
  "leeds",
  "sheffield",
  "edinburgh",
  "glasgow",
  "cardiff",
  "belfast",
  "nottingham",
  "newcastle",
  "southampton",
  "brighton",
  "oxford",
  "cambridge",
  "bath",
  "york",
  "exeter",
  "norwich",
  "leicester",
  "reading",
  "hampshire",
  "surrey",
  "essex",
  "kent",
  "sussex",
  "devon",
  "dorset",
  "norfolk",
  "suffolk",
  "somerset",
  "wiltshire",
  "hertfordshire",
  "buckinghamshire",
  "berkshire",
  "warwickshire",
  "cheshire",
  "lancashire",
  "derbyshire",
  "staffordshire",
  "shropshire",
  "worcestershire",
  "lincolnshire",
  "cambridgeshire",
  "northamptonshire",
  "oxfordshire",
  "gloucestershire",
  "cornwall",
  "cumbria",
  "rutland",
  "county",
  "ireland",
];

function isIcpTitle(title: string): boolean {
  const lower = title.toLowerCase();
  // Exclude junk first
  if (JUNK_TITLE_KEYWORDS.some((j) => lower.includes(j))) return false;
  // Check ICP match
  return ICP_TITLE_KEYWORDS.some((t) => lower.includes(t));
}

function isUkUsLocation(location: string): boolean {
  const lower = location.toLowerCase();
  return UK_US_LOCATION_PATTERNS.some((pat) => lower.includes(pat));
}

async function main() {
  console.log("=== BlankTag LinkedIn Promotion Script ===\n");

  // -------------------------------------------------------------------------
  // Step 0: Load Adyntel domains with Google Ads
  // -------------------------------------------------------------------------
  console.log("Loading Adyntel results...");
  const adyntelData = JSON.parse(readFileSync(ADYNTEL_FILE, "utf8"));
  const adyntelDomains = new Set<string>(
    Object.keys(adyntelData.results).filter(
      (k: string) => adyntelData.results[k].hasGoogleAds === true
    )
  );
  console.log(`Adyntel domains with Google Ads: ${adyntelDomains.size}`);

  // -------------------------------------------------------------------------
  // Step 1: Load ALL DiscoveredPerson for blanktag
  // -------------------------------------------------------------------------
  console.log("\nLoading DiscoveredPerson records...");
  const allDiscovered = await prisma.discoveredPerson.findMany({
    where: { workspaceSlug: WORKSPACE_SLUG },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      company: true,
      companyDomain: true,
      linkedinUrl: true,
      phone: true,
      location: true,
      discoverySource: true,
      status: true,
    },
  });
  console.log(`Total DiscoveredPerson records: ${allDiscovered.length}`);

  // -------------------------------------------------------------------------
  // Step 2: Filter pipeline
  // -------------------------------------------------------------------------

  // 2a: Must have linkedinUrl
  const withLinkedin = allDiscovered.filter((p) => p.linkedinUrl);
  console.log(`With LinkedIn URL: ${withLinkedin.length}`);

  // 2b: Dedup by linkedinUrl (keep first occurrence)
  const seenUrls = new Set<string>();
  const deduped = withLinkedin.filter((p) => {
    const url = p.linkedinUrl!;
    if (seenUrls.has(url)) return false;
    seenUrls.add(url);
    return true;
  });
  console.log(`After LinkedIn dedup: ${deduped.length}`);

  // 2c: companyDomain in Adyntel results (UK Shopify + Google Ads)
  const adyntelMatched = deduped.filter(
    (p) => p.companyDomain && adyntelDomains.has(p.companyDomain)
  );
  console.log(`In Adyntel Google Ads domains: ${adyntelMatched.length}`);

  // 2d: UK or US location
  const locationMatched = adyntelMatched.filter(
    (p) => p.location && isUkUsLocation(p.location)
  );
  console.log(`UK/US/Ireland location: ${locationMatched.length}`);

  // 2e: ICP-fit title (includes + excludes junk)
  const icpMatched = locationMatched.filter(
    (p) => p.jobTitle && isIcpTitle(p.jobTitle)
  );
  console.log(`ICP-fit title match: ${icpMatched.length}`);

  if (icpMatched.length === 0) {
    console.log("No ICP-fit people found. Exiting.");
    await prisma.$disconnect();
    return;
  }

  // -------------------------------------------------------------------------
  // Step 3: Promote each person to Person table + PersonWorkspace
  // -------------------------------------------------------------------------
  console.log(
    `\nPromoting ${icpMatched.length} people to Person table...`
  );

  const promotedPersonIds: string[] = [];
  const companies = new Set<string>();
  let created = 0;
  let linked = 0;

  for (const dp of icpMatched) {
    // Try to find existing Person by linkedinUrl
    let person = await prisma.person.findFirst({
      where: { linkedinUrl: dp.linkedinUrl! },
      select: { id: true },
    });

    if (!person) {
      // Try by email if available
      if (dp.email) {
        person = await prisma.person.findFirst({
          where: { email: dp.email },
          select: { id: true },
        });
      }
    }

    if (!person) {
      // Create new Person
      person = await prisma.person.create({
        data: {
          email: dp.email || null,
          firstName: dp.firstName || null,
          lastName: dp.lastName || null,
          jobTitle: dp.jobTitle || null,
          company: dp.company || null,
          companyDomain: dp.companyDomain || null,
          linkedinUrl: dp.linkedinUrl!,
          phone: dp.phone || null,
          location: dp.location || null,
          source: "discovery-blanktag-pipeline",
          status: "new",
        },
        select: { id: true },
      });
      created++;
    }

    // Upsert PersonWorkspace junction
    await prisma.personWorkspace.upsert({
      where: {
        personId_workspace: {
          personId: person.id,
          workspace: WORKSPACE_SLUG,
        },
      },
      create: {
        personId: person.id,
        workspace: WORKSPACE_SLUG,
        tags: JSON.stringify(["google-ads-shopify", "linkedin-c1"]),
        status: "promoted",
      },
      update: {
        tags: JSON.stringify(["google-ads-shopify", "linkedin-c1"]),
        status: "promoted",
      },
    });

    promotedPersonIds.push(person.id);
    if (dp.companyDomain) companies.add(dp.companyDomain);
    if (dp.company) companies.add(dp.company);

    // Update DiscoveredPerson status
    await prisma.discoveredPerson.update({
      where: { id: dp.id },
      data: {
        status: "promoted",
        personId: person.id,
        promotedAt: new Date(),
      },
    });

    linked++;
  }

  console.log(`Created ${created} new Person records`);
  console.log(`Linked ${linked} PersonWorkspace records`);

  // -------------------------------------------------------------------------
  // Step 4: Delete old junk people from old target list
  // -------------------------------------------------------------------------
  console.log("\nDeleting 27 old people from old target list...");
  const deleted = await prisma.targetListPerson.deleteMany({
    where: { listId: OLD_TARGET_LIST_ID },
  });
  console.log(`Deleted ${deleted.count} entries from old target list`);

  // -------------------------------------------------------------------------
  // Step 5: Add all promoted people to campaign target list
  // -------------------------------------------------------------------------
  console.log(`\nAdding ${promotedPersonIds.length} people to target list ${TARGET_LIST_ID}...`);

  // Deduplicate person IDs (in case same person matched multiple discovered records)
  const uniquePersonIds = [...new Set(promotedPersonIds)];
  console.log(`Unique person IDs: ${uniquePersonIds.length}`);

  let addedToList = 0;
  let alreadyOnList = 0;

  for (const personId of uniquePersonIds) {
    try {
      await prisma.targetListPerson.create({
        data: {
          listId: TARGET_LIST_ID,
          personId,
        },
      });
      addedToList++;
    } catch (err: unknown) {
      // Unique constraint violation = already on list
      if (
        err instanceof Error &&
        err.message.includes("Unique constraint")
      ) {
        alreadyOnList++;
      } else {
        throw err;
      }
    }
  }

  console.log(`Added to target list: ${addedToList}`);
  if (alreadyOnList > 0) {
    console.log(`Already on list (skipped): ${alreadyOnList}`);
  }

  // -------------------------------------------------------------------------
  // Step 6: Summary
  // -------------------------------------------------------------------------
  const uniqueCompanyDomains = new Set(
    icpMatched
      .filter((p) => p.companyDomain)
      .map((p) => p.companyDomain!)
  );

  console.log("\n" + "=".repeat(60));
  console.log("BLANKTAG LINKEDIN PROMOTION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total DiscoveredPerson:    ${allDiscovered.length}`);
  console.log(`After all filters:         ${icpMatched.length}`);
  console.log(`New Person records:        ${created}`);
  console.log(`PersonWorkspace links:     ${linked}`);
  console.log(`Unique companies:          ${uniqueCompanyDomains.size}`);
  console.log(`Added to target list:      ${addedToList}`);
  console.log(`Old list entries deleted:  ${deleted.count}`);
  console.log(`Target list ID:            ${TARGET_LIST_ID}`);
  console.log("=".repeat(60));

  // -------------------------------------------------------------------------
  // Step 7: Verify campaign setup
  // -------------------------------------------------------------------------
  console.log("\n--- Campaign Verification ---");

  const campaign = await prisma.campaign.findFirst({
    where: { workspaceSlug: WORKSPACE_SLUG },
    include: {
      targetList: {
        include: {
          _count: { select: { people: true } },
        },
      },
    },
  });

  if (campaign) {
    console.log(`Campaign: ${campaign.name}`);
    console.log(`Status: ${campaign.status}`);
    console.log(`Channels: ${campaign.channels}`);
    console.log(`Target list: ${campaign.targetList?.name} (${campaign.targetList?.id})`);
    console.log(`People on target list: ${campaign.targetList?._count?.people}`);
    console.log(`LinkedIn sequence: ${campaign.linkedinSequence ? "present" : "missing"}`);
    console.log(`Email sequence: ${campaign.emailSequence ? "present" : "N/A (LinkedIn-only)"}`);

    if (campaign.linkedinSequence) {
      try {
        const steps = JSON.parse(campaign.linkedinSequence);
        console.log(`LinkedIn sequence steps: ${steps.length}`);
        for (const step of steps) {
          const bodyPreview = step.body
            ? step.body.substring(0, 80) + (step.body.length > 80 ? "..." : "")
            : "(empty)";
          console.log(
            `  Step ${step.position}: ${step.type || "message"} | delay ${step.delayDays}d | ${bodyPreview}`
          );
        }
      } catch {
        console.log("  (could not parse LinkedIn sequence)");
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
