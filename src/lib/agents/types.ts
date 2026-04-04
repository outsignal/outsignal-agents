import type { Tool } from "ai";
import { z } from "zod";

// --- Agent Configuration ---

export const NOVA_MODEL = "claude-opus-4-6" as const;

export interface AgentConfig {
  name: string;
  model:
    | "claude-opus-4-6"
    | "claude-opus-4-20250514"
    | "claude-sonnet-4-20250514"
    | "claude-haiku-4-5-20251001";
  systemPrompt: string;
  tools: Record<string, Tool>;
  maxSteps?: number; // default 10
  outputSchema?: z.ZodType<unknown>; // Optional Zod schema for validating parsed output
  memoryRoot?: string; // Memory namespace root (default: ".nova/memory", Monty uses ".monty/memory")
  onComplete?: (
    result: AgentRunResult,
    options?: { workspaceSlug?: string; input?: unknown },
  ) => Promise<void>;
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

export interface SignalContext {
  signalType: "job_change" | "funding" | "hiring_spike" | "tech_adoption" | "news" | "social_mention";
  companyDomain: string;
  companyName?: string;
  isHighIntent: boolean; // true when 2+ stacked signals detected
}

export interface CreativeIdeaDraft {
  position: number;         // 1, 2, or 3
  title: string;            // Short idea title (admin sees this when picking)
  groundedIn: string;       // Exact offering name from coreOffers/differentiators/caseStudies/KB
  subjectLine: string;
  subjectVariantB?: string;
  body: string;
  notes: string;
}

export interface WriterInput {
  workspaceSlug: string;
  task: string;
  channel?: "email" | "linkedin" | "email_linkedin";
  campaignName?: string;
  campaignId?: string; // Link to Campaign entity for context
  feedback?: string;
  stepNumber?: number; // For targeted step regeneration
  // Phase 20: Copy strategy selection
  copyStrategy?: "creative-ideas" | "pvp" | "one-liner" | "custom";
  customStrategyPrompt?: string; // Freeform admin instructions, only for copyStrategy="custom"
  signalContext?: SignalContext;  // Internal only — never shown to recipient
}

export interface EmailStep {
  position: number;
  subjectLine: string;
  subjectVariantB?: string;
  body: string;
  delayDays: number;
  /** Include 'Applied: [principle] from [KB doc]' citation. Prefix with '[REVIEW NEEDED]' if violations persist after 2 rewrite attempts. */
  notes: string;
}

export interface LinkedInStep {
  position: number;
  type: "connection_request" | "message" | "inmail";
  body: string;
  delayDays: number;
  /** Include 'Applied: [principle] from [KB doc]' citation. Prefix with '[REVIEW NEEDED]' if violations persist after 2 rewrite attempts. */
  notes: string;
}

export interface WriterOutput {
  campaignName: string;
  channel: "email" | "linkedin" | "email_linkedin";
  emailSteps?: EmailStep[];
  linkedinSteps?: LinkedInStep[];
  reviewNotes: string;
  creativeIdeas?: CreativeIdeaDraft[]; // Populated when strategy=creative-ideas
  strategy?: string;                   // Which strategy was used (e.g. "creative-ideas", "pvp")
  /** KB doc titles cited. Per-step application details go in each step's `notes` field as 'Applied: [principle] from [doc]'. */
  references?: string[];
}

// --- Campaign Agent ---

export interface CampaignInput {
  workspaceSlug: string;
  task: string;
  campaignId?: string;    // For operations on existing campaign
  campaignName?: string;  // For creating or finding by name
  feedback?: string;      // User feedback to incorporate
}

export interface CampaignOutput {
  action: string; // "create" | "list" | "get" | "update" | "publish" | "generate_content" | "unknown"
  summary: string;
  campaignId?: string;
  data?: unknown;
}

// --- Deliverability Agent ---

export interface DeliverabilityInput {
  workspaceSlug: string;
  task: string;
}
export interface DeliverabilityOutput {
  action: string;
  summary: string;
  data?: unknown;
}

// --- Intelligence Agent ---

export interface IntelligenceInput {
  workspaceSlug: string;
  task: string;
}
export interface IntelligenceOutput {
  action: string;
  summary: string;
  data?: unknown;
}

// --- Onboarding Agent ---

export interface OnboardingInput {
  workspaceSlug: string;
  task: string;
}
export interface OnboardingOutput {
  action: string;
  summary: string;
  data?: unknown;
}

// --- Monty Dev Agent ---

export interface MontyDevInput {
  task: string;
  tier: "1" | "2" | "3"; // Action tier: 1=read-only, 2=reversible, 3=gated
}

export interface MontyDevOutput {
  action: string;       // What was done (e.g. "Fixed type error in route.ts")
  summary: string;      // Human-readable summary
  filesChanged: string[]; // Absolute paths of files modified
  affectsNova: boolean;  // Whether this change impacts Nova agents
  novaNotification?: string; // Cross-team notification text if affectsNova=true
  changeType?: "schema-change" | "api-change" | "tool-change" | "config-change"; // Cross-team change classification
}

// --- Zod Output Schemas (for runtime validation in runner.ts) ---
// Zod v4: objects are loose by default (extra keys pass through), no .passthrough() needed.

export const researchOutputSchema = z.object({
  companyOverview: z.string(),
  icpIndicators: z.object({
    industries: z.string(),
    titles: z.string(),
    companySize: z.string(),
    countries: z.string(),
  }),
  valuePropositions: z.array(z.string()),
  caseStudies: z.array(
    z.object({
      client: z.string(),
      result: z.string(),
      metrics: z.string().optional(),
    }),
  ),
  painPoints: z.array(z.string()),
  differentiators: z.array(z.string()),
  pricingSignals: z.string().optional(),
  contentTone: z.string(),
  suggestions: z.array(z.string()),
});

export const writerOutputSchema = z.object({
  campaignName: z.string(),
  channel: z.enum(["email", "linkedin", "email_linkedin"]),
  emailSteps: z
    .array(
      z.object({
        position: z.number(),
        subjectLine: z.string(),
        subjectVariantB: z.string().optional(),
        body: z.string(),
        delayDays: z.number(),
        notes: z.string(),
      }),
    )
    .optional(),
  linkedinSteps: z
    .array(
      z.object({
        position: z.number(),
        type: z.enum(["connection_request", "message", "inmail"]),
        body: z.string(),
        delayDays: z.number(),
        notes: z.string(),
      }),
    )
    .optional(),
  reviewNotes: z.string(),
  creativeIdeas: z
    .array(
      z.object({
        position: z.number(),
        title: z.string(),
        groundedIn: z.string(),
        subjectLine: z.string(),
        subjectVariantB: z.string().optional(),
        body: z.string(),
        notes: z.string(),
      }),
    )
    .optional(),
  strategy: z.string().optional(),
  references: z.array(z.string()).optional(),
});

export const leadsOutputSchema = z.object({
  action: z.string(),
  summary: z.string(),
  data: z.unknown().optional(),
});

export const campaignOutputSchema = z.object({
  action: z.string(),
  summary: z.string(),
  campaignId: z.string().optional(),
  data: z.unknown().optional(),
});

export const montyDevOutputSchema = z.object({
  action: z.string(),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  affectsNova: z.boolean(),
  novaNotification: z.string().optional(),
  changeType: z.string().optional(),
});

// --- Monty QA Agent ---

export interface MontyQAInput {
  task: string;
  changedFiles?: string[]; // Optional file paths from orchestrator
}

export interface MontyQAFinding {
  file: string; // Absolute file path
  line?: number; // Line number
  severity: "critical" | "high" | "medium" | "low" | "info";
  category:
    | "type-error"
    | "test-failure"
    | "dead-code"
    | "pattern-inconsistency"
    | "missing-test"
    | "performance"
    | "api-integration";
  description: string; // Specific problem
  suggestion: string; // Concrete fix
}

export interface MontyQAOutput {
  reviewSummary: string;
  findings: MontyQAFinding[];
  testsRun: boolean;
  testsPassed?: boolean;
  testDetails?: string;
  affectsNova: boolean;
  novaNotification?: string;
  changeType?: "qa-finding"; // Cross-team change classification
}

export const montyQAOutputSchema = z.object({
  reviewSummary: z.string(),
  findings: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      severity: z.enum(["critical", "high", "medium", "low", "info"]),
      category: z.enum([
        "type-error",
        "test-failure",
        "dead-code",
        "pattern-inconsistency",
        "missing-test",
        "performance",
        "api-integration",
      ]),
      description: z.string(),
      suggestion: z.string(),
    }),
  ),
  testsRun: z.boolean(),
  testsPassed: z.boolean().optional(),
  testDetails: z.string().optional(),
  affectsNova: z.boolean(),
  novaNotification: z.string().optional(),
  changeType: z.string().optional(),
});

// --- Monty Security Agent ---

export interface MontySecurityInput {
  task: string;
  changedFiles?: string[];
}

export interface MontySecurityFinding {
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  category:
    | "secrets-exposure"
    | "auth-bypass"
    | "input-validation"
    | "injection"
    | "xss"
    | "csrf"
    | "rate-limiting"
    | "error-leakage"
    | "dependency-vuln"
    | "owasp-compliance";
  owaspCategory?: string; // e.g. "A01:2025 Broken Access Control"
  description: string;
  remediation: string;
}

export interface MontySecurityOutput {
  reviewSummary: string;
  findings: MontySecurityFinding[];
  blockDeploy: boolean;
  gateReason?: string; // Required when blockDeploy is true
  npmAuditRun: boolean;
  npmAuditSummary?: string;
  affectsNova: boolean;
  novaNotification?: string;
  changeType?: "security-advisory"; // Cross-team change classification
}

export const montySecurityOutputSchema = z.object({
  reviewSummary: z.string(),
  findings: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      category: z.enum([
        "secrets-exposure",
        "auth-bypass",
        "input-validation",
        "injection",
        "xss",
        "csrf",
        "rate-limiting",
        "error-leakage",
        "dependency-vuln",
        "owasp-compliance",
      ]),
      owaspCategory: z.string().optional(),
      description: z.string(),
      remediation: z.string(),
    }),
  ),
  blockDeploy: z.boolean(),
  gateReason: z.string().optional(),
  npmAuditRun: z.boolean(),
  npmAuditSummary: z.string().optional(),
  affectsNova: z.boolean(),
  novaNotification: z.string().optional(),
  changeType: z.string().optional(),
});

// --- Cross-Team Fields for Nova Orchestrator ---

/**
 * Cross-team fields for Nova orchestrator onComplete hook.
 * Used when Nova detects platform issues that Monty should know about.
 */
export interface NovaCrossTeamFields {
  affectsMonty: boolean;
  montyNotification?: string;
}

// --- Validator Agent Types (Phase 55) ---

export const validationFindingSchema = z.object({
  check: z.enum([
    "filler_spintax",
    "tonal_mismatch",
    "angle_repetition",
    "ai_patterns",
    "structural",
    "general",
  ]),
  severity: z.enum(["hard", "soft"]),
  step: z.number().optional(),
  field: z.string().optional(),
  problem: z.string(),
  suggestion: z.string(),
});

export const validationResultSchema = z.object({
  passed: z.boolean(),
  findings: z.array(validationFindingSchema),
  summary: z.string(),
  checklist: z.object({
    fillerSpintax: z.enum(["pass", "fail", "warn"]),
    tonalMismatch: z.enum(["pass", "fail", "warn"]),
    angleRepetition: z.enum(["pass", "fail", "warn"]),
    aiPatterns: z.enum(["pass", "fail", "warn"]),
  }),
});

export type ValidationFinding = z.infer<typeof validationFindingSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
