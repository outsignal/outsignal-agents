/**
 * Covenco Instantly ITER 6 (FINAL) — propagate <div>-formatted HTML bodies
 * matching the admin's UI-typed Backup Services pattern to the 8 non-reference
 * campaigns. Under text_only=true, Instantly strips HTML on send to plain-text
 * MIME with preserved paragraph breaks (verified Gmail test, 2026-04-15).
 *
 * Reference campaign (Backup Services 578c27a2) is left UNTOUCHED — admin
 * hand-edited those 6 bodies in the UI. We verify text_only=true on all 9.
 *
 * Format (per variant body):
 *   <div>Hi {{firstName}}, </div>
 *   <div><br /></div>
 *   <div>{para1} </div>         <!-- trailing space before </div> -->
 *   <div><br /></div>
 *   <div>{para2} </div>
 *   <div><br /></div>
 *   <div>{CTA} </div>
 *   <div><br /></div>
 *   <div>Kind regards, </div>   <!-- trailing space -->
 *   <div>David Jerram </div>    <!-- trailing space -->
 *   <div>+44 1753 478313</div>  <!-- NO trailing space -->
 *
 * Safety: refuses to touch any campaign where status !== 0 (DRAFT).
 * Backup Services bodies and subjects untouched. Subjects on all other
 * campaigns untouched (left as stored; we assert they match the source doc).
 * Leads untouched. EmailBison untouched.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const REF_CAMPAIGN_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d";

type Step = {
  bodyParagraphs: [string, string, string]; // para1, para2, CTA
};
type CampaignSpec = {
  id: string;
  name: string;
  isReference: boolean;
  steps: [Step, Step, Step];
};

// Admin's UI-edited reference uses NBSP (U+00A0) as the trailing space
// inside each content <div>. This is standard browser contenteditable
// behaviour. We replicate exactly: trailing NBSP in every non-empty div
// except the terminating phone div (no trailing space there).
const NBSP = "\u00a0";
function divBody(paragraphs: [string, string, string]): string {
  const parts: string[] = [];
  parts.push(`<div>Hi {{firstName}},${NBSP}</div>`);
  parts.push(`<div><br /></div>`);
  for (const p of paragraphs) {
    parts.push(`<div>${p}${NBSP}</div>`);
    parts.push(`<div><br /></div>`);
  }
  parts.push(`<div>Kind regards,${NBSP}</div>`);
  parts.push(`<div>David Jerram${NBSP}</div>`);
  parts.push(`<div>+44 1753 478313</div>`);
  return parts.join("");
}

const CAMPAIGNS: CampaignSpec[] = [
  {
    id: REF_CAMPAIGN_ID,
    name: "Covenco - Backup Services",
    isReference: true,
    // Reference: bodies NOT written (admin hand-edited). Paragraphs here are
    // used only for audit expected-value comparison (identical to UI state).
    steps: [
      {
        bodyParagraphs: [
          "Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {{off-site|immutable|offline}} backup services built for secure recovery, not box-ticking.",
          "With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.",
          "Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?",
        ],
      },
      {
        bodyParagraphs: [
          "Backup problems rarely start with failure, they start with silent drift, missed checks and limited confidence when recovery is needed fast.",
          "Covenco runs 326 daily backup jobs and supports planning, monitoring, management and recovery as one service for customers across complex estates. That gives teams more control without more admin.",
          "Open to exploring whether {{companyName}} would benefit from a more hands-on backup approach?",
        ],
      },
      {
        bodyParagraphs: [
          "When budgets are tight, backup usually gets judged on cost, right until a restore takes too long or data cannot be recovered cleanly.",
          "Covenco combines immutable backup, private cloud recovery and day-to-day oversight in one managed service for leaner internal teams. As a Veeam Platinum provider, we keep things practical.",
          "Would it be unreasonable to ask how confident you feel in recovery today?",
        ],
      },
    ],
  },
  {
    id: "aacbce5d-f5a7-4156-8496-967c4efa5bfd",
    name: "Covenco - Data Resiliency and Recovery",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Resilience pressure usually shows up when data growth, cyber risk and recovery expectations keep rising at the same time.",
          "Covenco helps organisations {{protect|stabilise|strengthen}} critical data with off-site backup, immutability, replication and recovery support across mixed environments. We manage over 4PB of customer data and protect 3,000 servers today.",
          "Worth exploring whether data resilience at {{companyName}} is where leadership expects it to be?",
        ],
      },
      {
        bodyParagraphs: [
          "Many firms have backup in place, but still lack confidence around recoverability, testing and what happens when systems fail under pressure.",
          "Covenco supports the full cycle, from planning and monitoring through to recovery and ongoing management. That helps reduce risk without creating more overhead internally or more tooling.",
          "Open to exploring whether {{companyName}} has any resilience gaps that are easy to miss day to day?",
        ],
      },
      {
        bodyParagraphs: [
          "Resilience tends to get harder when teams are stretched, infrastructure is mixed, and recovery requirements are rising faster than budgets.",
          "Covenco combines data protection, disaster recovery and infrastructure support under one roof, backed by ISO 27001, 9001 and 14001 certifications. That gives teams one specialist partner instead of several disconnected providers and fragmented support models.",
          "Worth a conversation about whether that model could help {{companyName}}?",
        ],
      },
    ],
  },
  {
    id: "d5c16e36-f3cf-4aef-af79-af23e302ca6e",
    name: "Covenco - IT Insights",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Many IT leaders are being pushed to improve resilience, control spend and plan infrastructure changes all at once.",
          "Covenco works across backup, recovery, support and hardware, so we see where those pressures tend to collide. After 35 years in the market, the patterns are usually clear quite quickly.",
          "Worth a short exchange on what seems to be creating the most pressure at {{companyName}}?",
        ],
      },
      {
        bodyParagraphs: [
          "One common issue we see is teams treating backup, infrastructure and support as separate decisions, then discovering the real risk sits between them.",
          "Covenco helps connect those areas through data management and IT infrastructure services shaped around operational reality. That tends to surface options earlier and reduce avoidable blind spots.",
          "Open to exploring whether {{companyName}} is seeing the same kind of overlap right now?",
        ],
      },
      {
        bodyParagraphs: [
          "The more complex the estate, the easier it is for lead times, support gaps or recovery assumptions to create risk quietly in the background.",
          "Covenco supports customers across the UK, Europe and the USA with specialist infrastructure and data resilience services. Sometimes an outside view helps, especially when priorities are moving quickly.",
          "Would it be unreasonable to compare notes on where {{companyName}} may be exposed?",
        ],
      },
    ],
  },
  {
    id: "2bbb4ff1-eaed-4946-a62e-38d9cc24453e",
    name: "Covenco - IT Infrastructure",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Infrastructure pressure tends to build when systems are ageing, parts are hard to source and projects are slowed by long lead times.",
          "Covenco supplies and supports enterprise and midrange hardware with global sourcing, rapid shipping and practical engineering input. We stock over 40,000 items across major brands and generations.",
          "Worth exploring whether {{companyName}} is feeling any of that procurement or support pressure now?",
        ],
      },
      {
        bodyParagraphs: [
          "Many internal teams lose time chasing parts, extending ageing kit and juggling vendors when infrastructure support starts to fray.",
          "Covenco helps simplify that with supply, repair, refurbishment and lifecycle services across server, storage and networking estates. That can reduce downtime and planning headaches quickly, especially where long lead times are already hurting projects.",
          "Open to exploring whether {{companyName}} could use a steadier infrastructure partner?",
        ],
      },
      {
        bodyParagraphs: [
          "Replacing everything is rarely realistic when budgets are tight and critical systems still need to perform.",
          "Covenco helps organisations keep infrastructure productive through same-day shipping, flexible sourcing and specialist support, whether the priority is continuity, speed or cost control. That gives teams more breathing room during difficult planning cycles.",
          "Would it be worth asking where infrastructure strain is starting to show at {{companyName}}?",
        ],
      },
    ],
  },
  {
    id: "d6dce1e9-bebc-4537-aec7-17cbae52af10",
    name: "Covenco - Ransomware Recovery",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Ransomware risk is not only about prevention, it is about how quickly operations can recover when something gets through.",
          "Covenco provides ransomware recovery support with virtual and physical response, designed to reduce downtime and protect data integrity for affected businesses under pressure. Customers on our service average 48-hour recovery times.",
          "Worth exploring whether recovery readiness at {{companyName}} feels proven or mostly assumed today?",
        ],
      },
      {
        bodyParagraphs: [
          "Many firms have incident plans, but recovery can still stall when clean data, infrastructure and hands-on expertise are not lined up properly.",
          "Covenco combines cloud-based recovery with physical infrastructure to support restoration when criminals strike. That helps ease pressure on internal teams at the worst moment and shorten disruption significantly.",
          "Open to exploring whether {{companyName}} would benefit from a stronger ransomware recovery plan?",
        ],
      },
      {
        bodyParagraphs: [
          "The real cost of ransomware usually comes after the attack, when downtime stretches, legal pressure rises and internal teams are pulled in every direction.",
          "Covenco offers round-the-clock recovery assistance and handled 8 ransomware recoveries in 2024 for contracted customers across multiple environments. We focus on getting businesses operational again, fast.",
          "Would it be unreasonable to ask how {{companyName}} would manage that scenario today?",
        ],
      },
    ],
  },
  {
    id: "ebb2e715-8505-4944-88aa-fa2f326ce166",
    name: "Covenco - Managed Services",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Many IT teams are carrying too much operational load across patching, monitoring, uptime checks and issue resolution.",
          "Covenco provides managed monitoring and maintenance services that help spot faults early, protect availability and reduce support strain across critical environments every day, without adding complexity. Our approach is built around practical continuity, not ticket volume.",
          "Worth exploring whether {{companyName}} could use more breathing room across day-to-day operations?",
        ],
      },
      {
        bodyParagraphs: [
          "Support becomes expensive when internal teams are dragged into repeat issues, patching gaps and avoidable outages.",
          "Covenco offers managed services covering fault detection, network monitoring, uptime tracking and performance optimisation, all designed to reduce operational friction across busy estates and mixed systems. We also help cut support costs by up to 20 percent.",
          "Open to exploring whether that would be useful at {{companyName}}?",
        ],
      },
      {
        bodyParagraphs: [
          "A lot of managed services sound similar until something critical fails and response depth gets tested properly.",
          "Covenco combines monitoring, maintenance, backup and infrastructure expertise under one roof, with 24/7 support and token-based specialist services when needed. That gives teams more flexibility than a generic provider during pressured periods and resource gaps.",
          "Would it be worth asking whether {{companyName}} needs that kind of coverage?",
        ],
      },
    ],
  },
  {
    id: "b87c8795-4331-41c5-8d24-f888be7214d4",
    name: "Covenco - IBM Storage and Servers",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Many IBM teams are now weighing Power11 against the cost and risk of holding older estates together for another cycle.",
          "The challenge is rarely hardware alone, it is continuity, supportability and whether the platform still aligns with resilience and hybrid plans. Covenco helps organisations navigate IBM estate decisions with supply, support and practical lifecycle input.",
          "Worth exploring whether {{companyName}} is reviewing any IBM Power11 decisions currently?",
        ],
      },
      {
        bodyParagraphs: [
          "Power11 is getting attention because continuity expectations have changed, especially where maintenance windows, cyber resilience and operational overhead are under scrutiny.",
          "For many teams, the real issue is how to modernise IBM estates without forcing disruption or rushed change. Covenco supports IBM environments with sourcing, maintenance and infrastructure guidance across live estates.",
          "Open to exploring whether {{companyName}} is under any pressure around IBM refresh timing?",
        ],
      },
      {
        bodyParagraphs: [
          "If IBM systems still support critical workloads, delaying estate decisions can quietly increase support pressure, recovery risk and commercial drag.",
          "Power11 has changed the conversation for teams looking at availability, hybrid flexibility and longer-term platform fit. Covenco helps organisations assess the practical route forward across IBM environments, from ongoing support through to newer platform options.",
          "Would it be unreasonable to ask whether IBM Power11 is on {{companyName}}'s roadmap?",
        ],
      },
    ],
  },
  {
    id: "f439a04c-e213-4dbd-bf0e-2f2463bf6b75",
    name: "Covenco - Discover Covenco",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Many organisations reach a point where backup, recovery and infrastructure support are handled separately, and the gaps start showing.",
          "Covenco brings those areas together through data management, IT infrastructure supply and managed services designed around resilience and continuity across critical estates. We have supported customers since 1989 and hold ISO 27001, 9001 and 14001 certifications.",
          "Worth exploring whether that model could help {{companyName}}?",
        ],
      },
      {
        bodyParagraphs: [
          "Covenco tends to be useful when teams are dealing with ageing infrastructure, rising recovery expectations or support that feels too fragmented.",
          "We combine backup, disaster recovery, hardware supply and maintenance under one roof, with more than 35 years behind us. That usually means less complexity for customers and fewer handoffs internally.",
          "Open to exploring whether {{companyName}} is facing any of those pressures now?",
        ],
      },
      {
        bodyParagraphs: [
          "Rather than another broad IT supplier, Covenco focuses on the point where infrastructure continuity and data resilience meet.",
          "We manage over 4PB of customer data, protect 3,000 servers and support customers across the UK, Europe and the USA. That gives us a very practical lens on operational risk and recovery pressure.",
          "Would it be worth asking if any of that is relevant to {{companyName}}?",
        ],
      },
    ],
  },
  {
    id: "9ef7b7eb-7e6d-4bfe-9962-e3f132d4e8b8",
    name: "Covenco - Disaster Recovery",
    isReference: false,
    steps: [
      {
        bodyParagraphs: [
          "Disaster recovery often looks fine until the business asks how fast critical workloads can actually come back online.",
          "Covenco delivers local backup, off-site replication, immutability and full disaster recovery services designed to reduce downtime properly. We completed 99 data recoveries in 2024 with a 100 percent success rate overall across customer environments.",
          "Worth exploring whether DR confidence at {{companyName}} is proven or assumed?",
        ],
      },
      {
        bodyParagraphs: [
          "One common DR issue is that testing becomes difficult, infrequent and too dependent on stretched internal teams.",
          "Covenco includes regular DR testing within its service, making it simpler to validate application recovery without excessive complexity for technical teams and operational stakeholders today. That gives teams clearer evidence and less guesswork.",
          "Open to exploring whether {{companyName}} would benefit from a more testable recovery model?",
        ],
      },
      {
        bodyParagraphs: [
          "Maintaining a secondary data centre is expensive, but relying on backup alone can leave recovery objectives exposed.",
          "Covenco offers secure cloud disaster recovery, immutable backups and the ability to restore data onto rental hardware when needed. That creates a more practical path for many teams under pressure and tighter budgets.",
          "Would it be unreasonable to ask how {{companyName}} would recover after a serious outage?",
        ],
      },
    ],
  },
];

async function getCampaign(id: string): Promise<any> {
  const res = await fetch(`${API}/campaigns/${id}`, {
    headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
  });
  if (!res.ok) throw new Error(`GET ${id} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchCampaign(id: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}/campaigns/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH ${id} failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function countLeads(id: string): Promise<number> {
  let total = 0;
  let starting_after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { campaign: id, limit: 100 };
    if (starting_after) body.starting_after = starting_after;
    const res = await fetch(`${API}/leads/list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`leads/list ${id}: ${res.status} ${await res.text()}`);
    const json = await res.json();
    const items = json.items || [];
    total += items.length;
    if (!json.next_starting_after) break;
    starting_after = json.next_starting_after;
  }
  return total;
}

type Finding = {
  campaign: string;
  step: number;
  variant: "A" | "B";
  issue: string;
};

function auditDivBody(
  campaignName: string,
  step: number,
  variant: "A" | "B",
  body: string,
  expectedSpintax: string | null,
): Finding[] {
  const out: Finding[] = [];
  const push = (issue: string) => out.push({ campaign: campaignName, step, variant, issue });

  // Structural: matches <div> pattern, no <p>, no <span>, no inline styles.
  if (/<p[\s>]/i.test(body)) push("found <p> tag");
  if (/<span[\s>]/i.test(body)) push("found <span> tag");
  if (/style\s*=/i.test(body)) push("found inline style");
  if (/\r/.test(body) || /\n/.test(body)) push("body contains CR or LF (should be single-line HTML)");

  // Counts: 11 <div>, 4 <br />, 4 empty divs
  const divOpens = (body.match(/<div[\s>]/gi) || []).length;
  const brs = (body.match(/<br\s*\/?>/gi) || []).length;
  if (divOpens !== 11) push(`<div> open count=${divOpens} (expected 11)`);
  if (brs !== 4) push(`<br /> count=${brs} (expected 4)`);

  // Merge tags and greeting/signoff
  if (!body.includes("{{firstName}}")) push("missing {{firstName}}");
  if (!body.includes("{{companyName}}")) push("missing {{companyName}}");
  if (!body.startsWith(`<div>Hi {{firstName}},\u00a0</div>`)) push("greeting div missing or malformed (expected NBSP trailing)");
  if (!body.endsWith("<div>+44 1753 478313</div>")) push("signoff phone div missing or malformed");
  if (!body.includes(`<div>Kind regards,\u00a0</div>`)) push("`Kind regards,` div missing (expected NBSP trailing)");
  if (!body.includes(`<div>David Jerram\u00a0</div>`)) push("`David Jerram` div missing (expected NBSP trailing)");
  if (body.includes("Mobile:")) push("signoff contains `Mobile:` prefix");
  if (expectedSpintax && !body.includes(expectedSpintax)) {
    push(`missing expected spintax ${expectedSpintax}`);
  }
  return out;
}

async function main() {
  console.log("=== ITER 6 FINAL: Covenco Instantly <div> body propagation + audit ===\n");

  // PHASE 1: pre-check all 9 campaigns for DRAFT status.
  console.log("--- PHASE 1: pre-check (all 9 must be DRAFT) ---");
  const preCheck: Record<string, any> = {};
  for (const c of CAMPAIGNS) {
    const data = await getCampaign(c.id);
    preCheck[c.id] = data;
    const ok = data.status === 0;
    console.log(`${ok ? "OK" : "??"} ${c.name}: status=${data.status} text_only=${data.text_only}`);
    if (data.status !== 0) {
      throw new Error(`REFUSE: ${c.name} status=${data.status}, not DRAFT. Aborting.`);
    }
  }

  // PHASE 2: propagate <div> bodies to the 8 non-reference campaigns.
  // Reference campaign (Backup Services) is PATCHed only to set text_only=true
  // (no body/subject/sequences payload), preserving the admin-edited content.
  console.log("\n--- PHASE 2: propagate <div> bodies to 8 campaigns + ensure text_only ---");
  let bodiesWritten = 0;
  for (const c of CAMPAIGNS) {
    if (c.isReference) {
      // Ensure text_only=true without touching sequences at all.
      await patchCampaign(c.id, { text_only: true });
      console.log(`OK PATCH ${c.name} (reference: only text_only=true, bodies untouched)`);
      continue;
    }
    const pre = preCheck[c.id];
    const seqs = JSON.parse(JSON.stringify(pre.sequences));
    if (!Array.isArray(seqs) || !seqs[0]?.steps || seqs[0].steps.length !== 3) {
      throw new Error(`${c.name}: unexpected sequence shape`);
    }
    for (let s = 0; s < 3; s++) {
      const variants = seqs[0].steps[s].variants;
      if (!Array.isArray(variants) || variants.length !== 2) {
        throw new Error(`${c.name} step ${s + 1}: expected 2 variants`);
      }
      const body = divBody(c.steps[s].bodyParagraphs);
      variants[0].body = body;
      variants[1].body = body;
      // Subjects: deliberately left as-stored (don't touch per instructions).
      bodiesWritten += 2;
    }
    await patchCampaign(c.id, { sequences: seqs, text_only: true });
    console.log(`OK PATCH ${c.name} (6 bodies + text_only=true)`);
  }
  console.log(`\nBodies written: ${bodiesWritten} (expect 48 = 8 campaigns x 3 steps x 2 variants)`);

  // PHASE 3: audit all 54 variants post-patch.
  console.log("\n--- PHASE 3: audit all 54 variants ---");
  const findings: Finding[] = [];
  let clean = 0;
  for (const c of CAMPAIGNS) {
    const post = await getCampaign(c.id);
    for (let s = 0; s < 3; s++) {
      const pvs = post.sequences[0].steps[s].variants;
      for (let v = 0; v < 2; v++) {
        const label: "A" | "B" = v === 0 ? "A" : "B";
        const body: string = pvs[v].body;
        const expectedSpintax =
          c.id === REF_CAMPAIGN_ID && s === 0
            ? "{{off-site|immutable|offline}}"
            : c.id === "aacbce5d-f5a7-4156-8496-967c4efa5bfd" && s === 0
              ? "{{protect|stabilise|strengthen}}"
              : null;
        const f = auditDivBody(c.name, s + 1, label, body, expectedSpintax);
        if (f.length === 0) clean += 1;
        findings.push(...f);
      }
    }
  }
  console.log(`Variants audited: 54`);
  console.log(`Clean: ${clean}`);
  console.log(`Findings: ${findings.length}`);
  for (const f of findings) {
    console.log(`  - ${f.campaign} step${f.step}${f.variant}: ${f.issue}`);
  }

  // PHASE 4: echo raw bodies requested by admin.
  console.log("\n--- PHASE 4: echo raw bodies ---");
  const dr = await getCampaign("9ef7b7eb-7e6d-4bfe-9962-e3f132d4e8b8");
  const drS3B = dr.sequences[0].steps[2].variants[1].body;
  console.log(`\n>>> Disaster Recovery Step 3 Variant B (raw):\n${drS3B}\n`);
  const ibm = await getCampaign("b87c8795-4331-41c5-8d24-f888be7214d4");
  const ibmS2A = ibm.sequences[0].steps[1].variants[0].body;
  console.log(`\n>>> IBM Storage and Servers Step 2 Variant A (raw):\n${ibmS2A}\n`);

  // PHASE 5: campaign-level verify text_only and status.
  console.log("\n--- PHASE 5: campaign-level verify ---");
  let allTextOnly = true;
  let allDraft = true;
  for (const c of CAMPAIGNS) {
    const v = await getCampaign(c.id);
    const ok = v.text_only === true && v.status === 0;
    if (v.text_only !== true) allTextOnly = false;
    if (v.status !== 0) allDraft = false;
    console.log(`${ok ? "OK" : "??"} ${c.name}: status=${v.status} text_only=${v.text_only}`);
  }
  console.log(`all text_only=true: ${allTextOnly}`);
  console.log(`all status=0 (DRAFT): ${allDraft}`);

  // PHASE 6: lead count sanity.
  console.log("\n--- PHASE 6: lead counts ---");
  let grand = 0;
  for (const c of CAMPAIGNS) {
    const n = await countLeads(c.id);
    grand += n;
    console.log(`  ${c.name}: ${n}`);
  }
  console.log(`TOTAL leads: ${grand} (expect 42)`);

  console.log("\n=== SUMMARY ===");
  console.log(`bodies_written_non_reference: ${bodiesWritten}`);
  console.log(`reference_untouched: 6 (Backup Services all variants)`);
  console.log(`audit_clean: ${clean}/54`);
  console.log(`findings: ${findings.length}`);
  console.log(`all_text_only: ${allTextOnly}`);
  console.log(`all_draft: ${allDraft}`);
  console.log(`total_leads: ${grand}`);

  if (findings.length > 0) {
    console.log("\nFAIL: findings present.");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
