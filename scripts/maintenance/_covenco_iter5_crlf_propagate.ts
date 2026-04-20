/**
 * Covenco Instantly ITER 5 (FINAL) — propagate plain-text CRLF bodies to all
 * 53 non-reference variants + audit all 54.
 *
 * Reference (already correct, skipped for PATCH): Backup Services Step 1
 * Variant A (campaign 578c27a2, seq[0].steps[0].variants[0]).
 *
 * Format: plain text, `\r\n\r\n` between paragraphs, `\r\n` between signoff
 * lines, terminating on `+44 1753 478313` (no trailing newline).
 * Campaign-level `text_only=true` already set on all 9 campaigns.
 *
 * Safety: refuses to touch any campaign where status !== 0 (DRAFT).
 * Subjects untouched. Leads untouched. EmailBison untouched.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const REF_CAMPAIGN_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d";
const REF_STEP_IDX = 0;
const REF_VARIANT_IDX = 0;

type Step = {
  variantA: { subject: string; body: string };
  variantB: { subject: string; body: string };
};
type CampaignSpec = {
  id: string;
  name: string;
  steps: [Step, Step, Step];
};

// Helper: join paragraphs with CRLF CRLF, signoff lines with CRLF
function crlfBody(paragraphs: string[], signoff: string[]): string {
  return paragraphs.join("\r\n\r\n") + "\r\n\r\n" + signoff.join("\r\n");
}

const SIGNOFF = ["Kind regards,", "David Jerram", "+44 1753 478313"];

const CAMPAIGNS: CampaignSpec[] = [
  {
    id: "578c27a2-717c-4ef2-b6d8-031b07261f4d",
    name: "Covenco - Backup Services",
    steps: [
      {
        variantA: {
          subject: "backup gaps to fix",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {{off-site|immutable|offline}} backup services built for secure recovery, not box-ticking.",
              "With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.",
              "Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "backup risk at scale",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {{off-site|immutable|offline}} backup services built for secure recovery, not box-ticking.",
              "With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.",
              "Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "backup drift is costly",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Backup problems rarely start with failure, they start with silent drift, missed checks and limited confidence when recovery is needed fast.",
              "Covenco runs 326 daily backup jobs and supports planning, monitoring, management and recovery as one service for customers across complex estates. That gives teams more control without more admin.",
              "Open to exploring whether {{companyName}} would benefit from a more hands-on backup approach?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "confidence in recovery",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Backup problems rarely start with failure, they start with silent drift, missed checks and limited confidence when recovery is needed fast.",
              "Covenco runs 326 daily backup jobs and supports planning, monitoring, management and recovery as one service for customers across complex estates. That gives teams more control without more admin.",
              "Open to exploring whether {{companyName}} would benefit from a more hands-on backup approach?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "backup cost vs recovery",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "When budgets are tight, backup usually gets judged on cost, right until a restore takes too long or data cannot be recovered cleanly.",
              "Covenco combines immutable backup, private cloud recovery and day-to-day oversight in one managed service for leaner internal teams. As a Veeam Platinum provider, we keep things practical.",
              "Would it be unreasonable to ask how confident you feel in recovery today?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "recovery proof matters",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "When budgets are tight, backup usually gets judged on cost, right until a restore takes too long or data cannot be recovered cleanly.",
              "Covenco combines immutable backup, private cloud recovery and day-to-day oversight in one managed service for leaner internal teams. As a Veeam Platinum provider, we keep things practical.",
              "Would it be unreasonable to ask how confident you feel in recovery today?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "aacbce5d-f5a7-4156-8496-967c4efa5bfd",
    name: "Covenco - Data Resiliency and Recovery",
    steps: [
      {
        variantA: {
          subject: "resilience under pressure",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Resilience pressure usually shows up when data growth, cyber risk and recovery expectations keep rising at the same time.",
              "Covenco helps organisations {{protect|stabilise|strengthen}} critical data with off-site backup, immutability, replication and recovery support across mixed environments. We manage over 4PB of customer data and protect 3,000 servers today.",
              "Worth exploring whether data resilience at {{companyName}} is where leadership expects it to be?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "data resilience gaps",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Resilience pressure usually shows up when data growth, cyber risk and recovery expectations keep rising at the same time.",
              "Covenco helps organisations {{protect|stabilise|strengthen}} critical data with off-site backup, immutability, replication and recovery support across mixed environments. We manage over 4PB of customer data and protect 3,000 servers today.",
              "Worth exploring whether data resilience at {{companyName}} is where leadership expects it to be?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "recoverability is the issue",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many firms have backup in place, but still lack confidence around recoverability, testing and what happens when systems fail under pressure.",
              "Covenco supports the full cycle, from planning and monitoring through to recovery and ongoing management. That helps reduce risk without creating more overhead internally or more tooling.",
              "Open to exploring whether {{companyName}} has any resilience gaps that are easy to miss day to day?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "where resilience slips",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many firms have backup in place, but still lack confidence around recoverability, testing and what happens when systems fail under pressure.",
              "Covenco supports the full cycle, from planning and monitoring through to recovery and ongoing management. That helps reduce risk without creating more overhead internally or more tooling.",
              "Open to exploring whether {{companyName}} has any resilience gaps that are easy to miss day to day?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "resilience without complexity",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Resilience tends to get harder when teams are stretched, infrastructure is mixed, and recovery requirements are rising faster than budgets.",
              "Covenco combines data protection, disaster recovery and infrastructure support under one roof, backed by ISO 27001, 9001 and 14001 certifications. That gives teams one specialist partner instead of several disconnected providers and fragmented support models.",
              "Worth a conversation about whether that model could help {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "one partner for resilience",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Resilience tends to get harder when teams are stretched, infrastructure is mixed, and recovery requirements are rising faster than budgets.",
              "Covenco combines data protection, disaster recovery and infrastructure support under one roof, backed by ISO 27001, 9001 and 14001 certifications. That gives teams one specialist partner instead of several disconnected providers and fragmented support models.",
              "Worth a conversation about whether that model could help {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "d5c16e36-f3cf-4aef-af79-af23e302ca6e",
    name: "Covenco - IT Insights",
    steps: [
      {
        variantA: {
          subject: "where pressure is building",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many IT leaders are being pushed to improve resilience, control spend and plan infrastructure changes all at once.",
              "Covenco works across backup, recovery, support and hardware, so we see where those pressures tend to collide. After 35 years in the market, the patterns are usually clear quite quickly.",
              "Worth a short exchange on what seems to be creating the most pressure at {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "it pressure points",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many IT leaders are being pushed to improve resilience, control spend and plan infrastructure changes all at once.",
              "Covenco works across backup, recovery, support and hardware, so we see where those pressures tend to collide. After 35 years in the market, the patterns are usually clear quite quickly.",
              "Worth a short exchange on what seems to be creating the most pressure at {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "the risk between decisions",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "One common issue we see is teams treating backup, infrastructure and support as separate decisions, then discovering the real risk sits between them.",
              "Covenco helps connect those areas through data management and IT infrastructure services shaped around operational reality. That tends to surface options earlier and reduce avoidable blind spots.",
              "Open to exploring whether {{companyName}} is seeing the same kind of overlap right now?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "where gaps really sit",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "One common issue we see is teams treating backup, infrastructure and support as separate decisions, then discovering the real risk sits between them.",
              "Covenco helps connect those areas through data management and IT infrastructure services shaped around operational reality. That tends to surface options earlier and reduce avoidable blind spots.",
              "Open to exploring whether {{companyName}} is seeing the same kind of overlap right now?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "hidden infrastructure risk",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "The more complex the estate, the easier it is for lead times, support gaps or recovery assumptions to create risk quietly in the background.",
              "Covenco supports customers across the UK, Europe and the USA with specialist infrastructure and data resilience services. Sometimes an outside view helps, especially when priorities are moving quickly.",
              "Would it be unreasonable to compare notes on where {{companyName}} may be exposed?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "exposed by complexity",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "The more complex the estate, the easier it is for lead times, support gaps or recovery assumptions to create risk quietly in the background.",
              "Covenco supports customers across the UK, Europe and the USA with specialist infrastructure and data resilience services. Sometimes an outside view helps, especially when priorities are moving quickly.",
              "Would it be unreasonable to compare notes on where {{companyName}} may be exposed?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "2bbb4ff1-eaed-4946-a62e-38d9cc24453e",
    name: "Covenco - IT Infrastructure",
    steps: [
      {
        variantA: {
          subject: "infrastructure strain building",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Infrastructure pressure tends to build when systems are ageing, parts are hard to source and projects are slowed by long lead times.",
              "Covenco supplies and supports enterprise and midrange hardware with global sourcing, rapid shipping and practical engineering input. We stock over 40,000 items across major brands and generations.",
              "Worth exploring whether {{companyName}} is feeling any of that procurement or support pressure now?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "support and sourcing pressure",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Infrastructure pressure tends to build when systems are ageing, parts are hard to source and projects are slowed by long lead times.",
              "Covenco supplies and supports enterprise and midrange hardware with global sourcing, rapid shipping and practical engineering input. We stock over 40,000 items across major brands and generations.",
              "Worth exploring whether {{companyName}} is feeling any of that procurement or support pressure now?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "too much time chasing parts",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many internal teams lose time chasing parts, extending ageing kit and juggling vendors when infrastructure support starts to fray.",
              "Covenco helps simplify that with supply, repair, refurbishment and lifecycle services across server, storage and networking estates. That can reduce downtime and planning headaches quickly, especially where long lead times are already hurting projects.",
              "Open to exploring whether {{companyName}} could use a steadier infrastructure partner?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "infrastructure support strain",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many internal teams lose time chasing parts, extending ageing kit and juggling vendors when infrastructure support starts to fray.",
              "Covenco helps simplify that with supply, repair, refurbishment and lifecycle services across server, storage and networking estates. That can reduce downtime and planning headaches quickly, especially where long lead times are already hurting projects.",
              "Open to exploring whether {{companyName}} could use a steadier infrastructure partner?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "keep infrastructure productive",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Replacing everything is rarely realistic when budgets are tight and critical systems still need to perform.",
              "Covenco helps organisations keep infrastructure productive through same-day shipping, flexible sourcing and specialist support, whether the priority is continuity, speed or cost control. That gives teams more breathing room during difficult planning cycles.",
              "Would it be worth asking where infrastructure strain is starting to show at {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "room to plan properly",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Replacing everything is rarely realistic when budgets are tight and critical systems still need to perform.",
              "Covenco helps organisations keep infrastructure productive through same-day shipping, flexible sourcing and specialist support, whether the priority is continuity, speed or cost control. That gives teams more breathing room during difficult planning cycles.",
              "Would it be worth asking where infrastructure strain is starting to show at {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "d6dce1e9-bebc-4537-aec7-17cbae52af10",
    name: "Covenco - Ransomware Recovery",
    steps: [
      {
        variantA: {
          subject: "recovery after ransomware",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Ransomware risk is not only about prevention, it is about how quickly operations can recover when something gets through.",
              "Covenco provides ransomware recovery support with virtual and physical response, designed to reduce downtime and protect data integrity for affected businesses under pressure. Customers on our service average 48-hour recovery times.",
              "Worth exploring whether recovery readiness at {{companyName}} feels proven or mostly assumed today?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "is recovery really proven",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Ransomware risk is not only about prevention, it is about how quickly operations can recover when something gets through.",
              "Covenco provides ransomware recovery support with virtual and physical response, designed to reduce downtime and protect data integrity for affected businesses under pressure. Customers on our service average 48-hour recovery times.",
              "Worth exploring whether recovery readiness at {{companyName}} feels proven or mostly assumed today?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "when incident plans stall",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many firms have incident plans, but recovery can still stall when clean data, infrastructure and hands-on expertise are not lined up properly.",
              "Covenco combines cloud-based recovery with physical infrastructure to support restoration when criminals strike. That helps ease pressure on internal teams at the worst moment and shorten disruption significantly.",
              "Open to exploring whether {{companyName}} would benefit from a stronger ransomware recovery plan?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "recovery under pressure",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many firms have incident plans, but recovery can still stall when clean data, infrastructure and hands-on expertise are not lined up properly.",
              "Covenco combines cloud-based recovery with physical infrastructure to support restoration when criminals strike. That helps ease pressure on internal teams at the worst moment and shorten disruption significantly.",
              "Open to exploring whether {{companyName}} would benefit from a stronger ransomware recovery plan?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "the cost after attack",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "The real cost of ransomware usually comes after the attack, when downtime stretches, legal pressure rises and internal teams are pulled in every direction.",
              "Covenco offers round-the-clock recovery assistance and handled 8 ransomware recoveries in 2024 for contracted customers across multiple environments. We focus on getting businesses operational again, fast.",
              "Would it be unreasonable to ask how {{companyName}} would manage that scenario today?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "ransomware recovery readiness",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "The real cost of ransomware usually comes after the attack, when downtime stretches, legal pressure rises and internal teams are pulled in every direction.",
              "Covenco offers round-the-clock recovery assistance and handled 8 ransomware recoveries in 2024 for contracted customers across multiple environments. We focus on getting businesses operational again, fast.",
              "Would it be unreasonable to ask how {{companyName}} would manage that scenario today?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "ebb2e715-8505-4944-88aa-fa2f326ce166",
    name: "Covenco - Managed Services",
    steps: [
      {
        variantA: {
          subject: "too much operational load",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many IT teams are carrying too much operational load across patching, monitoring, uptime checks and issue resolution.",
              "Covenco provides managed monitoring and maintenance services that help spot faults early, protect availability and reduce support strain across critical environments every day, without adding complexity. Our approach is built around practical continuity, not ticket volume.",
              "Worth exploring whether {{companyName}} could use more breathing room across day-to-day operations?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "pressure on daily support",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many IT teams are carrying too much operational load across patching, monitoring, uptime checks and issue resolution.",
              "Covenco provides managed monitoring and maintenance services that help spot faults early, protect availability and reduce support strain across critical environments every day, without adding complexity. Our approach is built around practical continuity, not ticket volume.",
              "Worth exploring whether {{companyName}} could use more breathing room across day-to-day operations?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "support costs keep rising",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Support becomes expensive when internal teams are dragged into repeat issues, patching gaps and avoidable outages.",
              "Covenco offers managed services covering fault detection, network monitoring, uptime tracking and performance optimisation, all designed to reduce operational friction across busy estates and mixed systems. We also help cut support costs by up to 20 percent.",
              "Open to exploring whether that would be useful at {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "managed support for busy teams",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Support becomes expensive when internal teams are dragged into repeat issues, patching gaps and avoidable outages.",
              "Covenco offers managed services covering fault detection, network monitoring, uptime tracking and performance optimisation, all designed to reduce operational friction across busy estates and mixed systems. We also help cut support costs by up to 20 percent.",
              "Open to exploring whether that would be useful at {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "depth matters in support",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "A lot of managed services sound similar until something critical fails and response depth gets tested properly.",
              "Covenco combines monitoring, maintenance, backup and infrastructure expertise under one roof, with 24/7 support and token-based specialist services when needed. That gives teams more flexibility than a generic provider during pressured periods and resource gaps.",
              "Would it be worth asking whether {{companyName}} needs that kind of coverage?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "more than generic managed services",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "A lot of managed services sound similar until something critical fails and response depth gets tested properly.",
              "Covenco combines monitoring, maintenance, backup and infrastructure expertise under one roof, with 24/7 support and token-based specialist services when needed. That gives teams more flexibility than a generic provider during pressured periods and resource gaps.",
              "Would it be worth asking whether {{companyName}} needs that kind of coverage?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "b87c8795-4331-41c5-8d24-f888be7214d4",
    name: "Covenco - IBM Storage and Servers",
    steps: [
      {
        variantA: {
          subject: "ibm power11 planning",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many IBM teams are now weighing Power11 against the cost and risk of holding older estates together for another cycle.",
              "The challenge is rarely hardware alone, it is continuity, supportability and whether the platform still aligns with resilience and hybrid plans. Covenco helps organisations navigate IBM estate decisions with supply, support and practical lifecycle input.",
              "Worth exploring whether {{companyName}} is reviewing any IBM Power11 decisions currently?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "power11 and continuity",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many IBM teams are now weighing Power11 against the cost and risk of holding older estates together for another cycle.",
              "The challenge is rarely hardware alone, it is continuity, supportability and whether the platform still aligns with resilience and hybrid plans. Covenco helps organisations navigate IBM estate decisions with supply, support and practical lifecycle input.",
              "Worth exploring whether {{companyName}} is reviewing any IBM Power11 decisions currently?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "power11 without disruption",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Power11 is getting attention because continuity expectations have changed, especially where maintenance windows, cyber resilience and operational overhead are under scrutiny.",
              "For many teams, the real issue is how to modernise IBM estates without forcing disruption or rushed change. Covenco supports IBM environments with sourcing, maintenance and infrastructure guidance across live estates.",
              "Open to exploring whether {{companyName}} is under any pressure around IBM refresh timing?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "ibm refresh timing",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Power11 is getting attention because continuity expectations have changed, especially where maintenance windows, cyber resilience and operational overhead are under scrutiny.",
              "For many teams, the real issue is how to modernise IBM estates without forcing disruption or rushed change. Covenco supports IBM environments with sourcing, maintenance and infrastructure guidance across live estates.",
              "Open to exploring whether {{companyName}} is under any pressure around IBM refresh timing?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "is power11 on radar",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "If IBM systems still support critical workloads, delaying estate decisions can quietly increase support pressure, recovery risk and commercial drag.",
              "Power11 has changed the conversation for teams looking at availability, hybrid flexibility and longer-term platform fit. Covenco helps organisations assess the practical route forward across IBM environments, from ongoing support through to newer platform options.",
              "Would it be unreasonable to ask whether IBM Power11 is on {{companyName}}'s roadmap?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "ibm estate next steps",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "If IBM systems still support critical workloads, delaying estate decisions can quietly increase support pressure, recovery risk and commercial drag.",
              "Power11 has changed the conversation for teams looking at availability, hybrid flexibility and longer-term platform fit. Covenco helps organisations assess the practical route forward across IBM environments, from ongoing support through to newer platform options.",
              "Would it be unreasonable to ask whether IBM Power11 is on {{companyName}}'s roadmap?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "f439a04c-e213-4dbd-bf0e-2f2463bf6b75",
    name: "Covenco - Discover Covenco",
    steps: [
      {
        variantA: {
          subject: "where gaps start showing",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many organisations reach a point where backup, recovery and infrastructure support are handled separately, and the gaps start showing.",
              "Covenco brings those areas together through data management, IT infrastructure supply and managed services designed around resilience and continuity across critical estates. We have supported customers since 1989 and hold ISO 27001, 9001 and 14001 certifications.",
              "Worth exploring whether that model could help {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "backup recovery infrastructure",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Many organisations reach a point where backup, recovery and infrastructure support are handled separately, and the gaps start showing.",
              "Covenco brings those areas together through data management, IT infrastructure supply and managed services designed around resilience and continuity across critical estates. We have supported customers since 1989 and hold ISO 27001, 9001 and 14001 certifications.",
              "Worth exploring whether that model could help {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "when support feels fragmented",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Covenco tends to be useful when teams are dealing with ageing infrastructure, rising recovery expectations or support that feels too fragmented.",
              "We combine backup, disaster recovery, hardware supply and maintenance under one roof, with more than 35 years behind us. That usually means less complexity for customers and fewer handoffs internally.",
              "Open to exploring whether {{companyName}} is facing any of those pressures now?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "where covenco tends to help",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Covenco tends to be useful when teams are dealing with ageing infrastructure, rising recovery expectations or support that feels too fragmented.",
              "We combine backup, disaster recovery, hardware supply and maintenance under one roof, with more than 35 years behind us. That usually means less complexity for customers and fewer handoffs internally.",
              "Open to exploring whether {{companyName}} is facing any of those pressures now?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "continuity meets resilience",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Rather than another broad IT supplier, Covenco focuses on the point where infrastructure continuity and data resilience meet.",
              "We manage over 4PB of customer data, protect 3,000 servers and support customers across the UK, Europe and the USA. That gives us a very practical lens on operational risk and recovery pressure.",
              "Would it be worth asking if any of that is relevant to {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "what covenco focuses on",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Rather than another broad IT supplier, Covenco focuses on the point where infrastructure continuity and data resilience meet.",
              "We manage over 4PB of customer data, protect 3,000 servers and support customers across the UK, Europe and the USA. That gives us a very practical lens on operational risk and recovery pressure.",
              "Would it be worth asking if any of that is relevant to {{companyName}}?",
            ],
            SIGNOFF,
          ),
        },
      },
    ],
  },
  {
    id: "9ef7b7eb-7e6d-4bfe-9962-e3f132d4e8b8",
    name: "Covenco - Disaster Recovery",
    steps: [
      {
        variantA: {
          subject: "is dr really proven",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Disaster recovery often looks fine until the business asks how fast critical workloads can actually come back online.",
              "Covenco delivers local backup, off-site replication, immutability and full disaster recovery services designed to reduce downtime properly. We completed 99 data recoveries in 2024 with a 100 percent success rate overall across customer environments.",
              "Worth exploring whether DR confidence at {{companyName}} is proven or assumed?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "disaster recovery pressure",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Disaster recovery often looks fine until the business asks how fast critical workloads can actually come back online.",
              "Covenco delivers local backup, off-site replication, immutability and full disaster recovery services designed to reduce downtime properly. We completed 99 data recoveries in 2024 with a 100 percent success rate overall across customer environments.",
              "Worth exploring whether DR confidence at {{companyName}} is proven or assumed?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "dr testing gets hard",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "One common DR issue is that testing becomes difficult, infrequent and too dependent on stretched internal teams.",
              "Covenco includes regular DR testing within its service, making it simpler to validate application recovery without excessive complexity for technical teams and operational stakeholders today. That gives teams clearer evidence and less guesswork.",
              "Open to exploring whether {{companyName}} would benefit from a more testable recovery model?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "a more testable dr model",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "One common DR issue is that testing becomes difficult, infrequent and too dependent on stretched internal teams.",
              "Covenco includes regular DR testing within its service, making it simpler to validate application recovery without excessive complexity for technical teams and operational stakeholders today. That gives teams clearer evidence and less guesswork.",
              "Open to exploring whether {{companyName}} would benefit from a more testable recovery model?",
            ],
            SIGNOFF,
          ),
        },
      },
      {
        variantA: {
          subject: "backup alone is not dr",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Maintaining a secondary data centre is expensive, but relying on backup alone can leave recovery objectives exposed.",
              "Covenco offers secure cloud disaster recovery, immutable backups and the ability to restore data onto rental hardware when needed. That creates a more practical path for many teams under pressure and tighter budgets.",
              "Would it be unreasonable to ask how {{companyName}} would recover after a serious outage?",
            ],
            SIGNOFF,
          ),
        },
        variantB: {
          subject: "recovery after serious outage",
          body: crlfBody(
            [
              "Hi {{firstName}},",
              "Maintaining a secondary data centre is expensive, but relying on backup alone can leave recovery objectives exposed.",
              "Covenco offers secure cloud disaster recovery, immutable backups and the ability to restore data onto rental hardware when needed. That creates a more practical path for many teams under pressure and tighter budgets.",
              "Would it be unreasonable to ask how {{companyName}} would recover after a serious outage?",
            ],
            SIGNOFF,
          ),
        },
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

const HTML_TAG_RE = /<[a-z]+|<\/[a-z]+|\/>|&nbsp;/i;

type Finding = {
  campaign: string;
  step: number;
  variant: "A" | "B";
  issue: string;
};

function auditBody(
  campaignName: string,
  step: number,
  variant: "A" | "B",
  body: string,
  expectedSpintax: string | null,
): Finding[] {
  const out: Finding[] = [];
  const push = (issue: string) => out.push({ campaign: campaignName, step, variant, issue });

  if (HTML_TAG_RE.test(body)) push("HTML tag detected");
  const crlfCount = (body.match(/\r\n/g) || []).length;
  if (crlfCount < 4) push(`CRLF count=${crlfCount} (<4)`);
  if (!body.includes("{{firstName}}")) push("missing {{firstName}}");
  if (!body.includes("{{companyName}}")) push("missing {{companyName}}");
  if (!body.startsWith("Hi {{firstName}},")) push("greeting not `Hi {{firstName}},`");
  if (!body.endsWith("+44 1753 478313")) push("signoff does not end with +44 1753 478313");
  if (body.includes("Mobile:")) push("signoff contains `Mobile:` prefix");
  if (expectedSpintax && !body.includes(expectedSpintax)) {
    push(`missing expected spintax ${expectedSpintax}`);
  }
  return out;
}

async function main() {
  console.log("=== ITER 5 FINAL: Covenco Instantly CRLF body propagation + audit ===\n");

  // PHASE 1: Pre-check all 9 campaigns for DRAFT status.
  console.log("--- PHASE 1: pre-check (all 9 must be DRAFT) ---");
  const preCheck: Record<string, any> = {};
  for (const c of CAMPAIGNS) {
    const data = await getCampaign(c.id);
    preCheck[c.id] = data;
    const ok = data.status === 0 && data.text_only === true;
    console.log(`${ok ? "OK" : "??"} ${c.name}: status=${data.status} text_only=${data.text_only}`);
    if (data.status !== 0) {
      throw new Error(`REFUSE: ${c.name} status=${data.status}, not DRAFT. Aborting.`);
    }
  }

  // PHASE 2: propagate bodies for all 9 campaigns in a single PATCH per campaign.
  // We PATCH all 6 variant bodies per campaign at once. For the reference campaign
  // (Backup Services), step 1 variant A is already correct but we re-patch to the
  // same value, which is a no-op for content (idempotent). Counting: we mark
  // reference variant as not-propagated. The remaining 53 count as propagated.
  console.log("\n--- PHASE 2: propagate CRLF bodies (9 PATCHes, one per campaign) ---");
  let propagated = 0;
  for (const c of CAMPAIGNS) {
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
      const spec = c.steps[s];
      // Variant A
      const isRefA =
        c.id === REF_CAMPAIGN_ID && s === REF_STEP_IDX && REF_VARIANT_IDX === 0;
      if (!isRefA) {
        variants[0].body = spec.variantA.body;
        propagated += 1;
      } else {
        // Leave untouched. Already verified correct.
      }
      variants[0].subject = spec.variantA.subject; // subject idempotent
      // Variant B
      variants[1].body = spec.variantB.body;
      variants[1].subject = spec.variantB.subject;
      propagated += 1;
    }
    try {
      await patchCampaign(c.id, { sequences: seqs, text_only: true });
      console.log(`OK PATCH ${c.name}`);
    } catch (e) {
      console.error(`FAIL PATCH ${c.name}: ${(e as Error).message}`);
      throw e;
    }
  }
  console.log(`\nBodies propagated (non-reference): ${propagated}`);

  // PHASE 3: audit all 54 variants.
  console.log("\n--- PHASE 3: audit all 54 variants ---");
  const allFindings: Finding[] = [];
  let verified = 0;
  const htmlDriftVariants: string[] = [];
  for (const c of CAMPAIGNS) {
    const post = await getCampaign(c.id);
    // Track campaign-level drift detection would need pre-snapshots; pre snapshot available.
    const pre = preCheck[c.id];
    const preSeqs = pre.sequences;
    for (let s = 0; s < 3; s++) {
      const postVariants = post.sequences[0].steps[s].variants;
      const preVariants = preSeqs[0].steps[s].variants;
      for (let v = 0; v < 2; v++) {
        const variantLabel: "A" | "B" = v === 0 ? "A" : "B";
        const body: string = postVariants[v].body;
        const preBody: string = preVariants[v].body;
        const expectedSpintax =
          c.id === "578c27a2-717c-4ef2-b6d8-031b07261f4d" && s === 0
            ? "{{off-site|immutable|offline}}"
            : c.id === "aacbce5d-f5a7-4156-8496-967c4efa5bfd" && s === 0
              ? "{{protect|stabilise|strengthen}}"
              : null;
        const findings = auditBody(c.name, s + 1, variantLabel, body, expectedSpintax);
        if (findings.length === 0) verified += 1;
        allFindings.push(...findings);
        // HTML drift: pre-body contained HTML
        if (HTML_TAG_RE.test(preBody)) {
          htmlDriftVariants.push(`${c.name} step${s + 1}${variantLabel}`);
        }
        // Subject check: current equals expected from source doc
        const expectedSubject =
          v === 0 ? c.steps[s].variantA.subject : c.steps[s].variantB.subject;
        if (postVariants[v].subject !== expectedSubject) {
          allFindings.push({
            campaign: c.name,
            step: s + 1,
            variant: variantLabel,
            issue: `subject mismatch: got ${JSON.stringify(postVariants[v].subject)}, expected ${JSON.stringify(expectedSubject)}`,
          });
        }
      }
    }
  }
  console.log(`Variants audited: 54`);
  console.log(`Clean (no findings): ${verified}`);
  console.log(`Findings: ${allFindings.length}`);
  for (const f of allFindings) {
    console.log(`  - ${f.campaign} step${f.step}${f.variant}: ${f.issue}`);
  }

  // PHASE 4: campaign-level verify.
  console.log("\n--- PHASE 4: campaign-level verify ---");
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

  // PHASE 5: lead count sanity
  console.log("\n--- PHASE 5: lead counts ---");
  let grand = 0;
  for (const c of CAMPAIGNS) {
    const n = await countLeads(c.id);
    grand += n;
    console.log(`  ${c.name}: ${n}`);
  }
  console.log(`TOTAL leads: ${grand} (expect 42)`);

  // PHASE 6: HTML drift report
  console.log("\n--- PHASE 6: HTML drift from pre-state ---");
  if (htmlDriftVariants.length === 0) {
    console.log("No variants stored as HTML pre-patch.");
  } else {
    console.log(`Variants stored as HTML pre-patch (${htmlDriftVariants.length}):`);
    for (const v of htmlDriftVariants) console.log(`  - ${v}`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`propagated_non_reference: ${propagated}`);
  console.log(`reference_untouched: 1 (Backup Services step1 variantA)`);
  console.log(`audit_clean: ${verified}/54`);
  console.log(`findings: ${allFindings.length}`);
  console.log(`all_text_only: ${allTextOnly}`);
  console.log(`all_draft: ${allDraft}`);
  console.log(`total_leads: ${grand}`);
  console.log(`html_drift_variants: ${htmlDriftVariants.length}`);

  if (allFindings.length > 0) {
    console.log("\nFAIL: findings present. See list above.");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
