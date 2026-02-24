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
  company?: string;
  phone?: string;
  custom_fields?: Record<string, string>;
  tags?: Tag[];
  created_at: string;
}

export interface ReplyRecipient {
  name: string | null;
  email: string;
}

export interface Reply {
  id: number;
  uuid: string;
  folder: "Inbox" | "Bounced";
  type: "Tracked Reply" | "Bounced" | string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
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
