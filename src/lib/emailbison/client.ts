import type {
  PaginatedResponse,
  Campaign,
  Lead,
  Reply,
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
} from "./types";
import { EmailBisonError } from "./types";

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

export class EmailBisonClient {
  private baseUrl = "https://app.outsignal.ai/api";

  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private static readonly RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
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

  async getSequenceSteps(campaignId: number): Promise<SequenceStep[]> {
    const res = await this.request<{ data: Record<string, unknown>[] } | Record<string, unknown>[]>(
      `/campaigns/${campaignId}/sequence-steps`,
    );
    // API returns non-paginated response with snake_case fields
    const raw = Array.isArray(res) ? res : (res.data ?? []);
    return raw.map((s) => ({
      id: s.id as number,
      campaign_id: (s.campaign_id ?? campaignId) as number,
      position: (s.order ?? s.position ?? 0) as number,
      subject: (s.email_subject ?? s.subject ?? "") as string,
      body: (s.email_body ?? s.body ?? "") as string,
      delay_days: (s.wait_in_days ?? s.delay_days ?? 0) as number,
    }));
  }

  async createSequenceStep(
    campaignId: number,
    step: CreateSequenceStepParams,
  ): Promise<SequenceStep> {
    const res = await this.request<{ data: SequenceStep }>(
      `/campaigns/${campaignId}/sequence-steps`,
      {
        method: 'POST',
        body: JSON.stringify({
          position: step.position,
          subject: step.subject,
          body: step.body,
          delay_days: step.delay_days ?? 1,
        }),
        revalidate: 0,
      },
    );
    return res.data;
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
    const res = await this.request<{ data: CampaignCreateResult }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        type: params.type ?? 'outbound',
        max_emails_per_day: params.maxEmailsPerDay ?? 1000,
        max_new_leads_per_day: params.maxNewLeadsPerDay ?? 100,
        plain_text: params.plainText ?? true,
      }),
      revalidate: 0,
    });
    return res.data;
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
    if (params.firstName) body.first_name = params.firstName;
    if (params.lastName) body.last_name = params.lastName;
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
    const existingNames = new Set(existing.map(v => v.name));
    for (const name of names) {
      if (!existingNames.has(name)) {
        await this.createCustomVariable(name);
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

  async deleteLead(leadId: number): Promise<void> {
    await this.request<unknown>(`/leads/${leadId}`, {
      method: 'DELETE',
      revalidate: 0,
    });
  }
}
