import type { Tool } from "ai";

// --- Agent Configuration ---

export interface AgentConfig {
  name: string;
  model:
    | "claude-opus-4-20250514"
    | "claude-sonnet-4-20250514"
    | "claude-haiku-4-5-20251001";
  systemPrompt: string;
  tools: Record<string, Tool>;
  maxSteps?: number; // default 10
}

// --- Agent Run Logging ---

export interface ToolCallStep {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentRunResult<TOutput = unknown> {
  output: TOutput;
  text: string; // raw text response from the model
  steps: ToolCallStep[];
  durationMs: number;
}

// --- Research Agent ---

export interface ResearchInput {
  workspaceSlug?: string;
  url?: string;
  task: string;
}

export interface CaseStudy {
  client: string;
  result: string;
  metrics?: string;
}

export interface ICPIndicators {
  industries: string;
  titles: string;
  companySize: string;
  countries: string;
}

export interface ResearchOutput {
  companyOverview: string;
  icpIndicators: ICPIndicators;
  valuePropositions: string[];
  caseStudies: CaseStudy[];
  painPoints: string[];
  differentiators: string[];
  pricingSignals?: string;
  contentTone: string;
  suggestions: string[];
}

// --- Leads Agent ---

export interface LeadsInput {
  workspaceSlug?: string;
  task: string;
  conversationContext?: string; // Prior search results or list context for refinement
}

export interface LeadsOutput {
  action: string; // "search" | "create_list" | "add_to_list" | "score" | "export" | "get_list" | "list_lists" | "unknown"
  summary: string; // Human-readable summary of what was done
  data?: unknown; // The raw result data from the operation
}

// --- Writer Agent ---

export interface WriterInput {
  workspaceSlug: string;
  task: string;
  channel?: "email" | "linkedin" | "email_linkedin";
  campaignName?: string;
  campaignId?: string; // Link to Campaign entity for context
  feedback?: string;
  stepNumber?: number; // For targeted step regeneration
}

export interface EmailStep {
  position: number;
  subjectLine: string;
  subjectVariantB?: string;
  body: string;
  delayDays: number;
  notes: string;
}

export interface LinkedInStep {
  position: number;
  type: "connection_request" | "message" | "inmail";
  body: string;
  delayDays: number;
  notes: string;
}

export interface WriterOutput {
  campaignName: string;
  channel: "email" | "linkedin" | "email_linkedin";
  emailSteps?: EmailStep[];
  linkedinSteps?: LinkedInStep[];
  reviewNotes: string;
}

// --- Campaign Agent ---

export interface CampaignInput {
  workspaceSlug: string;
  task: string;
  campaignName?: string;
}

export interface CampaignOutput {
  campaignId?: number;
  campaignName: string;
  status: string;
  leadsAssigned?: number;
  sequenceSteps?: number;
  action: string;
}
