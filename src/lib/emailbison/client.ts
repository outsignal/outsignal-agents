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
  CustomVariable,
  CreateLeadResult,
  CampaignCreateResult,
} from "./types";

class EmailBisonApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Email Bison API error ${status}: ${body}`);
    this.name = "EmailBisonApiError";
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

  private async request<T>(
    endpoint: string,
    options?: RequestInit & { revalidate?: number },
  ): Promise<T> {
    const { revalidate = 300, ...fetchOptions } = options ?? {};

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

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new RateLimitError(Number(retryAfter) || 60);
    }

    if (!res.ok) {
      throw new EmailBisonApiError(res.status, await res.text());
    }

    return res.json();
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

  async getCampaigns(): Promise<Campaign[]> {
    return this.getAllPages<Campaign>("/campaigns");
  }

  async getReplies(): Promise<Reply[]> {
    return this.getAllPages<Reply>("/replies");
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
    return this.getAllPages<SequenceStep>(
      `/campaigns/sequence-steps?campaign_id=${campaignId}`,
    );
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
}
