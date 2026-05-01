export interface PaginatedResponse<T> {
  data: T[];
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    per_page: number;
    to: number;
    total: number;
  };
}

export interface Campaign {
  id: number;
  uuid: string;
  sequence_id: number;
  name: string;
  type: string;
  status: "active" | "paused" | "draft" | "completed";
  completion_percentage: number;
  emails_sent: number;
  opened: number;
  unique_opens: number;
  replied: number;
  unique_replies: number;
  bounced: number;
  unsubscribed: number;
  interested: number;
  total_leads_contacted: number;
  total_leads: number;
  max_emails_per_day: number;
  max_new_leads_per_day: number;
  plain_text: boolean;
  open_tracking: boolean;
  can_unsubscribe: boolean;
  unsubscribe_text: string | null;
  include_auto_replies_in_stats: boolean;
  sequence_prioritization: string;
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company?: string;
  phone?: string;
  custom_variables?: { name: string; value: string }[];
  status?: string;
  notes?: string | null;
  lead_campaign_data?: {
    campaign_id: number;
    status: string;
    emails_sent: number;
    replies: number;
    opens: number;
    interested: boolean;
  }[];
  overall_stats?: {
    emails_sent: number;
    opens: number;
    replies: number;
    unique_replies: number;
    unique_opens: number;
  };
  tags?: Tag[];
  created_at: string;
}

export interface ReplyRecipient {
  name: string | null;
  address: string;
}

export interface Reply {
  id: number;
  uuid: string;
  folder: "Inbox" | "Bounced" | "Sent" | string;
  type: "Tracked Reply" | "Bounced" | "Outgoing Email" | string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  raw_body: string | null;
  headers: string | null;
  from_name: string | null;
  from_email_address: string;
  primary_to_email_address: string;
  to: ReplyRecipient[] | null;
  cc: ReplyRecipient[] | null;
  bcc: ReplyRecipient[] | null;
  read: boolean;
  interested: boolean;
  automated_reply: boolean;
  tracked_reply: boolean;
  date_received: string;
  campaign_id: number;
  lead_id: number;
  sender_email_id: number;
  scheduled_email_id: number | null;
  raw_message_id: string | null;
  parent_id: number | null;
  attachments: unknown[];
  created_at: string;
  updated_at: string;
}

export interface SenderEmail {
  id: number;
  email: string;
  name?: string;
  daily_limit?: number;
  type?: string;
  status?: string;
  warmup_enabled?: boolean;
  campaigns?: Array<{ id: number; name: string; status: string }>;
  emails_sent_count: number;
  total_replied_count: number;
  total_opened_count: number;
  unsubscribed_count: number;
  bounced_count: number;
  unique_replied_count: number;
  unique_opened_count: number;
  total_leads_contacted_count: number;
  interested_leads_count: number;
  tags?: Tag[];
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
  created_at: string;
}

export interface SequenceStep {
  id: number;
  campaign_id: number;
  position: number;
  subject?: string;
  body?: string;
  delay_days?: number;
  variant?: boolean;
}

/**
 * Response shape for GET /api/scheduled-emails/{id}.
 * Only fields we need — the EB endpoint returns more but these are the ones
 * used by the reply attribution resolver.
 */
export interface ScheduledEmail {
  id: number;
  campaign_id: number;
  sequence_step_id: number;
}

export interface CreateCampaignParams {
  name: string;
  type?: 'outbound' | 'inbound';
  maxEmailsPerDay?: number;
  maxNewLeadsPerDay?: number;
  plainText?: boolean;
  // Extended settings (the docs allow these on update; create accepts at minimum
  // name + type. We forward the extras and EB ignores anything it doesn't accept
  // on create — callers should follow up with updateCampaign() to be safe).
  openTracking?: boolean;
  reputationBuilding?: boolean;
  canUnsubscribe?: boolean;
  unsubscribeText?: string;
  includeAutoRepliesInStats?: boolean;
  sequencePrioritization?: string;
}

/**
 * Parameters for POST /api/campaigns/{campaign_id}/schedule.
 * Per docs/emailbison-dedi-api-reference.md lines 152-169.
 *
 * All day booleans and start_time/end_time/timezone are required on create.
 *
 * BL-090 + BL-087: EB v1.1 POST /campaigns/:id/schedule rejects 422 if
 * `save_as_template` is absent (despite the docs marking it optional). The
 * field is now required at the type level on BOTH POST and PUT — callers
 * must always send it. DEFAULT_SCHEDULE supplies it (`save_as_template:
 * false`) so per-campaign schedules don't pollute the workspace template
 * list. Verified via canary Run F 422 reproduction (BL-087 fix landed in
 * commit ca2fe6a3).
 */
export interface CreateScheduleParams {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  start_time: string; // HH:MM (24h)
  end_time: string;   // HH:MM (24h)
  timezone: string;   // e.g. "Europe/London"
  save_as_template: boolean; // BL-090 + BL-087: required on POST + PUT.
}

/**
 * Parameters for PUT /api/campaigns/{campaign_id}/schedule.
 * Per docs/emailbison-dedi-api-reference.md lines 181-198.
 *
 * Mirrors CreateScheduleParams. `save_as_template` is required (BL-090).
 */
export type UpdateScheduleParams = CreateScheduleParams;

/**
 * Response shape for schedule endpoints. The EB API returns a data envelope
 * whose exact shape is not documented in the reference — we treat it as opaque
 * since callers don't currently read the returned value.
 */
export type ScheduleResponse = Record<string, unknown>;

/**
 * Settings updatable via PATCH /api/campaigns/{id}/update.
 * Snake-case to match the EB request body 1:1 (the PATCH endpoint takes the
 * same field names the GET returns, so we don't camelCase-bridge here — pass
 * the EB-native field name in directly to avoid ambiguity).
 */
export interface UpdateCampaignParams {
  name?: string;
  max_emails_per_day?: number;
  max_new_leads_per_day?: number;
  plain_text?: boolean;
  open_tracking?: boolean;
  reputation_building?: boolean;
  can_unsubscribe?: boolean;
  unsubscribe_text?: string | null;
  include_auto_replies_in_stats?: boolean;
  sequence_prioritization?: string;
}

export interface CreateLeadParams {
  firstName?: string;
  lastName?: string;
  email: string;
  jobTitle?: string;
  company?: string;
  phone?: string;
  customVariables?: { name: string; value: string }[];
}

export interface CustomVariable {
  id: number;
  name: string;
  created_at: string;
}

export interface CreateLeadResult {
  id: number;
  email: string;
  status: string;
}

export interface CampaignCreateResult {
  id: number;
  uuid: string;
  name: string;
  status: string;
  sequence_id: number | null;
}

export interface CreateSequenceStepParams {
  position: number;
  subject?: string;
  body: string;
  delay_days?: number;
  /**
   * BL-093 (2026-04-16): EB v1.1 sequence-steps boolean. Verified
   * empirically 2026-04-16 against canary EB 87 + live Lime production
   * campaigns 26/31/32/42/43/44/45.
   *
   * When `true`:
   *   - EB emits RFC 5322 In-Reply-To / References headers so recipient
   *     mail clients thread the message.
   *   - EB AUTO-PREPENDS "Re: " to the email_subject value before storage.
   *     Sending email_subject="X" + thread_reply=true results in EB
   *     storing email_subject="Re: X". Callers must send the RAW step-1
   *     subject (no Re: prefix) — sending "Re: X" would store as
   *     "Re: Re: X" (double-Re).
   *   - email_subject MUST still be non-empty (EB validation rejects empty
   *     even with thread_reply=true).
   *
   * When `false` (or absent):
   *   - Fresh email thread, no auto-prefix, subject sent verbatim.
   *
   * Outsignal convention (feedback_email_threading_subject memory):
   *   - Step 1: thread_reply=false, populated subject (always).
   *   - Follow-up step with empty subjectLine: thread_reply=true,
   *     email_subject=<firstStepSubject> (RAW; EB prepends Re: at storage).
   *   - Follow-up step with own subject: thread_reply=false, fresh thread.
   *
   * The email-adapter is responsible for selecting the correct subject
   * based on the writer-supplied subjectLine; the client just forwards
   * whatever the caller passes.
   */
  thread_reply?: boolean;
}

export interface UpdateSequenceStepParams {
  id: number;
  position: number;
  subject?: string;
  body: string;
  delay_days?: number;
  thread_reply?: boolean;
  /**
   * EB v1.1 PUT /sequence-steps/{sequence_id} requires this field on each
   * sequence step. Preserve the value returned by getSequenceSteps() when
   * updating an existing step so A/B variant flags are not clobbered.
   */
  variant?: boolean;
}

export interface PatchSenderEmailParams {
  daily_limit?: number;
  warmup_enabled?: boolean;
  status?: string; // "active" | "paused" — pending API investigation
}

export interface WebhookPayload {
  event:
    | "EMAIL_SENT"
    | "REPLY_RECEIVED"
    | "BOUNCE"
    | "INTERESTED"
    | "UNSUBSCRIBED"
    | "TAG_ADDED";
  data: Record<string, unknown>;
  workspace_id?: number;
  timestamp: string;
}

/**
 * Params for sending a reply to an existing reply thread.
 * Validated via live spike test on 2026-03-11.
 *
 * Either to_emails or reply_all must be provided.
 * Either message or reply_template_id must be provided.
 */
export interface SendReplyParams {
  /** Plain text reply body */
  message?: string;
  /** Alternative to message: use a saved reply template */
  reply_template_id?: number;
  /** Sender email account to send from (use the original reply's sender_email_id) */
  sender_email_id: number;
  /** Array of recipient email addresses to reply to */
  to_emails?: string[];
  /** If true, replies to all original recipients (shorthand for providing to_emails) */
  reply_all?: boolean;
}

/**
 * Response shape from POST /replies/{id}/reply.
 * Validated via live spike test on 2026-03-11.
 *
 * On success (200): { data: { success: true, message: string, reply: Reply } }
 * On failure (422): { data: { success: false, message: string, errors: Record<string, string[]> } }
 */
export interface SendReplyResponse {
  data: {
    success: boolean;
    message: string;
    reply?: Reply;
    errors?: Record<string, string[]>;
  };
}

/**
 * Public-facing error class for consumers of the EmailBisonClient inbox methods.
 * Separate from the internal EmailBisonApiError (which handles retry logic).
 */
export class EmailBisonError extends Error {
  constructor(
    public readonly code: string,       // e.g. "SEND_REPLY_FAILED", "INVALID_REPLY_ID", "UNEXPECTED_RESPONSE"
    public readonly statusCode: number, // HTTP status code
    public readonly rawBody?: string,   // Raw response body for debugging
  ) {
    super(`EmailBison error ${code} (${statusCode})`);
    this.name = "EmailBisonError";
  }
}
