/**
 * BL-109 RE-OPEN (2026-04-16) — Raw JSON dump probe for the EmailBison
 * timezone drift between the EB UI display (PM-verified: Europe/Dublin on
 * all 4 × 1210-solutions campaigns) and our `getSchedule` API call
 * (returns Europe/London). One source is wrong — this probe captures the
 * VERBATIM wire response from the EB server on multiple endpoints so we
 * can see which field(s) drive the UI display and where the Dublin value
 * is actually stored.
 *
 * READ-ONLY. No mutations. No edits to src/lib/emailbison/client.ts or
 * src/lib/channels/email-adapter.ts (br7jxqrhv parallel task active on
 * email-adapter).
 *
 * The script bypasses the Zod parsing in `EmailBisonClient.request<T>()`
 * by calling `fetch()` directly with the same auth + base URL. This is
 * the only way to see the UNPARSED server payload (including any fields
 * that aren't modelled in our TypeScript types).
 *
 * Endpoints probed for EB campaigns 92, 94, 95, 96, 97:
 *   - GET /api/campaigns/{id}                 (full campaign object)
 *   - GET /api/campaigns/{id}/schedule        (campaign schedule)
 *
 * Endpoints probed once (account / workspace / user level):
 *   - GET /api/users                          (authenticated user details)
 *   - GET /api/workspaces                     (workspace list)
 *   - GET /api/workspaces/v1.1                (workspace list v1.1)
 *   - GET /api/workspaces/v1.1/master-inbox-settings
 *   - GET /api/campaigns/schedule/templates   (schedule templates)
 *   - GET /api/campaigns/schedule/available-timezones
 *
 * Then: grep ALL response bodies for keys matching /timezone|tz|zone|
 *   location|region/i and print every such key:value pair with context
 *   (endpoint + parent path).
 */

import { PrismaClient } from "@prisma/client";

const WORKSPACE_SLUG = "1210-solutions";
const EB_CAMPAIGN_IDS = [92, 94, 95, 96, 97] as const;
const BASE_URL = "https://app.outsignal.ai/api";

type DumpResult = {
  endpoint: string;
  httpStatus: number;
  contentType: string | null;
  rawBody: string;
  parseError?: string;
  parsed?: unknown;
};

/**
 * Raw fetch wrapper — NO Zod parsing. Returns the verbatim response text
 * plus the HTTP status + content-type so the caller sees exactly what
 * the EB server returned.
 */
async function rawGet(token: string, endpoint: string): Promise<DumpResult> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  const rawBody = await res.text();
  const contentType = res.headers.get("content-type");
  let parsed: unknown;
  let parseError: string | undefined;
  try {
    parsed = rawBody.length > 0 ? JSON.parse(rawBody) : undefined;
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  return {
    endpoint,
    httpStatus: res.status,
    contentType,
    rawBody,
    parseError,
    parsed,
  };
}

/**
 * Recursively walk a JSON value looking for any key that matches
 * TIMEZONE_KEY_PATTERNS. Yields `{path, key, value}` tuples so callers
 * can tabulate every hit.
 */
const TIMEZONE_KEY_PATTERNS = /timezone|^tz$|_tz$|zone|location|region/i;

function* findTimezoneKeys(
  value: unknown,
  path: string,
): Generator<{ path: string; key: string; value: unknown }> {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      yield* findTimezoneKeys(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path === "" ? k : `${path}.${k}`;
      if (TIMEZONE_KEY_PATTERNS.test(k)) {
        yield { path: childPath, key: k, value: v };
      }
      // Recurse regardless — nested tz fields are fair game.
      yield* findTimezoneKeys(v, childPath);
    }
  }
}

/**
 * Pretty-print a DumpResult — raw body with labels, then any parsed
 * tz-ish keys at the bottom.
 */
function printDump(d: DumpResult, label: string): void {
  console.log(`\n\n=================================================`);
  console.log(`=== ${label}`);
  console.log(`=== GET ${d.endpoint}`);
  console.log(`=== HTTP ${d.httpStatus} | content-type=${d.contentType}`);
  console.log(`=================================================`);
  console.log("--- RAW RESPONSE BODY (verbatim, pre-parse) ---");
  console.log(d.rawBody);
  if (d.parseError) {
    console.log(`--- JSON.parse error: ${d.parseError} ---`);
  }
  if (d.parsed !== undefined) {
    const hits: Array<{ path: string; key: string; value: unknown }> = [];
    for (const h of findTimezoneKeys(d.parsed, "")) hits.push(h);
    console.log(
      `--- Timezone-keyword matches (${hits.length}): keys matching /timezone|tz|zone|location|region/i ---`,
    );
    for (const h of hits) {
      const valStr =
        typeof h.value === "object"
          ? JSON.stringify(h.value).slice(0, 200)
          : String(h.value);
      console.log(`  [${h.path}] => ${valStr}`);
    }
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(`Workspace '${WORKSPACE_SLUG}' has no apiToken`);
    }
    const token = ws.apiToken;

    const allResults: DumpResult[] = [];

    // 1. Per-campaign probes
    for (const ebId of EB_CAMPAIGN_IDS) {
      const campaignDump = await rawGet(token, `/campaigns/${ebId}`);
      printDump(campaignDump, `EB Campaign ${ebId} — full campaign object`);
      allResults.push(campaignDump);

      const scheduleDump = await rawGet(token, `/campaigns/${ebId}/schedule`);
      printDump(scheduleDump, `EB Campaign ${ebId} — schedule`);
      allResults.push(scheduleDump);
    }

    // 2. Account / user / workspace probes (once)
    const usersDump = await rawGet(token, `/users`);
    printDump(usersDump, `/users — authenticated user details`);
    allResults.push(usersDump);

    const wsListDump = await rawGet(token, `/workspaces`);
    printDump(wsListDump, `/workspaces — workspace list (v1, deprecated)`);
    allResults.push(wsListDump);

    const wsListV11Dump = await rawGet(token, `/workspaces/v1.1`);
    printDump(wsListV11Dump, `/workspaces/v1.1 — workspace list v1.1`);
    allResults.push(wsListV11Dump);

    // master-inbox-settings is scoped to the currently-selected workspace.
    const masterInboxDump = await rawGet(
      token,
      `/workspaces/v1.1/master-inbox-settings`,
    );
    printDump(masterInboxDump, `/workspaces/v1.1/master-inbox-settings`);
    allResults.push(masterInboxDump);

    const tzListDump = await rawGet(
      token,
      `/campaigns/schedule/available-timezones`,
    );
    printDump(tzListDump, `/campaigns/schedule/available-timezones`);
    allResults.push(tzListDump);

    const templatesDump = await rawGet(token, `/campaigns/schedule/templates`);
    printDump(templatesDump, `/campaigns/schedule/templates`);
    allResults.push(templatesDump);

    // Try a workspace-detail endpoint too (requires team_id). We can try to
    // extract the team_id from the v1.1 list and follow up.
    try {
      const wsListV11 = wsListV11Dump.parsed;
      // Shape is usually { data: [{ id, name, ... }, ...] }
      const data =
        wsListV11 && typeof wsListV11 === "object" && "data" in wsListV11
          ? (wsListV11 as { data: unknown }).data
          : null;
      if (Array.isArray(data)) {
        for (const w of data) {
          if (w && typeof w === "object" && "id" in w) {
            const teamId = (w as { id: unknown }).id;
            if (typeof teamId === "number") {
              const detailDump = await rawGet(
                token,
                `/workspaces/v1.1/${teamId}`,
              );
              printDump(
                detailDump,
                `/workspaces/v1.1/${teamId} — workspace detail`,
              );
              allResults.push(detailDump);
            }
          }
        }
      }
    } catch (e) {
      console.log(
        `\n(workspace-detail follow-up skipped — shape did not match)`,
      );
      console.log(e instanceof Error ? e.message : String(e));
    }

    // 3. Cross-endpoint timezone summary table
    console.log("\n\n=================================================");
    console.log("=== CROSS-ENDPOINT TIMEZONE-KEY SUMMARY");
    console.log("=================================================");
    type SummaryRow = { endpoint: string; path: string; value: unknown };
    const summary: SummaryRow[] = [];
    for (const d of allResults) {
      if (d.parsed === undefined) continue;
      for (const h of findTimezoneKeys(d.parsed, "")) {
        summary.push({
          endpoint: `${d.endpoint} (HTTP ${d.httpStatus})`,
          path: h.path,
          value: h.value,
        });
      }
    }
    console.log(JSON.stringify(summary, null, 2));

    console.log(`\n\n===== END BL-109 TZ RAW DUMP =====`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl109-tz-raw-dump] FATAL:", err);
  process.exit(1);
});
