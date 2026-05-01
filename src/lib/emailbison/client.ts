import { z } from "zod";
import type {
  PaginatedResponse,
  Campaign,
  Lead,
  Reply,
  ScheduledEmail,
  SenderEmail,
  Tag,
  SequenceStep,
  CreateCampaignParams,
  CreateLeadParams,
  CreateSequenceStepParams,
  CustomVariable,
  CreateLeadResult,
  CampaignCreateResult,
  PatchSenderEmailParams,
  SendReplyParams,
  SendReplyResponse,
  UpdateCampaignParams,
  CreateScheduleParams,
  UpdateScheduleParams,
  ScheduleResponse,
  UpdateSequenceStepParams,
} from "./types";
import { EmailBisonError } from "./types";
import { transformVariablesForEB } from "./variable-transform";
import type { RateLimits } from "@/lib/discovery/rate-limit";

/**
 * EmailBison rate limits.
 * Source: EmailBison API docs.
 *
 *   - 3,000 requests/minute (50 req/s)
 *   - Returns 429 when exceeded
 *
 * Pagination: 15 results per page (default) — MUST paginate all pages.
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 15,              // 15 results per page (EB default, pagination not rate limit)
  delayBetweenCalls: 20,         // 50 req/s — Source: EmailBison API docs (3,000 req/min)
  maxConcurrent: 1,
  dailyCap: null,
  cooldownOnRateLimit: 60_000,   // 60s wait after 429
};

export class EmailBisonApiError extends Error {
  public parsedBody: Record<string, unknown> | null;

  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Email Bison API error ${status}: ${body}`);
    this.name = "EmailBisonApiError";
    try {
      this.parsedBody = JSON.parse(body);
    } catch {
      this.parsedBody = null;
    }
  }

  /** True when EB says the record no longer exists */
  get isRecordNotFound(): boolean {
    if (this.status !== 404) return false;
    const data = this.parsedBody?.data as Record<string, unknown> | undefined;
    return !!data?.record_not_found;
  }
}

class RateLimitError extends EmailBisonApiError {
  constructor(public retryAfter: number) {
    super(429, `Rate limited. Retry after ${retryAfter}s`);
    this.name = "RateLimitError";
  }
}

/**
 * HTTP statuses that the EmailBison client treats as transient and retries
 * automatically (with exponential backoff) inside the per-request loop.
 *
 * Exported as the canonical set for ALL EB-related retry decisions. Layered
 * callers (`@/lib/utils/retry.withRetry`, future ad-hoc callers) MUST import
 * this constant rather than maintaining their own copy — BL-089 (2026-04-16)
 * removed a comment-discipline duplicate in retry.ts so the two sets cannot
 * drift again. If a new transient status emerges (e.g. 408, 425), add it
 * here and every layered caller picks it up automatically.
 *
 * Status reasoning:
 *   - 429: rate limited, EB returns retry-after header.
 *   - 500/502/503/504: 5xx transient — EB has historically returned all four
 *     during brief outages or slow workers.
 * Excluded by design (deterministic responses):
 *   - 4xx non-429: validation/auth/forbidden/not-found — retrying won't
 *     change the answer; on non-idempotent POSTs it amplifies side-effects
 *     (BL-085 cascade, BL-086 amplifier neutralization).
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504,
]);

export class EmailBisonClient {
  private baseUrl = "https://app.outsignal.ai/api";

  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  // Internal alias — kept for backwards compatibility with the existing
  // `EmailBisonClient.RETRYABLE_STATUSES` reference in the request loop.
  // Both names point to the same canonical Set so there's no drift.
  private static readonly RETRYABLE_STATUSES = RETRYABLE_STATUSES;
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;

  private async request<T>(
    endpoint: string,
    options?: RequestInit & { revalidate?: number },
  ): Promise<T> {
    const { revalidate = 300, ...fetchOptions } = options ?? {};

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= EmailBisonClient.MAX_RETRIES; attempt++) {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...fetchOptions,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...fetchOptions?.headers,
        },
        next: { revalidate },
      });

      // Success — return immediately
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      }

      // Non-retryable status — fail fast
      if (!EmailBisonClient.RETRYABLE_STATUSES.has(res.status)) {
        const body = (await res.text()).slice(0, 500);
        throw new EmailBisonApiError(res.status, body);
      }

      // Retryable status — log and retry (unless final attempt)
      const body = (await res.text()).slice(0, 500);

      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        lastError = new RateLimitError(Number(retryAfter) || 60);
      } else {
        lastError = new EmailBisonApiError(res.status, body);
      }

      if (attempt < EmailBisonClient.MAX_RETRIES) {
        const delayMs = EmailBisonClient.BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(
          `[EmailBison] Request to ${endpoint} failed with ${res.status} (attempt ${attempt}/${EmailBisonClient.MAX_RETRIES}). Retrying in ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // All retries exhausted — throw the last error
    throw lastError!;
  }

  private async getAllPages<T>(endpoint: string): Promise<T[]> {
    let page = 1;
    const allData: T[] = [];

    const first = await this.request<PaginatedResponse<T>>(
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`,
    );
    allData.push(...first.data);
    const lastPage = first.meta.last_page;

    while (page < lastPage) {
      page++;
      const response = await this.request<PaginatedResponse<T>>(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`,
      );
      allData.push(...response.data);
    }

    return allData;
  }

  private async getPages<T>(endpoint: string, maxPages: number): Promise<T[]> {
    let page = 1;
    const allData: T[] = [];

    const first = await this.request<PaginatedResponse<T>>(
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`,
    );
    allData.push(...first.data);
    const lastPage = Math.min(first.meta.last_page, maxPages);

    while (page < lastPage) {
      page++;
      const response = await this.request<PaginatedResponse<T>>(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`,
      );
      allData.push(...response.data);
    }

    return allData;
  }

  async getCampaigns(): Promise<Campaign[]> {
    return this.getAllPages<Campaign>("/campaigns");
  }

  async getCampaignById(campaignId: number): Promise<Campaign | null> {
    try {
      const res = await this.request<{ data: Campaign }>(
        `/campaigns/${campaignId}`,
        { revalidate: 60 },
      );
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  async getCampaignLeads(
    campaignId: number,
    page = 1,
    limit = 25,
  ): Promise<PaginatedResponse<Lead>> {
    return this.request<PaginatedResponse<Lead>>(
      `/campaigns/${campaignId}/leads?page=${page}&limit=${limit}`,
      { revalidate: 60 },
    );
  }

  async getReplies(): Promise<Reply[]> {
    return this.getAllPages<Reply>("/replies");
  }

  async getRecentReplies(maxPages = 2): Promise<Reply[]> {
    return this.getPages<Reply>("/replies", maxPages);
  }

  async getLeads(): Promise<Lead[]> {
    return this.getAllPages<Lead>("/leads");
  }

  async getSenderEmails(): Promise<SenderEmail[]> {
    return this.getAllPages<SenderEmail>("/sender-emails");
  }

  async getTags(): Promise<Tag[]> {
    return this.getAllPages<Tag>("/tags");
  }

  /**
   * Read sequence steps for a campaign.
   *
   * Endpoint: `GET /api/campaigns/v1.1/{campaignId}/sequence-steps`
   *   (docs/emailbison-dedi-api-reference.md line 1318 — the v1 path
   *   `/campaigns/{id}/sequence-steps` is deprecated per EB docs).
   *
   * Phase 6.5b / BL-074 follow-through: migrated off the deprecated v1 GET
   * path. The deprecated path was the last remaining v1 reference in this
   * client (creates already moved to v1.1 batch endpoint in Phase 6.5a).
   *
   * Behaviour:
   *   - Response is parsed through a Zod schema at the HTTP boundary matching
   *     the `createSequenceSteps` pattern — shape drift throws an
   *     EmailBisonError("UNEXPECTED_RESPONSE", 200, ...) rather than silently
   *     casting. Extra fields are tolerated via passthrough.
   *   - EB has historically returned mixed casings for sequence step fields;
   *     defensive fallbacks (`order ?? position`, `email_subject ?? subject`,
   *     etc.) are preserved even against v1.1 — the schema guards against
   *     drift, the fallbacks guard against inconsistent shape within the
   *     allowed set.
   *   - Supports both `{ data: [...] }` and bare array response shapes
   *     (v1.1 is documented as `{ data: [...] }` but EB has returned both
   *     historically — parser accepts either).
   */
  async getSequenceSteps(campaignId: number): Promise<SequenceStep[]> {
    const res = await this.request<unknown>(
      `/campaigns/v1.1/${campaignId}/sequence-steps`,
    );

    // Zod schema at the HTTP boundary — matches the createSequenceSteps
    // pattern at lines 381-402. EB may return `{ data: [...] }` (documented
    // v1.1 shape) or a bare array (historical v1 shape tolerated on the read
    // path). Passthrough lets us keep the defensive `order ?? position`
    // fallbacks below without the schema complaining about unknown keys.
    const EbSequenceStepSchema = z
      .object({
        id: z.number(),
        campaign_id: z.number().nullable().optional(),
        email_subject: z.string().nullable().optional(),
        subject: z.string().nullable().optional(),
        email_body: z.string().nullable().optional(),
        body: z.string().nullable().optional(),
        wait_in_days: z.number().nullable().optional(),
        delay_days: z.number().nullable().optional(),
        order: z.number().nullable().optional(),
        position: z.number().nullable().optional(),
        variant: z.boolean().nullable().optional(),
      })
      .passthrough();
    // BL-096 (2026-04-16): EB v1.1 GET now returns a nested shape
    // `{ data: { sequence_id, sequence_steps: [...] } }` in addition to the
    // previously-documented `{ data: [...] }` and historical bare-array
    // shapes. All three are accepted here (closes BL-096 latent drift —
    // previously the canary verification side threw UNEXPECTED_RESPONSE).
    const EbResponseSchema = z.union([
      z.object({
        data: z.object({
          sequence_id: z.number().nullable().optional(),
          sequence_steps: z.array(EbSequenceStepSchema),
        }),
      }),
      z.object({ data: z.array(EbSequenceStepSchema) }),
      z.array(EbSequenceStepSchema),
    ]);

    const parsed = EbResponseSchema.safeParse(res);
    if (!parsed.success) {
      throw new EmailBisonError(
        "UNEXPECTED_RESPONSE",
        200,
        `getSequenceSteps response failed schema validation: ${parsed.error.message}. Raw: ${JSON.stringify(res).slice(0, 500)}`,
      );
    }

    // Unwrap to the raw step array regardless of shape variant.
    const raw = Array.isArray(parsed.data)
      ? parsed.data
      : Array.isArray(parsed.data.data)
        ? parsed.data.data
        : parsed.data.data.sequence_steps;

    // Defensive field-name normalization preserved from the v1 implementation.
    // EB has historically returned both casings (`order` and `position`,
    // `email_subject` and `subject`, `wait_in_days` and `delay_days`). Even
    // on v1.1 we keep the fallbacks so a partial-response edge-case (e.g.
    // `position` populated but `order` null for a legacy step) maps
    // consistently to the internal SequenceStep shape.
    return raw.map((s) => {
      const step: SequenceStep = {
        id: s.id,
        campaign_id: s.campaign_id ?? campaignId,
        position: (s.order ?? s.position ?? 0) as number,
        subject: (s.email_subject ?? s.subject ?? "") as string,
        body: (s.email_body ?? s.body ?? "") as string,
        delay_days: (s.wait_in_days ?? s.delay_days ?? 0) as number,
      };
      if (typeof s.variant === "boolean") {
        step.variant = s.variant;
      }
      return step;
    });
  }

  /**
   * Create one or more sequence steps in a single batched POST.
   *
   * Endpoint: `POST /api/campaigns/v1.1/{campaignId}/sequence-steps`
   *   (docs/emailbison-dedi-api-reference.md lines 1326-1334 —
   *   the v1 `/campaigns/{id}/sequence-steps` path is deprecated per EB docs).
   *
   * Wire format (REQUIRED):
   *   {
   *     "title": "<sequence title>",
   *     "sequence_steps": [
   *       {
   *         "email_subject": "<subject>",
   *         "email_body": "<HTML body>",
   *         "wait_in_days": <int>=1>
   *       },
   *       ...
   *     ]
   *   }
   *
   * Consumer contract: callers pass the same EmailAdapter-friendly
   * `CreateSequenceStepParams` shape (`{ position, subject, body, delay_days }`)
   * they used with the deprecated `createSequenceStep`. This method handles
   * transformation to EB's snake_case shape internally — keeping the consumer
   * API stable while fixing the wire format.
   *
   * Behaviour:
   *   - Empty `steps` array → returns `[]` without making a network call.
   *     (Posting an empty batch would have EB reject with 422 and is
   *     pointless idempotently.)
   *   - Per EB docs, this endpoint APPENDS to any existing sequence on the
   *     campaign (see spike notes). Callers that need idempotency MUST
   *     pre-filter the batch via `getSequenceSteps(campaignId)` and only
   *     include positions not already present — same pattern Phase 3
   *     established in email-adapter.ts Step 3.
   *   - Response is parsed through a Zod schema at the HTTP boundary. EB
   *     returns the full sequence after append (pre-existing + newly added);
   *     we filter down to the newly-created steps by position so callers
   *     get only what they created. If the response shape drifts, the Zod
   *     parse fails loud with a BL-068-style descriptive error rather than
   *     silently casting.
   *
   * Phase 6.5a / BL-074: wire-format fix. Previous `createSequenceStep`
   * posted a flat body to the deprecated v1 path and got 422 on every
   * deploy that reached Step 3.
   */
  async createSequenceSteps(
    campaignId: number,
    title: string,
    steps: CreateSequenceStepParams[],
  ): Promise<SequenceStep[]> {
    if (steps.length === 0) {
      // Skip the HTTP call entirely — EB would 422 on an empty batch and
      // there is nothing to create. Matches the defensive early-return
      // pattern used elsewhere in the client (attachSenderEmails,
      // attachTagsToCampaigns) though we return [] rather than throw
      // because a batched caller building from a diff naturally hits the
      // zero-missing-steps case on idempotent re-runs.
      return [];
    }

    const body = {
      title,
      sequence_steps: steps.map((step) => ({
        // BL-093 (2026-04-16, corrected post-da7fdf60): apply variable
        // transform on the wire so writer-emitted `{FIRSTNAME}` /
        // `{COMPANYNAME}` / etc. become EB's vendor-documented
        // `{FIRST_NAME}` / `{COMPANY}` syntax — SINGLE-curly UPPER_SNAKE.
        // Without this, literal `FIRSTNAME` in the body would render as the
        // string "FIRSTNAME" to the recipient. Transform is idempotent
        // because the target shape is same as input shape (single-curly
        // UPPER_SNAKE) — already-correct EB tokens pass through unchanged.
        email_subject: transformVariablesForEB(step.subject ?? ""),
        email_body: transformVariablesForEB(step.body),
        // BL-113 (2026-04-20): callers pass semantic gap-to-next-step
        // values, including legitimate semantic 0s. Live EB v1.1 rejects
        // wait_in_days=0 at ANY position with 422 ("must be at least 1"),
        // so clamp the WIRE value universally to the vendor's minimum.
        // That keeps semantic translation centralized at the adapter/helper
        // layer while satisfying the API's stricter constraint.
        wait_in_days: Math.max(1, step.delay_days ?? 1),
        // BL-093: thread_reply boolean tells EB to auto-thread this step
        // under the previous step's subject. When true, EB accepts an
        // empty email_subject and threads via RFC 5322 In-Reply-To /
        // References headers. Defaults to false at the wire if unset so
        // existing callers that don't pass the field keep the
        // pre-BL-093 behaviour (each step is a fresh thread, requires
        // non-empty subject).
        thread_reply: step.thread_reply ?? false,
      })),
    };

    const res = await this.request<unknown>(
      `/campaigns/v1.1/${campaignId}/sequence-steps`,
      {
        method: "POST",
        body: JSON.stringify(body),
        revalidate: 0,
      },
    );

    // Parse the response shape at the HTTP boundary — no silent `as` cast
    // on response data. EB returns the full sequence after append, shape
    // `{ data: [ { id, email_subject, email_body, wait_in_days, order, ... } ] }`
    // per the spike notes. Extra fields are tolerated via passthrough.
    //
    // BL-085 (2026-04-16) — tolerant parse on 200. The spike notes describe
    // the v1 response shape; the v1.1 endpoint's response is UNDOCUMENTED
    // and in production returned a shape that failed this schema, throwing
    // `UNEXPECTED_RESPONSE (200)`. That Zod throw was then retried by the
    // caller's withRetry wrap (email-adapter.ts Step 3, since removed), so
    // EB inserted the full batch again on every retry → 3× duplicate
    // sequence steps in the orphan EB 82 canary run (BL-085 cascade).
    //
    // Behaviour change: HTTP 200 is the success signal. The response body
    // is bonus data and is NOT consumed by email-adapter.ts (the Step 3
    // idempotency diff reads `getSequenceSteps` (GET) to determine missing
    // positions, not this POST response). On parse failure we log a
    // descriptive warn so shape drift is visible in ops logs, and return
    // `[]` so the caller proceeds. 4xx/5xx responses are still thrown by
    // the underlying `request` helper — only 200-with-unexpected-shape is
    // tolerated here.
    const EbSequenceStepSchema = z
      .object({
        id: z.number(),
        campaign_id: z.number().nullable().optional(),
        email_subject: z.string().nullable().optional(),
        email_body: z.string().nullable().optional(),
        wait_in_days: z.number().nullable().optional(),
        order: z.number().nullable().optional(),
        position: z.number().nullable().optional(),
      })
      .passthrough();
    const EbResponseSchema = z.object({
      data: z.array(EbSequenceStepSchema),
    });

    const parsed = EbResponseSchema.safeParse(res);
    if (!parsed.success) {
      // Build a raw preview that never throws — res can be undefined
      // (empty 200 body; `request` returns `undefined as T` in that case),
      // a string, an object, or any JSON-serializable value.
      let rawPreview: string;
      if (res === undefined) {
        rawPreview = "(empty body)";
      } else if (typeof res === "string") {
        rawPreview = res.slice(0, 500);
      } else {
        try {
          rawPreview = JSON.stringify(res).slice(0, 500);
        } catch {
          rawPreview = "(unserializable)";
        }
      }
      console.warn(
        `[EmailBison] createSequenceSteps: HTTP 200 but response failed schema validation — tolerating drift (caller does not consume response body; Step 3 idempotency reads getSequenceSteps GET). Zod: ${parsed.error.message}. Raw (first 500 chars): ${rawPreview}`,
      );
      return [];
    }

    // Map EB's snake_case shape to the internal SequenceStep type.
    // Position normalization matches the existing getSequenceSteps pattern
    // in this client (falls back across order/position, 0 if absent).
    return parsed.data.data.map((s) => ({
      id: s.id,
      campaign_id: campaignId,
      position: (s.order ?? s.position ?? 0) as number,
      subject: (s.email_subject ?? "") as string,
      body: (s.email_body ?? "") as string,
      delay_days: (s.wait_in_days ?? 0) as number,
    }));
  }

  /**
   * Update existing sequence steps for a sequence.
   *
   * Endpoint: `PUT /api/campaigns/v1.1/sequence-steps/{sequence_id}`.
   *
   * EB support confirmed 2026-04-30/2026-05-01 that each step MUST include
   * `variant`; omitting it returns a 500. Callers should read the current
   * sequence first via getSequenceSteps() and pass through the existing
   * variant value so A/B state is preserved.
   */
  async updateSequenceSteps(
    sequenceId: number,
    title: string,
    steps: UpdateSequenceStepParams[],
  ): Promise<SequenceStep[]> {
    const body = {
      title,
      sequence_steps: steps.map((step) => {
        let variant = step.variant;
        if (variant === undefined) {
          // TODO: Make variant required once all callers are confirmed to
          // read current sequence state before PUTting. EB requires the field;
          // false matches legacy non-variant steps and prevents 500s.
          console.warn(
            `[EmailBison] updateSequenceSteps: missing variant for step ${step.id}; defaulting to false. Read current sequence state before PUT to preserve A/B variant flags.`,
          );
          variant = false;
        }

        return {
          id: step.id,
          order: step.position,
          email_subject: transformVariablesForEB(step.subject ?? ""),
          email_body: transformVariablesForEB(step.body),
          wait_in_days: Math.max(1, step.delay_days ?? 1),
          thread_reply: step.thread_reply ?? false,
          variant,
        };
      }),
    };

    const res = await this.request<unknown>(
      `/campaigns/v1.1/sequence-steps/${sequenceId}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
        revalidate: 0,
      },
    );

    const EbSequenceStepSchema = z
      .object({
        id: z.number(),
        email_subject: z.string().nullable().optional(),
        email_body: z.string().nullable().optional(),
        wait_in_days: z.number().nullable().optional(),
        order: z.number().nullable().optional(),
        position: z.number().nullable().optional(),
        variant: z.boolean().nullable().optional(),
      })
      .passthrough();
    const EbResponseSchema = z.union([
      z.object({
        data: z.object({
          sequence_steps: z.array(EbSequenceStepSchema),
        }).passthrough(),
      }),
      z.object({ data: z.array(EbSequenceStepSchema) }),
      z.array(EbSequenceStepSchema),
    ]);

    const parsed = EbResponseSchema.safeParse(res);
    if (!parsed.success) {
      throw new EmailBisonError(
        "UNEXPECTED_RESPONSE",
        200,
        `updateSequenceSteps response failed schema validation: ${parsed.error.message}. Raw: ${JSON.stringify(res).slice(0, 500)}`,
      );
    }

    const raw = Array.isArray(parsed.data)
      ? parsed.data
      : Array.isArray(parsed.data.data)
        ? parsed.data.data
        : parsed.data.data.sequence_steps;

    return raw.map((s) => {
      const step: SequenceStep = {
        id: s.id,
        campaign_id: typeof s.campaign_id === "number" ? s.campaign_id : 0,
        position: (s.order ?? s.position ?? 0) as number,
        subject: (s.email_subject ?? "") as string,
        body: (s.email_body ?? "") as string,
        delay_days: (s.wait_in_days ?? 0) as number,
      };
      if (typeof s.variant === "boolean") {
        step.variant = s.variant;
      }
      return step;
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request<PaginatedResponse<Campaign>>("/campaigns?page=1");
      return true;
    } catch {
      return false;
    }
  }

  async createCampaign(params: CreateCampaignParams): Promise<CampaignCreateResult> {
    // Build the request body. Per the docs, POST /api/campaigns only
    // documents `name` + `type` as accepted on create. Extra settings
    // (open_tracking, plain_text, etc.) are documented on the PATCH update
    // endpoint. We forward the extras in case EB accepts them inline (the
    // existing implementation does this for max_emails_per_day, max_new_leads_per_day
    // and plain_text), but callers needing strict guarantees should follow
    // up with updateCampaign() — see docs/emailbison-dedi-api-reference.md
    // (PATCH /api/campaigns/{id}/update).
    const body: Record<string, unknown> = {
      name: params.name,
      type: params.type ?? 'outbound',
      max_emails_per_day: params.maxEmailsPerDay ?? 1000,
      max_new_leads_per_day: params.maxNewLeadsPerDay ?? 100,
      plain_text: params.plainText ?? true,
    };
    if (params.openTracking !== undefined) body.open_tracking = params.openTracking;
    if (params.reputationBuilding !== undefined) body.reputation_building = params.reputationBuilding;
    if (params.canUnsubscribe !== undefined) body.can_unsubscribe = params.canUnsubscribe;
    if (params.unsubscribeText !== undefined) body.unsubscribe_text = params.unsubscribeText;
    if (params.includeAutoRepliesInStats !== undefined) {
      body.include_auto_replies_in_stats = params.includeAutoRepliesInStats;
    }
    if (params.sequencePrioritization !== undefined) {
      body.sequence_prioritization = params.sequencePrioritization;
    }

    const res = await this.request<{ data: CampaignCreateResult }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
      revalidate: 0,
    });
    return res.data;
  }

  /**
   * Fetch the full campaign object.
   * GET /api/campaigns/{id} per docs/emailbison-dedi-api-reference.md.
   *
   * Returns the full Campaign object (id, uuid, name, type, status,
   * completion_percentage, all stats, max_emails_per_day,
   * max_new_leads_per_day, plain_text, open_tracking, can_unsubscribe,
   * unsubscribe_text, include_auto_replies_in_stats, sequence_prioritization,
   * tags, created_at, updated_at).
   *
   * Unlike getCampaignById() (which swallows errors and returns null), this
   * throws on any non-2xx so callers can distinguish "not found" from "rate
   * limited" or "auth failed".
   */
  async getCampaign(campaignId: number): Promise<Campaign> {
    const res = await this.request<{ data: Campaign }>(
      `/campaigns/${campaignId}`,
      { revalidate: 0 },
    );
    if (!res?.data) {
      throw new EmailBisonError(
        'CAMPAIGN_NOT_FOUND',
        404,
        `No campaign data returned for id=${campaignId}`,
      );
    }
    return res.data;
  }

  /**
   * Update campaign settings.
   * PATCH /api/campaigns/{id}/update per docs/emailbison-dedi-api-reference.md.
   *
   * Pass any subset of the documented fields (UpdateCampaignParams uses
   * snake_case to match the EB body 1:1). The endpoint is partial — fields
   * not included in the request are left unchanged.
   *
   * Returns the updated Campaign object.
   */
  async updateCampaign(
    campaignId: number,
    params: UpdateCampaignParams,
  ): Promise<Campaign> {
    if (Object.keys(params).length === 0) {
      throw new EmailBisonError(
        'EMPTY_UPDATE',
        400,
        'updateCampaign called with no fields to update',
      );
    }
    const res = await this.request<{ data: Campaign }>(
      `/campaigns/${campaignId}/update`,
      {
        method: 'PATCH',
        body: JSON.stringify(params),
        revalidate: 0,
      },
    );
    return res.data;
  }

  /**
   * Create a campaign sending schedule.
   * POST /api/campaigns/{campaign_id}/schedule per docs/emailbison-dedi-api-reference.md (lines 152-169).
   *
   * All day booleans + start_time/end_time/timezone are required; save_as_template is optional.
   */
  async createSchedule(
    campaignId: number,
    params: CreateScheduleParams,
  ): Promise<ScheduleResponse> {
    const res = await this.request<{ data: ScheduleResponse }>(
      `/campaigns/${campaignId}/schedule`,
      {
        method: 'POST',
        body: JSON.stringify(params),
        revalidate: 0,
      },
    );
    return res?.data ?? {};
  }

  /**
   * Update a campaign sending schedule.
   * PUT /api/campaigns/{campaign_id}/schedule per docs/emailbison-dedi-api-reference.md (lines 181-198).
   *
   * Mirrors createSchedule but save_as_template is required per the spec.
   */
  async updateSchedule(
    campaignId: number,
    params: UpdateScheduleParams,
  ): Promise<ScheduleResponse> {
    const res = await this.request<{ data: ScheduleResponse }>(
      `/campaigns/${campaignId}/schedule`,
      {
        method: 'PUT',
        body: JSON.stringify(params),
        revalidate: 0,
      },
    );
    return res?.data ?? {};
  }

  /**
   * Get a campaign's sending schedule.
   * GET /api/campaigns/{campaign_id}/schedule per docs/emailbison-dedi-api-reference.md (lines 173-179).
   *
   * Returns null on 404 (matches getBlacklistedDomain's not-found pattern).
   */
  async getSchedule(campaignId: number): Promise<ScheduleResponse | null> {
    try {
      const res = await this.request<{ data: ScheduleResponse }>(
        `/campaigns/${campaignId}/schedule`,
        { revalidate: 0 },
      );
      return res?.data ?? null;
    } catch (err) {
      if (err instanceof EmailBisonApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Attach tags to one or more campaigns.
   * POST /api/tags/attach-to-campaigns per docs/emailbison-dedi-api-reference.md (lines 1118-1127).
   *
   * This is a top-level tags endpoint, NOT /campaigns/.../tags — the EB spec
   * is explicit about the path. Both tag_ids and campaign_ids are required
   * and non-empty.
   */
  async attachTagsToCampaigns(params: {
    tagIds: number[];
    campaignIds: number[];
    skipWebhooks?: boolean;
  }): Promise<void> {
    if (params.tagIds.length === 0) {
      throw new EmailBisonError(
        'EMPTY_TAG_LIST',
        400,
        'attachTagsToCampaigns called with empty tagIds array',
      );
    }
    if (params.campaignIds.length === 0) {
      throw new EmailBisonError(
        'EMPTY_CAMPAIGN_LIST',
        400,
        'attachTagsToCampaigns called with empty campaignIds array',
      );
    }
    const body: Record<string, unknown> = {
      tag_ids: params.tagIds,
      campaign_ids: params.campaignIds,
    };
    if (params.skipWebhooks !== undefined) {
      body.skip_webhooks = params.skipWebhooks;
    }
    await this.request<unknown>('/tags/attach-to-campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
      revalidate: 0,
    });
  }

  /**
   * Get all sender emails attached to a campaign.
   * GET /api/campaigns/{campaign_id}/sender-emails per docs.
   *
   * Useful for verifying the sender allowlist is correctly restricted before
   * a campaign goes active (e.g. excluding disconnected inboxes from a
   * campaign that should only use the 34 connected ones).
   */
  async getCampaignSenderEmails(campaignId: number): Promise<SenderEmail[]> {
    return this.getAllPages<SenderEmail>(`/campaigns/${campaignId}/sender-emails`);
  }

  /**
   * Attach sender emails to a campaign — EB-documented path.
   * POST /api/campaigns/{campaign_id}/attach-sender-emails per docs.
   *
   * This is the canonical endpoint per the EB docs. The existing
   * addSenderToCampaign() method uses /add-sender-emails (an undocumented
   * alias) and is preserved for backwards compatibility — new code should
   * prefer this method.
   */
  async attachSenderEmails(
    campaignId: number,
    senderEmailIds: number[],
  ): Promise<void> {
    if (senderEmailIds.length === 0) {
      throw new EmailBisonError(
        'EMPTY_SENDER_LIST',
        400,
        'attachSenderEmails called with empty senderEmailIds array',
      );
    }
    await this.request<unknown>(
      `/campaigns/${campaignId}/attach-sender-emails`,
      {
        method: 'POST',
        body: JSON.stringify({ sender_email_ids: senderEmailIds }),
        revalidate: 0,
      },
    );
  }

  /**
   * Delete a campaign permanently.
   * DELETE /api/campaigns/{campaign_id} per docs/emailbison-dedi-api-reference.md (lines 572-589).
   *
   * Per EB docs: deletion is queued and processed in the background. Overall
   * stats and lead conversations in the master inbox are preserved, but the
   * campaign is no longer accessible via API. This action is PERMANENT and
   * cannot be reversed — callers must confirm intent before invoking.
   *
   * Added 2026-04-15 for BL-061 follow-up (cleanup of 22 orphan draft
   * campaigns left behind by the buggy campaign-deploy path). Kept minimal on
   * purpose: no batch variant, no soft-delete wrapper. For bulk deletes use
   * DELETE /api/campaigns/bulk (not implemented here yet — add when needed).
   */
  async deleteCampaign(campaignId: number): Promise<void> {
    await this.request<unknown>(`/campaigns/${campaignId}`, {
      method: 'DELETE',
      revalidate: 0,
    });
  }

  // Note: name param is IGNORED by API — always produces "Copy of {original}"
  async duplicateCampaign(templateCampaignId: number): Promise<CampaignCreateResult> {
    const res = await this.request<{ data: CampaignCreateResult }>(
      `/campaigns/${templateCampaignId}/duplicate`,
      { method: 'POST', body: JSON.stringify({}), revalidate: 0 }
    );
    return res.data;
  }

  async createLead(params: CreateLeadParams): Promise<CreateLeadResult> {
    const body: Record<string, unknown> = {
      email: params.email,
    };
    if (params.firstName !== undefined) body.first_name = params.firstName;
    if (params.lastName !== undefined) body.last_name = params.lastName;
    if (params.jobTitle) body.title = params.jobTitle;
    if (params.company) body.company = params.company;
    if (params.phone) body.phone = params.phone;
    if (params.customVariables?.length) {
      body.custom_variables = params.customVariables;
    }
    const res = await this.request<{ data: CreateLeadResult }>('/leads', {
      method: 'POST',
      body: JSON.stringify(body),
      revalidate: 0,
    });
    return res.data;
  }

  /**
   * Bulk upsert leads — create-or-update by email.
   *
   * Endpoint: `POST /api/leads/create-or-update/multiple`
   *   (docs/emailbison-dedi-api-reference.md lines 1595-1611). EB itself
   *   recommends re-uploading rather than deleting (line 1527: "Instead of
   *   deleting, simply re-upload the leads. We'll update the records in
   *   place."). This is the bulk variant — limit 500 leads/request.
   *
   * Request body shape:
   *   {
   *     "existing_lead_behavior": "patch",
   *     "leads": [
   *       { "email": "a@x.com", "first_name": "A", "last_name": "X", ... },
   *       ...
   *     ]
   *   }
   *
   * `existing_lead_behavior`:
   *   - "patch" (we use this) — update only fields passed in the request,
   *     leave other fields and custom variables untouched. Preserves
   *     existing lead history (replies, opens, campaign attachments).
   *   - "put" — replace ALL fields including custom variables. Anything
   *     not in the request is cleared. Destructive — avoid unless intent
   *     is reset.
   *   - default (if omitted) is "put" per docs line 1610. We always pass
   *     "patch" explicitly to make the intent unambiguous on the wire.
   *
   * BL-088 motivation: per-lead `createLead` POST hits 422 ("The email has
   * already been taken") on canary re-runs because EB's lead store is
   * WORKSPACE-scoped, not campaign-scoped — prior-run leads persist across
   * campaign deletions and block any subsequent createLead with the same
   * email. The upsert endpoint sidesteps this by accepting both new and
   * existing emails in a single batch.
   *
   * Behaviour:
   *   - Empty `leads` array → returns `[]` without making a network call.
   *     (EB would 422 on an empty batch and there's nothing to do.)
   *   - Tolerant Zod parse on HTTP 200 (BL-085 pattern). The exact response
   *     shape is undocumented in the EB reference; we try the most likely
   *     `{ data: [{id, email, ...}] }` shape, log a `[BL-088]` warn on
   *     drift, and return a best-effort empty array on parse failure
   *     rather than throwing — callers can decide whether to proceed
   *     (email-adapter Step 4 currently treats zero IDs as a deploy
   *     failure further downstream).
   *   - HTTP non-2xx is still thrown by the underlying `request` helper
   *     as `EmailBisonApiError` (e.g. 422 on validation, 401/403 on auth,
   *     429/5xx on transient). Status-aware retry behaviour is the
   *     caller's responsibility (use `withRetry` from `@/lib/utils/retry`).
   *
   * Returns: array of `CreateLeadResult` (`{id, email, status?}`) — one entry
   * per lead in the input batch on the happy path. Per EB's docs (line 1588)
   * personal-domain emails may be silently skipped server-side; the returned
   * count can be lower than the input count without an error.
   */
  async createOrUpdateLeadsMultiple(
    leads: CreateLeadParams[],
  ): Promise<CreateLeadResult[]> {
    if (leads.length === 0) {
      // Skip the HTTP call entirely — EB would 422 on an empty batch and
      // there is nothing to upsert. Matches the early-return pattern used
      // in createSequenceSteps (returns [] on empty input).
      return [];
    }

    const body = {
      existing_lead_behavior: "patch" as const,
      leads: leads.map((lead) => {
        const entry: Record<string, unknown> = { email: lead.email };
        if (lead.firstName !== undefined) entry.first_name = lead.firstName;
        if (lead.lastName !== undefined) entry.last_name = lead.lastName;
        if (lead.jobTitle) entry.title = lead.jobTitle;
        if (lead.company) entry.company = lead.company;
        if (lead.phone) entry.phone = lead.phone;
        if (lead.customVariables?.length) {
          entry.custom_variables = lead.customVariables;
        }
        return entry;
      }),
    };

    const res = await this.request<unknown>(
      "/leads/create-or-update/multiple",
      {
        method: "POST",
        body: JSON.stringify(body),
        revalidate: 0,
      },
    );

    // Parse the response shape at the HTTP boundary — no silent `as` cast.
    // EB docs do not document the response shape for this endpoint; the
    // most plausible shape (matching POST /api/leads single-create at
    // docs line 1449 and POST /api/leads/multiple bulk-create at line 1582)
    // is `{ data: [{id, email, status?, ...}] }`. We accept that or a
    // bare array (some EB endpoints return both historically — see
    // getSequenceSteps Zod union for precedent).
    //
    // BL-088 + BL-085 — tolerant parse on 200. If the shape drifts, log a
    // descriptive warn so ops sees it, and return [] so the caller can
    // decide. The caller (email-adapter Step 4) treats zero returned IDs
    // as a no-leads-to-attach condition (existing zero-leads early exit
    // at email-adapter.ts:579-593), which fails the deploy explicitly
    // rather than silently. Better to surface drift as a deploy failure
    // than to silently hide it.
    //
    // 4xx/5xx still throw via the request helper — only 200-with-unknown-
    // shape is tolerated here.
    const EbLeadSchema = z
      .object({
        id: z.number(),
        email: z.string(),
        status: z.string().optional(),
      })
      .passthrough();
    const EbResponseSchema = z.union([
      z.object({ data: z.array(EbLeadSchema) }),
      z.array(EbLeadSchema),
    ]);

    const parsed = EbResponseSchema.safeParse(res);
    if (!parsed.success) {
      // Build a raw preview that never throws — res can be undefined
      // (empty 200 body), a string, an object, or any JSON-serializable
      // value. Mirror the createSequenceSteps drift-warn pattern.
      let rawPreview: string;
      if (res === undefined) {
        rawPreview = "(empty body)";
      } else if (typeof res === "string") {
        rawPreview = res.slice(0, 500);
      } else {
        try {
          rawPreview = JSON.stringify(res).slice(0, 500);
        } catch {
          rawPreview = "(unserializable)";
        }
      }
      console.warn(
        `[BL-088] createOrUpdateLeadsMultiple response drift: ${parsed.error.message} raw=${rawPreview}`,
      );
      return [];
    }

    const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      status: r.status ?? "",
    }));
  }

  async getCustomVariables(): Promise<CustomVariable[]> {
    return this.getAllPages<CustomVariable>('/custom-variables');
  }

  async createCustomVariable(name: string): Promise<CustomVariable> {
    const res = await this.request<{ data: CustomVariable }>('/custom-variables', {
      method: 'POST',
      body: JSON.stringify({ name }),
      revalidate: 0,
    });
    return res.data;
  }

  async ensureCustomVariables(names: string[]): Promise<void> {
    const existing = await this.getCustomVariables();
    const existingNames = new Set(existing.map(v => v.name.toLowerCase()));
    for (const name of names) {
      if (!existingNames.has(name.toLowerCase())) {
        try {
          await this.createCustomVariable(name);
        } catch (err) {
          // Tolerate "already taken" — race condition or case-insensitive match
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("already been taken")) {
            console.log(`[EmailBison] Custom variable '${name}' already exists (tolerating 422)`);
            continue;
          }
          throw err;
        }
      }
    }
  }

  async pauseCampaign(campaignId: number): Promise<Campaign> {
    const res = await this.request<{ data: Campaign }>(
      `/campaigns/${campaignId}/pause`,
      { method: 'PATCH', body: JSON.stringify({}), revalidate: 0 },
    );
    return res.data;
  }

  async resumeCampaign(campaignId: number): Promise<Campaign> {
    const res = await this.request<{ data: Campaign }>(
      `/campaigns/${campaignId}/resume`,
      { method: 'PATCH', body: JSON.stringify({}), revalidate: 0 },
    );
    return res.data;
  }

  async addSenderToCampaign(campaignId: number, senderEmailIds: number[]): Promise<void> {
    await this.request<unknown>(
      `/campaigns/${campaignId}/add-sender-emails`,
      {
        method: 'POST',
        body: JSON.stringify({ sender_email_ids: senderEmailIds }),
        revalidate: 0,
      },
    );
  }

  async removeSenderFromCampaign(campaignId: number, senderEmailId: number): Promise<void> {
    await this.request<unknown>(
      `/campaigns/${campaignId}/remove-sender-emails`,
      {
        method: 'DELETE',
        body: JSON.stringify({ sender_email_ids: [senderEmailId] }),
        revalidate: 0,
      },
    );
  }

  async patchSenderEmail(senderEmailId: number, params: PatchSenderEmailParams): Promise<SenderEmail> {
    const res = await this.request<{ data: SenderEmail }>(
      `/sender-emails/${senderEmailId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(params),
        headers: { 'Content-Type': 'application/json' },
        revalidate: 0,
      },
    );
    return res.data;
  }

  /**
   * Fetch a single reply by ID.
   */
  async getReply(replyId: number): Promise<Reply> {
    const res = await this.request<{ data: Reply }>(`/replies/${replyId}`, {
      revalidate: 0,
    });
    return res.data;
  }

  /**
   * Fetch a scheduled email by ID. Used to recover sequence_step_id for
   * replies returned by the flat /replies list endpoint (which omits the
   * nested scheduled_email object present in webhook payloads).
   *
   * Endpoint: GET /scheduled-emails/{id}
   */
  async getScheduledEmail(id: number): Promise<ScheduledEmail> {
    const res = await this.request<{ data: ScheduledEmail }>(
      `/scheduled-emails/${id}`,
      { revalidate: 0 },
    );
    return res.data;
  }

  /**
   * Fetch one page of replies for inbox pagination.
   * Unlike getReplies()/getRecentReplies(), this returns a single page so callers control pagination.
   */
  async getRepliesPage(page: number = 1): Promise<PaginatedResponse<Reply>> {
    return this.request<PaginatedResponse<Reply>>(`/replies?page=${page}`, {
      revalidate: 0,
    });
  }

  /**
   * Send a reply to an existing reply thread.
   * Validated against live API on 2026-03-11.
   *
   * @param replyId - ID of the reply to respond to (the parent reply)
   * @param params - Must include sender_email_id and either message/reply_template_id
   *                 and either to_emails or reply_all:true
   * @throws EmailBisonError with code "UNEXPECTED_RESPONSE" if response shape is unexpected
   */
  async sendReply(replyId: number, params: SendReplyParams): Promise<SendReplyResponse> {
    const response = await this.request<SendReplyResponse>(
      `/replies/${replyId}/reply`,
      {
        method: 'POST',
        body: JSON.stringify(params),
        revalidate: 0,
      },
    );

    // Validate response shape — fail loud on API drift
    if (
      typeof response?.data?.success !== "boolean" ||
      typeof response?.data?.message !== "string"
    ) {
      throw new EmailBisonError(
        "UNEXPECTED_RESPONSE",
        200,
        JSON.stringify(response),
      );
    }

    return response;
  }

  /**
   * Attach one or more leads to a campaign by their EB lead IDs.
   * POST /campaigns/{campaignId}/leads/attach-leads
   */
  async attachLeadsToCampaign(campaignId: number, leadIds: number[]): Promise<void> {
    await this.request<unknown>(`/campaigns/${campaignId}/leads/attach-leads`, {
      method: 'POST',
      body: JSON.stringify({ lead_ids: leadIds }),
      revalidate: 0,
    });
  }

  /**
   * Search leads by email within a workspace.
   * GET /workspaces/{slug}/leads?email={email}
   */
  async findLeadByEmail(workspaceSlug: string, email: string): Promise<Lead | null> {
    try {
      const response = await this.request<PaginatedResponse<Lead>>(
        `/workspaces/${workspaceSlug}/leads?email=${encodeURIComponent(email)}`,
        { revalidate: 0 },
      );
      return response.data?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async markReplyUnread(replyId: number): Promise<void> {
    await this.request<unknown>(`/replies/${replyId}/mark-as-read-or-unread`, {
      method: 'PATCH',
      body: JSON.stringify({ read: false }),
      revalidate: 0,
    });
  }

  async markReplyRead(replyId: number): Promise<void> {
    await this.request<unknown>(`/replies/${replyId}/mark-as-read-or-unread`, {
      method: 'PATCH',
      body: JSON.stringify({ read: true }),
      revalidate: 0,
    });
  }

  async markReplyAutomated(replyId: number): Promise<void> {
    await this.request<unknown>(`/replies/${replyId}/mark-as-automated-or-not-automated`, {
      method: 'PATCH',
      body: JSON.stringify({ automated: true }),
      revalidate: 0,
    });
  }

  async markReplyNotAutomated(replyId: number): Promise<void> {
    await this.request<unknown>(`/replies/${replyId}/mark-as-automated-or-not-automated`, {
      method: 'PATCH',
      body: JSON.stringify({ automated: false }),
      revalidate: 0,
    });
  }

  async markReplyInterested(replyId: number): Promise<void> {
    await this.request<unknown>(`/replies/${replyId}/mark-as-interested`, {
      method: 'PATCH',
      body: JSON.stringify({ skip_webhooks: true }),
      revalidate: 0,
    });
  }

  async markReplyNotInterested(replyId: number): Promise<void> {
    await this.request<unknown>(`/replies/${replyId}/mark-as-not-interested`, {
      method: 'PATCH',
      body: JSON.stringify({ skip_webhooks: true }),
      revalidate: 0,
    });
  }

  async unsubscribeLead(leadId: number): Promise<void> {
    await this.request<unknown>(`/leads/${leadId}/unsubscribe`, {
      method: 'PATCH',
      revalidate: 0,
    });
  }

  async deleteReply(replyId: number): Promise<void> {
    await this.request<unknown>(`/replies/${replyId}`, {
      method: 'DELETE',
      revalidate: 0,
    });
  }

  async addToBlacklist(leadId: number, type: 'email' | 'domain' = 'email'): Promise<void> {
    await this.request<unknown>(`/leads/${leadId}/blacklist`, {
      method: 'POST',
      body: JSON.stringify({ type }),
      revalidate: 0,
    });
  }

  /**
   * Check if a domain is blacklisted in EmailBison.
   * GET /api/blacklisted-domains/{domain}
   * Returns the blacklisted domain data, or null if not blacklisted.
   */
  async getBlacklistedDomain(domain: string): Promise<{ id: number; domain: string; created_at: string; updated_at: string } | null> {
    try {
      const res = await this.request<{ data: { id: number; domain: string; created_at: string; updated_at: string } }>(
        `/blacklisted-domains/${encodeURIComponent(domain)}`,
        { revalidate: 0 },
      );
      return res.data ?? null;
    } catch (err) {
      if (err instanceof EmailBisonApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Check if an email is blacklisted in EmailBison.
   * GET /api/blacklisted-emails/{email}
   * Returns the blacklisted email data, or null if not blacklisted.
   */
  async getBlacklistedEmail(email: string): Promise<{ id: number; email: string; created_at: string; updated_at: string } | null> {
    try {
      const res = await this.request<{ data: { id: number; email: string; created_at: string; updated_at: string } }>(
        `/blacklisted-emails/${encodeURIComponent(email)}`,
        { revalidate: 0 },
      );
      return res.data ?? null;
    } catch (err) {
      if (err instanceof EmailBisonApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Add a domain to the EmailBison blacklist directly.
   * POST /api/blacklisted-domains
   * Unlike addToBlacklist(leadId, 'domain'), this blacklists a domain
   * without needing an existing lead ID.
   */
  async blacklistDomain(domain: string): Promise<void> {
    await this.request<unknown>('/blacklisted-domains', {
      method: 'POST',
      body: JSON.stringify({ domain }),
      revalidate: 0,
    });
  }

  /**
   * List all blacklisted domains.
   * GET /api/blacklisted-domains
   * Auto-paginates using meta.last_page.
   */
  async listBlacklistedDomains(): Promise<Array<{ id: number; domain: string; created_at: string }>> {
    return this.getAllPages<{ id: number; domain: string; created_at: string }>('/blacklisted-domains');
  }

  /**
   * List all blacklisted emails.
   * GET /api/blacklisted-emails
   * Auto-paginates using meta.last_page.
   */
  async listBlacklistedEmails(): Promise<Array<{ id: number; email: string; created_at: string }>> {
    return this.getAllPages<{ id: number; email: string; created_at: string }>('/blacklisted-emails');
  }

  /**
   * Add an email to the EmailBison blacklist directly.
   * POST /api/blacklisted-emails
   */
  async blacklistEmail(email: string): Promise<void> {
    await this.request<unknown>('/blacklisted-emails', {
      method: 'POST',
      body: JSON.stringify({ email }),
      revalidate: 0,
    });
  }

  async deleteLead(leadId: number): Promise<void> {
    await this.request<unknown>(`/leads/${leadId}`, {
      method: 'DELETE',
      revalidate: 0,
    });
  }

  async getWorkspaceStats(startDate: string, endDate: string): Promise<{
    emails_sent: string;
    total_leads_contacted: string;
    opened: string;
    opened_percentage: string;
    unique_opens_per_contact: string;
    unique_opens_per_contact_percentage: string;
    unique_replies_per_contact: string;
    unique_replies_per_contact_percentage: string;
    bounced: string;
    bounced_percentage: string;
    unsubscribed: string;
    unsubscribed_percentage: string;
    interested: string;
    interested_percentage: string;
  }> {
    const res = await this.request<{ data: any }>(`/workspaces/v1.1/stats?start_date=${startDate}&end_date=${endDate}`, { revalidate: 300 });
    return res.data;
  }
}
