export type StageKey = "onboarding" | "campaign_setup" | "campaign_launch" | "customer_success";
export type TemplateType = "email" | "email_linkedin" | "scale";

export interface SubtaskTemplate {
  title: string;
  order: number;
}

export interface TaskTemplate {
  stage: StageKey;
  title: string;
  order: number;
  subtasks: SubtaskTemplate[];
  /** Index references to other tasks in the same template that block this one */
  blockedByIndices?: number[];
  /** Days from client start date when this task is due */
  dueDaysFromStart?: number;
}

export const STAGES = [
  { value: "onboarding" as const, label: "Onboarding" },
  { value: "campaign_setup" as const, label: "Campaign Setup" },
  { value: "campaign_launch" as const, label: "Campaign Launch" },
  { value: "customer_success" as const, label: "Customer Success" },
] as const;

export const PIPELINE_STATUSES = [
  { value: "new_lead", label: "New Lead", color: "#87909e" },
  { value: "contacted", label: "Contacted", color: "#5f55ee" },
  { value: "qualified", label: "Qualified Prospect", color: "#6366f1" },
  { value: "demo", label: "Demo", color: "#8b5cf6" },
  { value: "proposal", label: "Proposal", color: "#f59e0b" },
  { value: "negotiation", label: "Negotiation", color: "#f97316" },
  { value: "closed_won", label: "Closed Won", color: "#22c55e" },
  { value: "closed_lost", label: "Closed Lost", color: "#ef4444" },
  { value: "unqualified", label: "Unqualified", color: "#64748b" },
  { value: "churned", label: "Churned", color: "#e11d48" },
] as const;

export const CAMPAIGN_TYPES = [
  { value: "email" as const, label: "Email Only" },
  { value: "email_linkedin" as const, label: "Email + LinkedIn" },
  { value: "scale" as const, label: "Scale" },
] as const;

export const TASK_TEMPLATES: Record<TemplateType, TaskTemplate[]> = {
  email: [
    {
      stage: "onboarding",
      title: "Client Setup",
      order: 0,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Create client Folder in Clickup", order: 0 },
        { title: "Add Onboarding document to Folder", order: 1 },
        { title: "Create Lead Tracking Sheet", order: 2 },
        { title: "Add signed client SOW + T&Cs", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "Client Exclusion",
      order: 1,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Add Client Domain to GA Internal Exclusion List", order: 0 },
        { title: "Add Client LinkedIn Page to GA Internal Exclusion List", order: 1 },
      ],
    },
    {
      stage: "onboarding",
      title: "EmailBison - Account Setup",
      order: 2,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Create EmailBison Workspace", order: 0 },
        { title: "Turn on Auto AI Categorization in Mailbox Settings", order: 1 },
        { title: "Create custom Tags as needed", order: 2 },
        { title: "Send EmailBison access to clients", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "PorkBun - Domain Setup",
      order: 3,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Create a SubAccount for the customer", order: 0 },
        { title: "Add 10-15 lookalike domains to the basket", order: 1 },
        { title: "Purchase the lookalike domains", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "CheapInboxes - Order Inboxes",
      order: 4,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Contact CheapInboxes via WhatsApp", order: 0 },
        { title: "Complete the CheapInboxes Order Form", order: 1 },
      ],
    },
    {
      stage: "onboarding",
      title: "Slack - Customer Service",
      order: 5,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Create a Slack channel for the client", order: 0 },
      ],
    },
    {
      stage: "onboarding",
      title: "Invites",
      order: 6,
      dueDaysFromStart: 3,
      subtasks: [
        { title: "Invite client to Slack channel", order: 0 },
        { title: "Invite client to EmailBison Workspace", order: 1 },
        { title: "Invite CheapInboxes to EmailBison Workspace", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "Domain + Inbox Setup",
      order: 7,
      dueDaysFromStart: 3,
      subtasks: [
        { title: "Check CheapInbox Setup", order: 0 },
      ],
    },
    {
      stage: "onboarding",
      title: "Domain + Inbox Warmup",
      order: 8,
      dueDaysFromStart: 4,
      subtasks: [
        { title: "Get CheapInboxes to begin warmup within EmailBison", order: 0 },
        { title: "Verify Warmup settings", order: 1 },
        { title: "Confirm the warm-up completion date", order: 2 },
        { title: "Notify Client that warm-up has started", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "Onboarding Complete",
      order: 9,
      dueDaysFromStart: 5,
      subtasks: [],
    },
    {
      stage: "campaign_setup",
      title: "Campaign Setup can Commence",
      order: 10,
      dueDaysFromStart: 5,
      subtasks: [],
    },
    {
      stage: "campaign_setup",
      title: "Client Exclusion List",
      order: 11,
      dueDaysFromStart: 6,
      subtasks: [
        { title: "Create Client Exclusion List", order: 0 },
        { title: "Add Client Exclusion list to EmailBison", order: 1 },
        { title: "Add Client Exclusion list to LinkedHelper", order: 2 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create ICP-based Audience",
      order: 12,
      dueDaysFromStart: 7,
      subtasks: [
        { title: "Identify best source for audience", order: 0 },
        { title: "Build audience list via discovery agents", order: 1 },
        { title: "Approval of ICP-based list", order: 2 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create Email Content [DRAFT]",
      order: 13,
      dueDaysFromStart: 8,
      subtasks: [
        { title: "Identify account level personalisation", order: 0 },
        { title: "Review email content best practices", order: 1 },
        { title: "Create Initial Draft", order: 2 },
        { title: "Send for Client Approval", order: 3 },
        { title: "Spintax", order: 4 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Inbox Health",
      order: 14,
      dueDaysFromStart: 9,
      subtasks: [
        { title: "Review Inbox Health in EmailBison", order: 0 },
        { title: "Good enough to launch?", order: 1 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Approved Content",
      order: 15,
      dueDaysFromStart: 9,
      subtasks: [
        { title: "Approved Email Content", order: 0 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create Draft Campaigns",
      order: 16,
      dueDaysFromStart: 10,
      subtasks: [
        { title: "Create draft email campaign in EmailBison", order: 0 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Campaign Setup Complete",
      order: 17,
      dueDaysFromStart: 10,
      subtasks: [],
    },
    {
      stage: "campaign_launch",
      title: "Launch Confirmed",
      order: 18,
      dueDaysFromStart: 11,
      subtasks: [],
    },
    {
      stage: "campaign_launch",
      title: "Send Launch Confirmation to client",
      order: 19,
      dueDaysFromStart: 11,
      subtasks: [
        { title: "Send email to client with lead link", order: 0 },
        { title: "Send message in Slack to client with lead list", order: 1 },
      ],
    },
    {
      stage: "campaign_launch",
      title: "Monitor Campaign Launch Success",
      order: 20,
      dueDaysFromStart: 12,
      subtasks: [
        { title: "Ensure campaign has launched correctly 24 hours after launch", order: 0 },
      ],
    },
    {
      stage: "campaign_launch",
      title: "Monitor 2 week performance",
      order: 21,
      dueDaysFromStart: 25,
      subtasks: [
        { title: "Adjust Content Based On 2 Week Results", order: 0 },
        { title: "Send Client 2 week campaign status email", order: 1 },
      ],
    },
    {
      stage: "customer_success",
      title: "Send Weekly Campaign + Lead Report [FRIDAY]",
      order: 22,
      dueDaysFromStart: 18,
      subtasks: [],
    },
    {
      stage: "customer_success",
      title: "Send Monthly Campaign + Lead Report [LAST WORKING DAY]",
      order: 23,
      dueDaysFromStart: 30,
      subtasks: [],
    },
    {
      stage: "customer_success",
      title: "Monthly Content Review",
      order: 24,
      dueDaysFromStart: 30,
      subtasks: [],
    },
  ],
  email_linkedin: [
    {
      stage: "onboarding",
      title: "Client Setup",
      order: 0,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Create client Folder in Clickup", order: 0 },
        { title: "Add Onboarding document to Folder", order: 1 },
        { title: "Create Lead Tracking Sheet", order: 2 },
        { title: "Add signed client SOW + T&Cs", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "Client Exclusion",
      order: 1,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Add Client Domain to GA Internal Exclusion List", order: 0 },
        { title: "Add Client LinkedIn Page to GA Internal Exclusion List", order: 1 },
      ],
    },
    {
      stage: "onboarding",
      title: "EmailBison - Account Setup",
      order: 2,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Create EmailBison Workspace", order: 0 },
        { title: "Turn on Auto AI Categorization in Mailbox Settings", order: 1 },
        { title: "Create custom Tags as needed", order: 2 },
        { title: "Send EmailBison access to clients", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "PorkBun - Domain Setup",
      order: 3,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Create a SubAccount for the customer", order: 0 },
        { title: "Add 10-15 lookalike domains to the basket", order: 1 },
        { title: "Purchase the lookalike domains", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "CheapInboxes - Order Inboxes",
      order: 4,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Contact CheapInboxes via WhatsApp", order: 0 },
        { title: "Complete the CheapInboxes Order Form", order: 1 },
      ],
    },
    {
      stage: "onboarding",
      title: "Slack - Customer Service",
      order: 5,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Create a Slack channel for the client", order: 0 },
      ],
    },
    {
      stage: "onboarding",
      title: "LinkedIn",
      order: 6,
      dueDaysFromStart: 3,
      subtasks: [
        { title: "Get LinkedIn credentials from client", order: 0 },
        { title: "Add client LinkedIn account to LinkedHelper", order: 1 },
        { title: "Check whether warm-up is required", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "Invites",
      order: 7,
      dueDaysFromStart: 3,
      subtasks: [
        { title: "Invite client to Slack channel", order: 0 },
        { title: "Invite client to EmailBison Workspace", order: 1 },
        { title: "Invite CheapInboxes to EmailBison Workspace", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "Domain + Inbox Setup",
      order: 8,
      dueDaysFromStart: 4,
      subtasks: [
        { title: "Check CheapInbox Setup", order: 0 },
      ],
    },
    {
      stage: "onboarding",
      title: "Domain + Inbox Warmup",
      order: 9,
      dueDaysFromStart: 5,
      subtasks: [
        { title: "Get CheapInboxes to begin warmup within EmailBison", order: 0 },
        { title: "Verify Warmup settings", order: 1 },
        { title: "Confirm the warm-up completion date", order: 2 },
        { title: "Notify Client that warm-up has started", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "Onboarding Complete",
      order: 10,
      dueDaysFromStart: 5,
      subtasks: [],
    },
    {
      stage: "campaign_setup",
      title: "Campaign Setup can Commence",
      order: 11,
      dueDaysFromStart: 6,
      subtasks: [],
    },
    {
      stage: "campaign_setup",
      title: "Client Exclusion List",
      order: 12,
      dueDaysFromStart: 6,
      subtasks: [
        { title: "Create Client Exclusion List", order: 0 },
        { title: "Add Client Exclusion list to EmailBison", order: 1 },
        { title: "Add Client Exclusion list to LinkedHelper", order: 2 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create ICP-based Audience",
      order: 13,
      dueDaysFromStart: 7,
      subtasks: [
        { title: "Identify best source for audience", order: 0 },
        { title: "Build audience list via discovery agents", order: 1 },
        { title: "Approval of ICP-based list", order: 2 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create Email Content [DRAFT]",
      order: 14,
      dueDaysFromStart: 8,
      subtasks: [
        { title: "Identify account level personalisation", order: 0 },
        { title: "Review email content best practices", order: 1 },
        { title: "Create Initial Draft", order: 2 },
        { title: "Send for Client Approval", order: 3 },
        { title: "Spintax", order: 4 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create LinkedIn Content [DRAFT]",
      order: 15,
      dueDaysFromStart: 8,
      subtasks: [
        { title: "Identify account level personalisation", order: 0 },
        { title: "Review LinkedIn content best practices", order: 1 },
        { title: "Create Initial Draft", order: 2 },
        { title: "Send for Client Approval", order: 3 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Inbox Health",
      order: 16,
      dueDaysFromStart: 9,
      subtasks: [
        { title: "Review Inbox Health in EmailBison", order: 0 },
        { title: "Good enough to launch?", order: 1 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Approved Content",
      order: 17,
      dueDaysFromStart: 9,
      subtasks: [
        { title: "Approved Email Content", order: 0 },
        { title: "Approved LinkedIn Content", order: 1 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create Draft Campaigns",
      order: 18,
      dueDaysFromStart: 10,
      subtasks: [
        { title: "Create draft email campaign in EmailBison", order: 0 },
        { title: "Create draft LinkedIn campaign in LinkedHelper", order: 1 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Campaign Setup Complete",
      order: 19,
      dueDaysFromStart: 10,
      subtasks: [],
    },
    {
      stage: "campaign_launch",
      title: "Launch Confirmed",
      order: 20,
      dueDaysFromStart: 11,
      subtasks: [],
    },
    {
      stage: "campaign_launch",
      title: "Send Launch Confirmation to client",
      order: 21,
      dueDaysFromStart: 11,
      subtasks: [
        { title: "Send email to client with lead link", order: 0 },
        { title: "Send message in Slack to client with lead list", order: 1 },
      ],
    },
    {
      stage: "campaign_launch",
      title: "Monitor Campaign Launch Success",
      order: 22,
      dueDaysFromStart: 12,
      subtasks: [
        { title: "Ensure campaign has launched correctly 24 hours after launch", order: 0 },
      ],
    },
    {
      stage: "campaign_launch",
      title: "Monitor 2 week performance",
      order: 23,
      dueDaysFromStart: 25,
      subtasks: [
        { title: "Adjust Content Based On 2 Week Results", order: 0 },
        { title: "Send Client 2 week campaign status email", order: 1 },
      ],
    },
    {
      stage: "customer_success",
      title: "Send Weekly Campaign + Lead Report [FRIDAY]",
      order: 24,
      dueDaysFromStart: 18,
      subtasks: [],
    },
    {
      stage: "customer_success",
      title: "Send Monthly Campaign + Lead Report [LAST WORKING DAY]",
      order: 25,
      dueDaysFromStart: 30,
      subtasks: [],
    },
    {
      stage: "customer_success",
      title: "Monthly Content Review",
      order: 26,
      dueDaysFromStart: 30,
      subtasks: [],
    },
  ],
  scale: [
    {
      stage: "onboarding",
      title: "Client Setup",
      order: 0,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Create client Folder in Clickup", order: 0 },
        { title: "Add Onboarding document to Folder", order: 1 },
        { title: "Create Lead Tracking Sheet", order: 2 },
        { title: "Add signed client SOW + T&Cs", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "Client Exclusion",
      order: 1,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Add Client Domain to GA Internal Exclusion List", order: 0 },
        { title: "Add Client LinkedIn Page to GA Internal Exclusion List", order: 1 },
      ],
    },
    {
      stage: "onboarding",
      title: "EmailBison - Account Setup",
      order: 2,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Create EmailBison Workspace", order: 0 },
        { title: "Turn on Auto AI Categorization in Mailbox Settings", order: 1 },
        { title: "Create custom Tags as needed", order: 2 },
        { title: "Send EmailBison access to clients", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "PorkBun - Domain Setup",
      order: 3,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Create a SubAccount for the customer", order: 0 },
        { title: "Add 10-15 lookalike domains to the basket", order: 1 },
        { title: "Purchase the lookalike domains", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "CheapInboxes - Order Inboxes",
      order: 4,
      dueDaysFromStart: 2,
      subtasks: [
        { title: "Contact CheapInboxes via WhatsApp", order: 0 },
        { title: "Complete the CheapInboxes Order Form", order: 1 },
      ],
    },
    {
      stage: "onboarding",
      title: "Slack - Customer Service",
      order: 5,
      dueDaysFromStart: 1,
      subtasks: [
        { title: "Create a Slack channel for the client", order: 0 },
      ],
    },
    {
      stage: "onboarding",
      title: "LinkedIn",
      order: 6,
      dueDaysFromStart: 3,
      subtasks: [
        { title: "Get LinkedIn credentials from client", order: 0 },
        { title: "Add client LinkedIn account to LinkedHelper", order: 1 },
        { title: "Check whether warm-up is required", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "Invites",
      order: 7,
      dueDaysFromStart: 3,
      subtasks: [
        { title: "Invite client to Slack channel", order: 0 },
        { title: "Invite client to EmailBison Workspace", order: 1 },
        { title: "Invite CheapInboxes to EmailBison Workspace", order: 2 },
      ],
    },
    {
      stage: "onboarding",
      title: "Domain + Inbox Setup",
      order: 8,
      dueDaysFromStart: 4,
      subtasks: [
        { title: "Check CheapInbox Setup", order: 0 },
      ],
    },
    {
      stage: "onboarding",
      title: "Domain + Inbox Warmup",
      order: 9,
      dueDaysFromStart: 5,
      subtasks: [
        { title: "Get CheapInboxes to begin warmup within EmailBison", order: 0 },
        { title: "Verify Warmup settings", order: 1 },
        { title: "Confirm the warm-up completion date", order: 2 },
        { title: "Notify Client that warm-up has started", order: 3 },
      ],
    },
    {
      stage: "onboarding",
      title: "Onboarding Complete",
      order: 10,
      dueDaysFromStart: 5,
      subtasks: [],
    },
    {
      stage: "campaign_setup",
      title: "Campaign Setup can Commence",
      order: 11,
      dueDaysFromStart: 6,
      subtasks: [],
    },
    {
      stage: "campaign_setup",
      title: "Client Exclusion List",
      order: 12,
      dueDaysFromStart: 6,
      subtasks: [
        { title: "Create Client Exclusion List", order: 0 },
        { title: "Add Client Exclusion list to EmailBison", order: 1 },
        { title: "Add Client Exclusion list to LinkedHelper", order: 2 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create ICP-based Audience",
      order: 13,
      dueDaysFromStart: 7,
      subtasks: [
        { title: "Identify best source for audience", order: 0 },
        { title: "Build audience list via discovery agents", order: 1 },
        { title: "Approval of ICP-based list", order: 2 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create Email Content [DRAFT]",
      order: 14,
      dueDaysFromStart: 8,
      subtasks: [
        { title: "Identify account level personalisation", order: 0 },
        { title: "Review email content best practices", order: 1 },
        { title: "Create Initial Draft", order: 2 },
        { title: "Send for Client Approval", order: 3 },
        { title: "Spintax", order: 4 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create LinkedIn Content [DRAFT]",
      order: 15,
      dueDaysFromStart: 8,
      subtasks: [
        { title: "Identify account level personalisation", order: 0 },
        { title: "Review LinkedIn content best practices", order: 1 },
        { title: "Create Initial Draft", order: 2 },
        { title: "Send for Client Approval", order: 3 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Inbox Health",
      order: 16,
      dueDaysFromStart: 9,
      subtasks: [
        { title: "Review Inbox Health in EmailBison", order: 0 },
        { title: "Good enough to launch?", order: 1 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Approved Content",
      order: 17,
      dueDaysFromStart: 9,
      subtasks: [
        { title: "Approved Email Content", order: 0 },
        { title: "Approved LinkedIn Content", order: 1 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Create Draft Campaigns",
      order: 18,
      dueDaysFromStart: 10,
      subtasks: [
        { title: "Create draft email campaign in EmailBison", order: 0 },
        { title: "Create draft LinkedIn campaign in LinkedHelper", order: 1 },
      ],
    },
    {
      stage: "campaign_setup",
      title: "Campaign Setup Complete",
      order: 19,
      dueDaysFromStart: 10,
      subtasks: [],
    },
    {
      stage: "campaign_launch",
      title: "Launch Confirmed",
      order: 20,
      dueDaysFromStart: 11,
      subtasks: [],
    },
    {
      stage: "campaign_launch",
      title: "Send Launch Confirmation to client",
      order: 21,
      dueDaysFromStart: 11,
      subtasks: [
        { title: "Send email to client with lead link", order: 0 },
        { title: "Send message in Slack to client with lead list", order: 1 },
      ],
    },
    {
      stage: "campaign_launch",
      title: "Monitor Campaign Launch Success",
      order: 22,
      dueDaysFromStart: 12,
      subtasks: [
        { title: "Ensure campaign has launched correctly 24 hours after launch", order: 0 },
      ],
    },
    {
      stage: "campaign_launch",
      title: "Monitor 2 week performance",
      order: 23,
      dueDaysFromStart: 25,
      subtasks: [
        { title: "Adjust Content Based On 2 Week Results", order: 0 },
        { title: "Send Client 2 week campaign status email", order: 1 },
      ],
    },
    {
      stage: "customer_success",
      title: "Send Weekly Campaign + Lead Report [FRIDAY]",
      order: 24,
      dueDaysFromStart: 18,
      subtasks: [],
    },
    {
      stage: "customer_success",
      title: "Send Monthly Campaign + Lead Report [LAST WORKING DAY]",
      order: 25,
      dueDaysFromStart: 30,
      subtasks: [],
    },
    {
      stage: "customer_success",
      title: "Monthly Content Review",
      order: 26,
      dueDaysFromStart: 30,
      subtasks: [],
    },
  ],
};
