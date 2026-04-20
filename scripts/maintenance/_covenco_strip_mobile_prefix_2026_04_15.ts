/**
 * Covenco Instantly — strip 'Mobile: ' prefix from signoff block.
 *
 * 2026-04-15: David's number +44 1753 478313 is a Slough landline, not a
 * mobile. Remove the 4-char 'Mobile: ' prefix from the signoff on all 54
 * variant bodies. Everything else preserved verbatim.
 *
 * Reuses body definitions and toHtml() logic from _covenco_instantly_html_repush.ts.
 * Only change: each body has "Mobile: " stripped before HTML conversion.
 *
 * Scope: 9 campaigns × 3 steps × 2 variants = 54 variant bodies.
 * Subjects untouched. Campaigns remain DRAFT (status 0). Lead queue untouched.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";

type StepBodies = { s1: string; s2: string; s3: string };
type Campaign = { id: string; name: string; bodies: StepBodies };

function toHtml(text: string): string {
  return text
    .split("\n\n")
    .map((para) => {
      const inner = para.split("\n").join("<br>");
      return `<p>${inner}</p>`;
    })
    .join("");
}

function stripMobile(text: string): string {
  return text.replace(/Mobile: \+44 1753 478313/g, "+44 1753 478313");
}

const CAMPAIGNS: Campaign[] = [
  {
    id: "578c27a2-717c-4ef2-b6d8-031b07261f4d",
    name: "Covenco - Backup Services",
    bodies: {
      s1: `Hi {{firstName}},

Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {{off-site|immutable|offline}} backup services built for secure recovery, not box-ticking.

With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.

Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

Backup problems rarely start with failure, they start with silent drift, missed checks and limited confidence when recovery is needed fast.

Covenco runs 326 daily backup jobs and supports planning, monitoring, management and recovery as one service for customers across complex estates. That gives teams more control without more admin.

Open to exploring whether {{companyName}} would benefit from a more hands-on backup approach?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

When budgets are tight, backup usually gets judged on cost, right until a restore takes too long or data cannot be recovered cleanly.

Covenco combines immutable backup, private cloud recovery and day-to-day oversight in one managed service for leaner internal teams. As a Veeam Platinum provider, we keep things practical.

Would it be unreasonable to ask how confident you feel in recovery today?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "aacbce5d-f5a7-4156-8496-967c4efa5bfd",
    name: "Covenco - Data Resiliency and Recovery",
    bodies: {
      s1: `Hi {{firstName}},

Resilience pressure usually shows up when data growth, cyber risk and recovery expectations keep rising at the same time.

Covenco helps organisations {{protect|stabilise|strengthen}} critical data with off-site backup, immutability, replication and recovery support across mixed environments. We manage over 4PB of customer data and protect 3,000 servers today.

Worth exploring whether data resilience at {{companyName}} is where leadership expects it to be?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

Many firms have backup in place, but still lack confidence around recoverability, testing and what happens when systems fail under pressure.

Covenco supports the full cycle, from planning and monitoring through to recovery and ongoing management. That helps reduce risk without creating more overhead internally or more tooling.

Open to exploring whether {{companyName}} has any resilience gaps that are easy to miss day to day?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

Resilience tends to get harder when teams are stretched, infrastructure is mixed, and recovery requirements are rising faster than budgets.

Covenco combines data protection, disaster recovery and infrastructure support under one roof, backed by ISO 27001, 9001 and 14001 certifications. That gives teams one specialist partner instead of several disconnected providers and fragmented support models.

Worth a conversation about whether that model could help {{companyName}}?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "d5c16e36-f3cf-4aef-af79-af23e302ca6e",
    name: "Covenco - IT Insights",
    bodies: {
      s1: `Hi {{firstName}},

Many IT leaders are being pushed to improve resilience, control spend and plan infrastructure changes all at once.

Covenco works across backup, recovery, support and hardware, so we see where those pressures tend to collide. After 35 years in the market, the patterns are usually clear quite quickly.

Worth a short exchange on what seems to be creating the most pressure at {{companyName}}?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

One common issue we see is teams treating backup, infrastructure and support as separate decisions, then discovering the real risk sits between them.

Covenco helps connect those areas through data management and IT infrastructure services shaped around operational reality. That tends to surface options earlier and reduce avoidable blind spots.

Open to exploring whether {{companyName}} is seeing the same kind of overlap right now?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

The more complex the estate, the easier it is for lead times, support gaps or recovery assumptions to create risk quietly in the background.

Covenco supports customers across the UK, Europe and the USA with specialist infrastructure and data resilience services. Sometimes an outside view helps, especially when priorities are moving quickly.

Would it be unreasonable to compare notes on where {{companyName}} may be exposed?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "2bbb4ff1-eaed-4946-a62e-38d9cc24453e",
    name: "Covenco - IT Infrastructure",
    bodies: {
      s1: `Hi {{firstName}},

Infrastructure pressure tends to build when systems are ageing, parts are hard to source and projects are slowed by long lead times.

Covenco supplies and supports enterprise and midrange hardware with global sourcing, rapid shipping and practical engineering input. We stock over 40,000 items across major brands and generations.

Worth exploring whether {{companyName}} is feeling any of that procurement or support pressure now?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

Many internal teams lose time chasing parts, extending ageing kit and juggling vendors when infrastructure support starts to fray.

Covenco helps simplify that with supply, repair, refurbishment and lifecycle services across server, storage and networking estates. That can reduce downtime and planning headaches quickly, especially where long lead times are already hurting projects.

Open to exploring whether {{companyName}} could use a steadier infrastructure partner?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

Replacing everything is rarely realistic when budgets are tight and critical systems still need to perform.

Covenco helps organisations keep infrastructure productive through same-day shipping, flexible sourcing and specialist support, whether the priority is continuity, speed or cost control. That gives teams more breathing room during difficult planning cycles.

Would it be worth asking where infrastructure strain is starting to show at {{companyName}}?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "d6dce1e9-bebc-4537-aec7-17cbae52af10",
    name: "Covenco - Ransomware Recovery",
    bodies: {
      s1: `Hi {{firstName}},

Ransomware risk is not only about prevention, it is about how quickly operations can recover when something gets through.

Covenco provides ransomware recovery support with virtual and physical response, designed to reduce downtime and protect data integrity for affected businesses under pressure. Customers on our service average 48-hour recovery times.

Worth exploring whether recovery readiness at {{companyName}} feels proven or mostly assumed today?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

Many firms have incident plans, but recovery can still stall when clean data, infrastructure and hands-on expertise are not lined up properly.

Covenco combines cloud-based recovery with physical infrastructure to support restoration when criminals strike. That helps ease pressure on internal teams at the worst moment and shorten disruption significantly.

Open to exploring whether {{companyName}} would benefit from a stronger ransomware recovery plan?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

The real cost of ransomware usually comes after the attack, when downtime stretches, legal pressure rises and internal teams are pulled in every direction.

Covenco offers round-the-clock recovery assistance and handled 8 ransomware recoveries in 2024 for contracted customers across multiple environments. We focus on getting businesses operational again, fast.

Would it be unreasonable to ask how {{companyName}} would manage that scenario today?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "ebb2e715-8505-4944-88aa-fa2f326ce166",
    name: "Covenco - Managed Services",
    bodies: {
      s1: `Hi {{firstName}},

Many IT teams are carrying too much operational load across patching, monitoring, uptime checks and issue resolution.

Covenco provides managed monitoring and maintenance services that help spot faults early, protect availability and reduce support strain across critical environments every day, without adding complexity. Our approach is built around practical continuity, not ticket volume.

Worth exploring whether {{companyName}} could use more breathing room across day-to-day operations?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

Support becomes expensive when internal teams are dragged into repeat issues, patching gaps and avoidable outages.

Covenco offers managed services covering fault detection, network monitoring, uptime tracking and performance optimisation, all designed to reduce operational friction across busy estates and mixed systems. We also help cut support costs by up to 20 percent.

Open to exploring whether that would be useful at {{companyName}}?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

A lot of managed services sound similar until something critical fails and response depth gets tested properly.

Covenco combines monitoring, maintenance, backup and infrastructure expertise under one roof, with 24/7 support and token-based specialist services when needed. That gives teams more flexibility than a generic provider during pressured periods and resource gaps.

Would it be worth asking whether {{companyName}} needs that kind of coverage?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "b87c8795-4331-41c5-8d24-f888be7214d4",
    name: "Covenco - IBM Storage and Servers",
    bodies: {
      s1: `Hi {{firstName}},

Many IBM teams are now weighing Power11 against the cost and risk of holding older estates together for another cycle.

The challenge is rarely hardware alone, it is continuity, supportability and whether the platform still aligns with resilience and hybrid plans. Covenco helps organisations navigate IBM estate decisions with supply, support and practical lifecycle input.

Worth exploring whether {{companyName}} is reviewing any IBM Power11 decisions currently?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

Power11 is getting attention because continuity expectations have changed, especially where maintenance windows, cyber resilience and operational overhead are under scrutiny.

For many teams, the real issue is how to modernise IBM estates without forcing disruption or rushed change. Covenco supports IBM environments with sourcing, maintenance and infrastructure guidance across live estates.

Open to exploring whether {{companyName}} is under any pressure around IBM refresh timing?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

If IBM systems still support critical workloads, delaying estate decisions can quietly increase support pressure, recovery risk and commercial drag.

Power11 has changed the conversation for teams looking at availability, hybrid flexibility and longer-term platform fit. Covenco helps organisations assess the practical route forward across IBM environments, from ongoing support through to newer platform options.

Would it be unreasonable to ask whether IBM Power11 is on {{companyName}}'s roadmap?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "f439a04c-e213-4dbd-bf0e-2f2463bf6b75",
    name: "Covenco - Discover Covenco",
    bodies: {
      s1: `Hi {{firstName}},

Many organisations reach a point where backup, recovery and infrastructure support are handled separately, and the gaps start showing.

Covenco brings those areas together through data management, IT infrastructure supply and managed services designed around resilience and continuity across critical estates. We have supported customers since 1989 and hold ISO 27001, 9001 and 14001 certifications.

Worth exploring whether that model could help {{companyName}}?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

Covenco tends to be useful when teams are dealing with ageing infrastructure, rising recovery expectations or support that feels too fragmented.

We combine backup, disaster recovery, hardware supply and maintenance under one roof, with more than 35 years behind us. That usually means less complexity for customers and fewer handoffs internally.

Open to exploring whether {{companyName}} is facing any of those pressures now?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

Rather than another broad IT supplier, Covenco focuses on the point where infrastructure continuity and data resilience meet.

We manage over 4PB of customer data, protect 3,000 servers and support customers across the UK, Europe and the USA. That gives us a very practical lens on operational risk and recovery pressure.

Would it be worth asking if any of that is relevant to {{companyName}}?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
  },
  {
    id: "9ef7b7eb-7e6d-4bfe-9962-e3f132d4e8b8",
    name: "Covenco - Disaster Recovery",
    bodies: {
      s1: `Hi {{firstName}},

Disaster recovery often looks fine until the business asks how fast critical workloads can actually come back online.

Covenco delivers local backup, off-site replication, immutability and full disaster recovery services designed to reduce downtime properly. We completed 99 data recoveries in 2024 with a 100 percent success rate overall across customer environments.

Worth exploring whether DR confidence at {{companyName}} is proven or assumed?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s2: `Hi {{firstName}},

One common DR issue is that testing becomes difficult, infrequent and too dependent on stretched internal teams.

Covenco includes regular DR testing within its service, making it simpler to validate application recovery without excessive complexity for technical teams and operational stakeholders today. That gives teams clearer evidence and less guesswork.

Open to exploring whether {{companyName}} would benefit from a more testable recovery model?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
      s3: `Hi {{firstName}},

Maintaining a secondary data centre is expensive, but relying on backup alone can leave recovery objectives exposed.

Covenco offers secure cloud disaster recovery, immutable backups and the ability to restore data onto rental hardware when needed. That creates a more practical path for many teams under pressure and tighter budgets.

Would it be unreasonable to ask how {{companyName}} would recover after a serious outage?

Kind regards,
David Jerram
Mobile: +44 1753 478313`,
    },
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

async function updateOne(c: Campaign): Promise<number> {
  const current = await getCampaign(c.id);
  const status = current.status;
  if (status !== 0) {
    throw new Error(
      `REFUSING to update ${c.name} (${c.id}): status is ${status}, expected 0 (DRAFT)`,
    );
  }
  const seqs = JSON.parse(JSON.stringify(current.sequences));
  if (!Array.isArray(seqs) || !seqs[0]?.steps || seqs[0].steps.length !== 3) {
    throw new Error(`${c.name}: unexpected sequence shape`);
  }
  const htmlBodies = [
    toHtml(stripMobile(c.bodies.s1)),
    toHtml(stripMobile(c.bodies.s2)),
    toHtml(stripMobile(c.bodies.s3)),
  ];
  let bodyWrites = 0;
  for (let i = 0; i < 3; i++) {
    const variants = seqs[0].steps[i].variants;
    if (!Array.isArray(variants) || variants.length !== 2) {
      throw new Error(`${c.name} step ${i + 1}: expected 2 variants, got ${variants?.length}`);
    }
    variants[0].body = htmlBodies[i];
    variants[1].body = htmlBodies[i];
    bodyWrites += 2;
  }
  await patchCampaign(c.id, { sequences: seqs, text_only: false });
  return bodyWrites;
}

async function main() {
  let totalWrites = 0;
  const failures: Array<{ name: string; err: string }> = [];
  for (const c of CAMPAIGNS) {
    try {
      const n = await updateOne(c);
      console.log(`OK ${c.name}: ${n} variant bodies updated`);
      totalWrites += n;
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`FAIL ${c.name}: ${msg}`);
      failures.push({ name: c.name, err: msg });
    }
  }
  console.log(`\nTOTAL body updates: ${totalWrites}`);
  console.log(`Failures: ${failures.length}`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f.name}: ${f.err}`);
  }

  console.log("\n--- VERIFY: Backup Services Step 1 Variant A ---");
  const verify = await getCampaign("578c27a2-717c-4ef2-b6d8-031b07261f4d");
  console.log("status:", verify.status, "text_only:", verify.text_only);
  console.log("Step 1 V A subject:", JSON.stringify(verify.sequences[0].steps[0].variants[0].subject));
  console.log("Step 1 V A body (raw stored):");
  console.log(verify.sequences[0].steps[0].variants[0].body);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
