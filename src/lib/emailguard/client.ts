// =============================================================================
// EmailGuard API Client
// https://app.emailguard.io/api/v1
//
// Rewritten 2026-04-02 to match current EmailGuard OpenAPI spec.
// =============================================================================

import type {
  Domain,
  BlacklistCheck,
  SurblCheck,
  SpamhausResponse,
  DmarcDomain,
  DmarcInsight,
  DmarcSource,
  DmarcFailure,
  SpfLookupResult,
  DkimLookupResult,
  DmarcLookupResult,
  InboxTest,
  SpamFilterTest,
  SpamCheckResult,
  DomainHostLookupResult,
  EmailHostLookupResult,
  EmailGuardListResponse,
  EmailGuardSingleResponse,
  EmailGuardWorkspace,
  EmailAccount,
  ContactList,
} from "./types";

// =============================================================================
// Error class
// =============================================================================

export class EmailGuardApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`EmailGuard API error ${status}: ${body}`);
    this.name = "EmailGuardApiError";
  }
}

// =============================================================================
// Client
// =============================================================================

export class EmailGuardClient {
  private readonly baseUrl = "https://app.emailguard.io/api/v1";
  private lastRequestTime = 0;
  private static readonly MIN_INTERVAL_MS = 500; // 500ms for paid tier

  private get token(): string {
    const t = process.env.EMAILGUARD_API_TOKEN;
    if (!t) {
      throw new Error("EMAILGUARD_API_TOKEN not configured");
    }
    return t;
  }

  // ---------------------------------------------------------------------------
  // Core request helper
  // ---------------------------------------------------------------------------

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < EmailGuardClient.MIN_INTERVAL_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, EmailGuardClient.MIN_INTERVAL_MS - elapsed),
      );
    }
    this.lastRequestTime = Date.now();
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    await this.throttle();

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new EmailGuardApiError(res.status, body);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ---------------------------------------------------------------------------
  // Domain Management
  // ---------------------------------------------------------------------------

  async listDomains(): Promise<Domain[]> {
    const res = await this.request<EmailGuardListResponse<Domain>>("/domains");
    return res.data;
  }

  async createDomain(domainName: string): Promise<Domain> {
    const res = await this.request<EmailGuardSingleResponse<Domain>>(
      "/domains",
      {
        method: "POST",
        body: JSON.stringify({ name: domainName }),
      },
    );
    return res.data;
  }

  async getDomain(uuid: string): Promise<Domain> {
    const res = await this.request<EmailGuardSingleResponse<Domain>>(
      `/domains/${uuid}`,
    );
    return res.data;
  }

  async deleteDomain(uuid: string): Promise<void> {
    await this.request<void>(`/domains/delete/${uuid}`, { method: "DELETE" });
  }

  /** Trigger SPF check for a registered domain */
  async checkSpf(uuid: string): Promise<Record<string, unknown>> {
    const res = await this.request<EmailGuardSingleResponse<Record<string, unknown>>>(
      `/domains/spf-record/${uuid}`,
      { method: "PATCH" },
    );
    return res.data;
  }

  /** Trigger DKIM check for a registered domain */
  async checkDkim(
    uuid: string,
    dkimSelectors: string[] = ["google"],
  ): Promise<Record<string, unknown>> {
    const res = await this.request<EmailGuardSingleResponse<Record<string, unknown>>>(
      `/domains/dkim-records/${uuid}`,
      {
        method: "PATCH",
        body: JSON.stringify({ dkim_selectors: dkimSelectors }),
      },
    );
    return res.data;
  }

  /** Trigger DMARC check for a registered domain */
  async checkDmarc(uuid: string): Promise<Record<string, unknown>> {
    const res = await this.request<EmailGuardSingleResponse<Record<string, unknown>>>(
      `/domains/dmarc-record/${uuid}`,
      { method: "PATCH" },
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Email Authentication (DNS Lookups)
  // ---------------------------------------------------------------------------

  /**
   * SPF lookup via EmailGuard.
   * Note: the API accepts the domain in the request body on a GET endpoint.
   */
  async spfLookup(domain: string): Promise<SpfLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<SpfLookupResult>>(
      "/email-authentication/spf-lookup",
      {
        method: "GET",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  /**
   * DKIM lookup via EmailGuard.
   * Note: the API accepts domain + selector in the request body on a GET endpoint.
   */
  async dkimLookup(
    domain: string,
    selector: string,
  ): Promise<DkimLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<DkimLookupResult>>(
      "/email-authentication/dkim-lookup",
      {
        method: "GET",
        body: JSON.stringify({ domain, selector }),
      },
    );
    return res.data;
  }

  /**
   * DMARC lookup via EmailGuard.
   * Note: the API accepts the domain in the request body on a GET endpoint.
   */
  async dmarcLookup(domain: string): Promise<DmarcLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<DmarcLookupResult>>(
      "/email-authentication/dmarc-lookup",
      {
        method: "GET",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Blacklist Monitoring
  // ---------------------------------------------------------------------------

  async listDomainBlacklists(): Promise<BlacklistCheck[]> {
    const res =
      await this.request<EmailGuardListResponse<BlacklistCheck>>(
        "/blacklist-checks/domains",
      );
    return res.data;
  }

  async listEmailBlacklists(): Promise<BlacklistCheck[]> {
    const res =
      await this.request<EmailGuardListResponse<BlacklistCheck>>(
        "/blacklist-checks/email-accounts",
      );
    return res.data;
  }

  async runAdHocBlacklist(domainOrIp: string): Promise<BlacklistCheck> {
    const res = await this.request<EmailGuardSingleResponse<BlacklistCheck>>(
      "/blacklist-checks/ad-hoc",
      {
        method: "POST",
        body: JSON.stringify({ domain_or_ip: domainOrIp }),
      },
    );
    return res.data;
  }

  async getBlacklistCheck(id: number): Promise<BlacklistCheck> {
    const res = await this.request<EmailGuardSingleResponse<BlacklistCheck>>(
      `/blacklist-checks/${id}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // SURBL Checks
  // ---------------------------------------------------------------------------

  async listSurblChecks(): Promise<SurblCheck[]> {
    const res =
      await this.request<EmailGuardListResponse<SurblCheck>>(
        "/surbl-blacklist-checks/domains",
      );
    return res.data;
  }

  async runSurblCheck(domain: string): Promise<SurblCheck> {
    const res = await this.request<EmailGuardSingleResponse<SurblCheck>>(
      "/surbl-blacklist-checks",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getSurblCheck(uuid: string): Promise<SurblCheck> {
    const res = await this.request<EmailGuardSingleResponse<SurblCheck>>(
      `/surbl-blacklist-checks/${uuid}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Spamhaus Intelligence (all async — create queues job, poll show for results)
  // ---------------------------------------------------------------------------

  // -- A Record Reputation --
  async listARecordReputation(): Promise<SpamhausResponse[]> {
    const res = await this.request<EmailGuardListResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/a-record-reputation",
    );
    return res.data;
  }

  async checkARecordReputation(domain: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/a-record-reputation",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getARecordReputation(uuid: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      `/spamhaus-intelligence/a-record-reputation/${uuid}`,
    );
    return res.data;
  }

  // -- Domain Context --
  async listDomainContexts(): Promise<SpamhausResponse[]> {
    const res = await this.request<EmailGuardListResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/domain-contexts",
    );
    return res.data;
  }

  async checkDomainContext(domain: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/domain-contexts",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getDomainContext(uuid: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      `/spamhaus-intelligence/domain-contexts/${uuid}`,
    );
    return res.data;
  }

  // -- Domain Reputation (4 credits per check) --
  async listDomainReputation(): Promise<SpamhausResponse[]> {
    const res = await this.request<EmailGuardListResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/domain-reputation",
    );
    return res.data;
  }

  async checkDomainReputation(domain: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/domain-reputation",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getDomainReputation(uuid: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      `/spamhaus-intelligence/domain-reputation/${uuid}`,
    );
    return res.data;
  }

  // -- Domain Senders --
  async listDomainSenders(): Promise<SpamhausResponse[]> {
    const res = await this.request<EmailGuardListResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/domain-senders",
    );
    return res.data;
  }

  async checkDomainSenders(domain: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/domain-senders",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getDomainSenders(uuid: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      `/spamhaus-intelligence/domain-senders/${uuid}`,
    );
    return res.data;
  }

  // -- Nameserver Reputation --
  async listNameserverReputation(): Promise<SpamhausResponse[]> {
    const res = await this.request<EmailGuardListResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/nameserver-reputation",
    );
    return res.data;
  }

  async checkNameserverReputation(domain: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      "/spamhaus-intelligence/nameserver-reputation",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getNameserverReputation(uuid: string): Promise<SpamhausResponse> {
    const res = await this.request<EmailGuardSingleResponse<SpamhausResponse>>(
      `/spamhaus-intelligence/nameserver-reputation/${uuid}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // DMARC Reports
  // ---------------------------------------------------------------------------

  async listDmarcDomains(): Promise<DmarcDomain[]> {
    const res =
      await this.request<EmailGuardListResponse<DmarcDomain>>(
        "/dmarc-reports",
      );
    return res.data;
  }

  /**
   * Get DMARC insights for a domain.
   * Note: the API accepts date range in the request body on a GET endpoint.
   */
  async getDmarcInsights(
    domainUuid: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DmarcInsight> {
    const body: Record<string, string> = {};
    if (startDate) body.start_date = startDate;
    if (endDate) body.end_date = endDate;

    const res = await this.request<EmailGuardSingleResponse<DmarcInsight>>(
      `/dmarc-reports/domains/${domainUuid}/insights`,
      Object.keys(body).length > 0
        ? { method: "GET", body: JSON.stringify(body) }
        : undefined,
    );
    return res.data;
  }

  /**
   * Get DMARC sources for a domain.
   * Note: the API accepts date range in the request body on a GET endpoint.
   */
  async getDmarcSources(
    domainUuid: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DmarcSource[]> {
    const body: Record<string, string> = {};
    if (startDate) body.start_date = startDate;
    if (endDate) body.end_date = endDate;

    const res = await this.request<EmailGuardListResponse<DmarcSource>>(
      `/dmarc-reports/domains/${domainUuid}/dmarc-sources`,
      Object.keys(body).length > 0
        ? { method: "GET", body: JSON.stringify(body) }
        : undefined,
    );
    return res.data;
  }

  /**
   * Get DMARC failures for a domain.
   * Note: the API accepts date range in the request body on a GET endpoint.
   */
  async getDmarcFailures(
    domainUuid: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DmarcFailure[]> {
    const body: Record<string, string> = {};
    if (startDate) body.start_date = startDate;
    if (endDate) body.end_date = endDate;

    const res = await this.request<EmailGuardListResponse<DmarcFailure>>(
      `/dmarc-reports/domains/${domainUuid}/dmarc-failures`,
      Object.keys(body).length > 0
        ? { method: "GET", body: JSON.stringify(body) }
        : undefined,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Content Spam Check
  // ---------------------------------------------------------------------------

  async checkContentSpam(content: string): Promise<SpamCheckResult> {
    const res = await this.request<EmailGuardSingleResponse<SpamCheckResult>>(
      "/content-spam-check",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Inbox Placement Tests
  // ---------------------------------------------------------------------------

  async listInboxTests(): Promise<InboxTest[]> {
    const res =
      await this.request<EmailGuardListResponse<InboxTest>>(
        "/inbox-placement-tests",
      );
    return res.data;
  }

  async createInboxTest(params: { name: string }): Promise<InboxTest> {
    const res = await this.request<EmailGuardSingleResponse<InboxTest>>(
      "/inbox-placement-tests",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
    );
    return res.data;
  }

  async getInboxTest(id: number | string): Promise<InboxTest> {
    const res = await this.request<EmailGuardSingleResponse<InboxTest>>(
      `/inbox-placement-tests/${id}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Spam Filter Tests
  // ---------------------------------------------------------------------------

  async listSpamFilterTests(): Promise<SpamFilterTest[]> {
    const res =
      await this.request<EmailGuardListResponse<SpamFilterTest>>(
        "/spam-filter-tests",
      );
    return res.data;
  }

  async createSpamFilterTest(params: { name: string }): Promise<SpamFilterTest> {
    const res = await this.request<EmailGuardSingleResponse<SpamFilterTest>>(
      "/spam-filter-tests",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
    );
    return res.data;
  }

  async getSpamFilterTest(uuid: string): Promise<SpamFilterTest> {
    const res = await this.request<EmailGuardSingleResponse<SpamFilterTest>>(
      `/spam-filter-tests/${uuid}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Email Accounts
  // ---------------------------------------------------------------------------

  async listEmailAccounts(): Promise<EmailAccount[]> {
    const res =
      await this.request<EmailGuardListResponse<EmailAccount>>(
        "/email-accounts",
      );
    return res.data;
  }

  async getEmailAccount(id: number | string): Promise<EmailAccount> {
    const res = await this.request<EmailGuardSingleResponse<EmailAccount>>(
      `/email-accounts/${id}`,
    );
    return res.data;
  }

  async deleteEmailAccount(uuid: string): Promise<void> {
    await this.request<void>(`/email-accounts/delete/${uuid}`, {
      method: "DELETE",
    });
  }

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  async listWorkspaces(): Promise<EmailGuardWorkspace[]> {
    const res = await this.request<EmailGuardListResponse<EmailGuardWorkspace>>(
      "/workspaces",
    );
    return res.data;
  }

  async getCurrentWorkspace(): Promise<EmailGuardWorkspace> {
    const res = await this.request<EmailGuardSingleResponse<EmailGuardWorkspace>>(
      "/workspaces/current",
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Contact Verification (may be legacy — not in current OpenAPI spec)
  // ---------------------------------------------------------------------------

  async listContactLists(): Promise<ContactList[]> {
    const res =
      await this.request<EmailGuardListResponse<ContactList>>(
        "/contact-verification",
      );
    return res.data;
  }

  async createContactVerification(params: {
    name: string;
    emails: string[];
  }): Promise<ContactList> {
    const res = await this.request<EmailGuardSingleResponse<ContactList>>(
      "/contact-verification",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
    );
    return res.data;
  }

  async getContactList(uuid: string): Promise<ContactList> {
    const res = await this.request<EmailGuardSingleResponse<ContactList>>(
      `/contact-verification/${uuid}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Host Lookups
  // ---------------------------------------------------------------------------

  async domainHostLookup(domain: string): Promise<DomainHostLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<DomainHostLookupResult>>(
      "/domain-host-lookup",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async emailHostLookup(email: string): Promise<EmailHostLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<EmailHostLookupResult>>(
      "/email-host-lookup",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
    );
    return res.data;
  }
}

// =============================================================================
// Singleton export
// =============================================================================

export const emailguard = new EmailGuardClient();
