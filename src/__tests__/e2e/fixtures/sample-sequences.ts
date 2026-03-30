/**
 * Sample sequences for E2E testing — clean and dirty variants
 * that exercise copy-quality.ts check functions.
 *
 * Each follows the shape: { position, subjectLine?, subjectVariantB?, body, channel?, strategy? }
 */

import type { CopyStrategy } from "@/lib/copy-quality";

export interface SampleSequenceStep {
  position: number;
  subjectLine?: string;
  subjectVariantB?: string;
  body: string;
  channel?: "email" | "linkedin";
  strategy?: CopyStrategy;
}

/**
 * Clean 3-step PVP email sequence — passes ALL quality checks.
 */
export const CLEAN_PVP_SEQUENCE: SampleSequenceStep[] = [
  {
    position: 1,
    subjectLine: "infrastructure costs",
    subjectVariantB: "cloud spend review",
    body: `Hi {FIRSTNAME}, most SaaS CTOs at the {COMPANYNAME} stage spend 30% of engineering time on infra. We helped Acme SaaS cut that by 40% in three months. {Would that kind of saving move the needle for your team|Could a similar result help your engineering velocity}?`,
    channel: "email",
    strategy: "pvp",
  },
  {
    position: 2,
    subjectLine: "re: infrastructure",
    subjectVariantB: "quick follow up",
    body: `Wanted to share one more data point. FinLedger moved to our managed platform and cut P99 latency from 800ms to 120ms, {all while reducing their monthly bill|without increasing their cloud budget}. Worth 15 minutes to compare notes?`,
    channel: "email",
    strategy: "pvp",
  },
  {
    position: 3,
    subjectLine: "last note",
    subjectVariantB: "one more thought",
    body: `{FIRSTNAME}, totally understand if the timing is off. If infrastructure becomes a priority next quarter, {happy to share how we approach it|glad to walk you through our process}. Does that sound useful?`,
    channel: "email",
    strategy: "pvp",
  },
];

/**
 * Dirty sequence with banned phrases: "quick question" in subject,
 * "I'd love to" in body, "pick your brain" in follow-up, em dashes.
 */
export const DIRTY_BANNED_PHRASES_SEQUENCE: SampleSequenceStep[] = [
  {
    position: 1,
    subjectLine: "quick question about infrastructure",
    subjectVariantB: "just a quick question",
    body: `Hi {FIRSTNAME}, I'd love to chat about how {COMPANYNAME} handles cloud costs. We've helped similar companies — including Acme SaaS — cut spend by 40%. Would you be open to a 15-minute call?`,
    channel: "email",
    strategy: "pvp",
  },
  {
    position: 2,
    subjectLine: "following up",
    subjectVariantB: "circling back",
    body: `Just following up on my last email. I wanted to reach out again because we have some exciting ideas for {COMPANYNAME}. Let me know if you have time this week?`,
    channel: "email",
    strategy: "pvp",
  },
  {
    position: 3,
    subjectLine: "pick your brain",
    subjectVariantB: "touching base",
    body: `{FIRSTNAME}, I'd love to pick your brain on how you handle infrastructure scaling. We're excited to share our approach — it's a real game-changer. Feel free to grab time on my calendar?`,
    channel: "email",
    strategy: "pvp",
  },
];

/**
 * Dirty sequence with wrong variable format: double braces + lowercase.
 */
export const DIRTY_WRONG_VARIABLES_SEQUENCE: SampleSequenceStep[] = [
  {
    position: 1,
    subjectLine: "cloud costs",
    body: `Hi {{firstName}}, I noticed {{companyName}} has been growing rapidly. Your team might benefit from our infrastructure platform. Could we compare approaches?`,
    channel: "email",
    strategy: "pvp",
  },
  {
    position: 2,
    subjectLine: "re: cloud costs",
    body: `Hi {firstName}, wanted to share a case study relevant to {companyName}. We helped a company at your stage cut cloud spend by 40%. Worth a conversation?`,
    channel: "email",
    strategy: "pvp",
  },
  {
    position: 3,
    subjectLine: "last note",
    body: `{{firstName}}, if infrastructure becomes a priority for {{companyName}} next quarter, happy to share how we approach it. Does that sound useful?`,
    channel: "email",
    strategy: "pvp",
  },
];

/**
 * LinkedIn message with spintax — should fail LinkedIn spintax check.
 */
export const LINKEDIN_WITH_SPINTAX_SEQUENCE: SampleSequenceStep[] = [
  {
    position: 1,
    body: `Hey {FIRSTNAME}, saw your team at {COMPANYNAME} is scaling up. We help {SaaS companies|growing tech firms} handle infrastructure so engineers can focus on product. {Would you be open to comparing notes|Could we chat about your approach}?`,
    channel: "linkedin",
    strategy: "linkedin",
  },
];

/**
 * Structural violation sequence: missing greeting, exclamation in subject,
 * word count over limit, banned CTA "Let me know".
 */
export const STRUCTURAL_VIOLATION_SEQUENCE: SampleSequenceStep[] = [
  {
    position: 1,
    subjectLine: "Amazing offer for your team!",
    body: `Your company is probably struggling with cloud costs right now. Every SaaS business at your stage faces this exact problem. The infrastructure gets complicated, the bills go up, the engineers spend more and more time firefighting instead of building product. We have helped dozens of companies in your exact situation reduce their cloud spend by an average of forty percent while also improving their uptime and reliability metrics significantly. Our team of ex-AWS engineers handles everything from migration planning through to day-to-day operations. Let me know if you want to discuss?`,
    channel: "email",
    strategy: "pvp",
  },
  {
    position: 2,
    subjectLine: "re: cloud costs",
    body: `Just following up on my previous email. I'd love to show you how we've helped companies like Acme SaaS and FinLedger. No worries if not interested. Feel free to reach out whenever at your earliest convenience?`,
    channel: "email",
    strategy: "pvp",
  },
];
