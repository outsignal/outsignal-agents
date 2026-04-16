/**
 * Pre-flight Task 3 + Task 5 (READ-ONLY) — inbox allocation + daily-limit
 * survey for the Lime workspace.
 *
 * Task 3:
 *   - Prisma: count lime-recruitment Senders with channel in ('email','both').
 *   - Break down by status + healthStatus + emailBounceStatus.
 *   - Cross-reference with EB: ebClient.getSenderEmails() on the Lime API
 *     token (each workspace has its own EB workspace, so getSenderEmails
 *     returns the Lime EB workspace's inboxes).
 *   - Confirm CAMPAIGN_SENDER_ALLOCATION in email-adapter.ts is 1210-only
 *     (the five keys are 1210 campaign IDs per the file's comment).
 *
 * Task 5:
 *   - Group EB senders by provider (infer from email domain or explicit
 *     `type` field) and report each inbox's daily_limit.
 *   - Also report Sender.originalDailyLimit (our cached copy, used for
 *     bounce-based step-down).
 *
 * No writes. EB calls are GET-only.
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "lime-recruitment";

async function main() {
  const ws = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { slug: true, name: true, apiToken: true, package: true },
  });
  if (!ws) {
    console.log(`[MISS] Workspace '${WORKSPACE_SLUG}' not found`);
    await prisma.$disconnect();
    return;
  }
  console.log(
    `Workspace: ${ws.slug} / ${ws.name} / package=${ws.package} apiTokenPresent=${!!ws.apiToken}`,
  );

  // --- Task 3: DB-side sender counts ----------------------------------
  const senders = await prisma.sender.findMany({
    where: {
      workspaceSlug: WORKSPACE_SLUG,
      channel: { in: ["email", "both"] },
    },
    select: {
      id: true,
      name: true,
      emailAddress: true,
      channel: true,
      status: true,
      healthStatus: true,
      emailBounceStatus: true,
      emailBisonSenderId: true,
      originalDailyLimit: true,
      warmupDay: true,
    },
    orderBy: { emailBisonSenderId: "asc" },
  });
  console.log(`\n=== Task 3 — DB senders (channel in email|both) ===`);
  console.log(`total: ${senders.length}`);

  const byStatus: Record<string, number> = {};
  const byHealth: Record<string, number> = {};
  const byBounce: Record<string, number> = {};
  for (const s of senders) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    byHealth[s.healthStatus] = (byHealth[s.healthStatus] ?? 0) + 1;
    byBounce[s.emailBounceStatus] = (byBounce[s.emailBounceStatus] ?? 0) + 1;
  }
  console.log(`by status:            ${JSON.stringify(byStatus)}`);
  console.log(`by healthStatus:      ${JSON.stringify(byHealth)}`);
  console.log(`by emailBounceStatus: ${JSON.stringify(byBounce)}`);

  // Eligible pool mirroring the 1210 allocation rule of thumb:
  // status=active, healthStatus=healthy, emailBounceStatus in healthy|elevated,
  // emailBisonSenderId present.
  const eligible = senders.filter(
    (s) =>
      s.status === "active" &&
      s.healthStatus === "healthy" &&
      (s.emailBounceStatus === "healthy" || s.emailBounceStatus === "elevated") &&
      s.emailBisonSenderId != null,
  );
  console.log(
    `eligible-pool (active + healthy + bounce healthy|elevated + has EB id): ${eligible.length}`,
  );

  // --- Task 5 setup: peek at originalDailyLimit distribution ----------
  const origLimitCounts: Record<string, number> = {};
  for (const s of senders) {
    const k = s.originalDailyLimit == null ? "null" : String(s.originalDailyLimit);
    origLimitCounts[k] = (origLimitCounts[k] ?? 0) + 1;
  }
  console.log(
    `DB Sender.originalDailyLimit distribution: ${JSON.stringify(origLimitCounts)}`,
  );

  // --- Task 3b: EB senders --------------------------------------------
  if (!ws.apiToken) {
    console.log(`\n[SKIP] No apiToken on workspace — cannot call EB`);
    await prisma.$disconnect();
    return;
  }
  const client = new EmailBisonClient(ws.apiToken);
  const ebSenders = await client.getSenderEmails();
  console.log(`\n=== Task 3 — EB-side /sender-emails (Lime team) ===`);
  console.log(`total EB senders: ${ebSenders.length}`);

  const ebByStatus: Record<string, number> = {};
  const ebByType: Record<string, number> = {};
  for (const s of ebSenders) {
    ebByStatus[s.status ?? "?"] = (ebByStatus[s.status ?? "?"] ?? 0) + 1;
    ebByType[s.type ?? "?"] = (ebByType[s.type ?? "?"] ?? 0) + 1;
  }
  console.log(`by EB status: ${JSON.stringify(ebByStatus)}`);
  console.log(`by EB type:   ${JSON.stringify(ebByType)}`);

  // Cross-match DB <-> EB by emailBisonSenderId.
  const dbByEbId = new Map<number, (typeof senders)[number]>();
  for (const s of senders) {
    if (s.emailBisonSenderId != null) dbByEbId.set(s.emailBisonSenderId, s);
  }
  const ebByEbId = new Map<number, (typeof ebSenders)[number]>();
  for (const s of ebSenders) ebByEbId.set(s.id, s);

  const dbOnly = [...dbByEbId.keys()].filter((id) => !ebByEbId.has(id));
  const ebOnly = [...ebByEbId.keys()].filter((id) => !dbByEbId.has(id));
  console.log(`cross-match:`);
  console.log(`  DB-only EB IDs (in DB, missing from EB): [${dbOnly.join(",")}] (${dbOnly.length})`);
  console.log(`  EB-only EB IDs (in EB, missing from DB): [${ebOnly.join(",")}] (${ebOnly.length})`);

  // --- Task 5: daily limits + provider inference ----------------------
  console.log(`\n=== Task 5 — EB daily_limit per inbox, provider-inferred ===`);
  function inferProvider(email: string, type?: string): string {
    // EB `type` is usually "smtp" / "oauth" / etc. Domain heuristic is more
    // useful for the Outlook-vs-Google split.
    const dom = (email.split("@")[1] ?? "").toLowerCase();
    if (/@(outlook\.com|hotmail\.com|live\.com)$/i.test(`@${dom}`)) return "outlook-consumer";
    if (/@(gmail\.com|googlemail\.com)$/i.test(`@${dom}`)) return "google-consumer";
    // Custom-domain — the provider is determined by the MX / OAuth provider,
    // which we don't have in the EB SenderEmail shape. Use the EB `type` as a
    // soft hint if present.
    return `custom:${type ?? "unknown"}`;
  }

  const limitByProvider = new Map<string, number[]>();
  console.log(`  id | email | status | daily_limit | warmup | provider-inferred`);
  for (const s of ebSenders.slice().sort((a, b) => a.id - b.id)) {
    const prov = inferProvider(s.email, s.type);
    const limit = s.daily_limit ?? -1;
    const arr = limitByProvider.get(prov) ?? [];
    arr.push(limit);
    limitByProvider.set(prov, arr);
    console.log(
      `  ${s.id} | ${s.email} | ${s.status ?? "?"} | ${limit} | ${s.warmup_enabled ?? "?"} | ${prov}`,
    );
  }
  console.log(`\nper-provider daily_limit distribution:`);
  for (const [prov, limits] of limitByProvider) {
    const counts: Record<string, number> = {};
    for (const l of limits) counts[String(l)] = (counts[String(l)] ?? 0) + 1;
    console.log(`  ${prov}: ${JSON.stringify(counts)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
