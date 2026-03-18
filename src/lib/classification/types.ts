// Classification taxonomy for cold outreach reply analysis

export const INTENTS = [
  "interested",
  "meeting_booked",
  "objection",
  "referral",
  "not_now",
  "unsubscribe",
  "out_of_office",
  "auto_reply",
  "not_relevant",
] as const;

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;

export const OBJECTION_SUBTYPES = [
  "budget",
  "timing",
  "competitor",
  "authority",
  "need",
  "trust",
] as const;

export type Intent = (typeof INTENTS)[number];
export type Sentiment = (typeof SENTIMENTS)[number];
export type ObjectionSubtype = (typeof OBJECTION_SUBTYPES)[number];

export type ClassificationResult = {
  intent: Intent;
  sentiment: Sentiment;
  objectionSubtype: ObjectionSubtype | null;
  summary: string;
};

export const INTENT_LABELS: Record<Intent, string> = {
  interested: "Interested",
  meeting_booked: "Meeting Booked",
  objection: "Objection",
  referral: "Referral",
  not_now: "Not Now",
  unsubscribe: "Unsubscribe",
  out_of_office: "Out of Office",
  auto_reply: "Auto Reply",
  not_relevant: "Not Relevant",
};

export const INTENT_COLORS: Record<Intent, string> = {
  interested: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  meeting_booked: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  objection: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  referral: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  not_now: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  unsubscribe: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  out_of_office: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  auto_reply: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  not_relevant: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
};

export const SENTIMENT_COLORS: Record<Sentiment, string> = {
  positive: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  neutral: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  negative: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};
