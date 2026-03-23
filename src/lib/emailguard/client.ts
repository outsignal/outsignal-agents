// =============================================================================
// EmailGuard API Client
// https://app.emailguard.io/api/v1
// =============================================================================

import type {
  Domain,
  SpfResult,
  DkimResult,
  DmarcResult,
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
  ContactList,
  HostLookupResult,
  EmailGuardListResponse,
  EmailGuardSingleResponse,
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
  private static readonly MIN_INTERVAL_MS = 1000;

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

  async createDomain(domain: string): Promise<Domain> {
    const res = await this.request<EmailGuardSingleResponse<Domain>>(
      "/domains",
      {
        method: "POST",
        body: JSON.stringify({ domain, name: domain }),
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
    await this.request<void>(`/domains/${uuid}`, { method: "DELETE" });
  }

  async checkSpf(uuid: string): Promise<SpfResult> {
    const res = await this.request<EmailGuardSingleResponse<SpfResult>>(
      `/domains/${uuid}/check-spf`,
      { method: "POST" },
    );
    return res.data;
  }

  async checkDkim(uuid: string): Promise<DkimResult> {
    const res = await this.request<EmailGuardSingleResponse<DkimResult>>(
      `/domains/${uuid}/check-dkim`,
      { method: "POST" },
    );
    return res.data;
  }

  async checkDmarc(uuid: string): Promise<DmarcResult> {
    const res = await this.request<EmailGuardSingleResponse<DmarcResult>>(
      `/domains/${uuid}/check-dmarc`,
      { method: "POST" },
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Blacklist Monitoring
  // ---------------------------------------------------------------------------

  async listDomainBlacklists(): Promise<BlacklistCheck[]> {
    const res =
      await this.request<EmailGuardListResponse<BlacklistCheck>>(
        "/blacklist/domains",
      );
    return res.data;
  }

  async listEmailBlacklists(): Promise<BlacklistCheck[]> {
    const res =
      await this.request<EmailGuardListResponse<BlacklistCheck>>(
        "/blacklist/emails",
      );
    return res.data;
  }

  async runAdHocBlacklist(domain: string): Promise<BlacklistCheck> {
    const res = await this.request<EmailGuardSingleResponse<BlacklistCheck>>(
      "/blacklist/check",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getBlacklistCheck(id: number): Promise<BlacklistCheck> {
    const res = await this.request<EmailGuardSingleResponse<BlacklistCheck>>(
      `/blacklist/${id}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // SURBL Checks
  // ---------------------------------------------------------------------------

  async listSurblChecks(): Promise<SurblCheck[]> {
    const res =
      await this.request<EmailGuardListResponse<SurblCheck>>("/surbl");
    return res.data;
  }

  async runSurblCheck(domain: string): Promise<SurblCheck> {
    const res = await this.request<EmailGuardSingleResponse<SurblCheck>>(
      "/surbl/check",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
    return res.data;
  }

  async getSurblCheck(uuid: string): Promise<SurblCheck> {
    const res = await this.request<EmailGuardSingleResponse<SurblCheck>>(
      `/surbl/${uuid}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Spamhaus Intelligence
  // ---------------------------------------------------------------------------

  async listARecordReputation(): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>("/spamhaus/a-record-reputation");
  }

  async checkARecordReputation(domain: string): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>(
      "/spamhaus/a-record-reputation/check",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
  }

  async listDomainContexts(): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>("/spamhaus/domain-context");
  }

  async checkDomainContext(domain: string): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>("/spamhaus/domain-context/check", {
      method: "POST",
      body: JSON.stringify({ domain }),
    });
  }

  async listDomainReputation(): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>("/spamhaus/domain-reputation");
  }

  async checkDomainReputation(domain: string): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>(
      "/spamhaus/domain-reputation/check",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
  }

  async listDomainSenders(): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>("/spamhaus/domain-senders");
  }

  async checkDomainSenders(domain: string): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>("/spamhaus/domain-senders/check", {
      method: "POST",
      body: JSON.stringify({ domain }),
    });
  }

  async listNameserverReputation(): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>("/spamhaus/nameserver-reputation");
  }

  async checkNameserverReputation(domain: string): Promise<SpamhausResponse> {
    return this.request<SpamhausResponse>(
      "/spamhaus/nameserver-reputation/check",
      {
        method: "POST",
        body: JSON.stringify({ domain }),
      },
    );
  }

  // ---------------------------------------------------------------------------
  // DMARC Reports
  // ---------------------------------------------------------------------------

  async listDmarcDomains(): Promise<DmarcDomain[]> {
    const res =
      await this.request<EmailGuardListResponse<DmarcDomain>>(
        "/dmarc/domains",
      );
    return res.data;
  }

  async getDmarcInsights(uuid: string): Promise<DmarcInsight> {
    const res = await this.request<EmailGuardSingleResponse<DmarcInsight>>(
      `/dmarc/domains/${uuid}/insights`,
    );
    return res.data;
  }

  async getDmarcSources(uuid: string): Promise<DmarcSource[]> {
    const res = await this.request<EmailGuardListResponse<DmarcSource>>(
      `/dmarc/domains/${uuid}/sources`,
    );
    return res.data;
  }

  async getDmarcFailures(uuid: string): Promise<DmarcFailure[]> {
    const res = await this.request<EmailGuardListResponse<DmarcFailure>>(
      `/dmarc/domains/${uuid}/failures`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Email Authentication (DNS Lookups)
  // ---------------------------------------------------------------------------

  async spfLookup(domain: string): Promise<SpfLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<SpfLookupResult>>(
      `/auth/spf?domain=${encodeURIComponent(domain)}`,
    );
    return res.data;
  }

  async dkimLookup(
    domain: string,
    selector: string,
  ): Promise<DkimLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<DkimLookupResult>>(
      `/auth/dkim?domain=${encodeURIComponent(domain)}&selector=${encodeURIComponent(selector)}`,
    );
    return res.data;
  }

  async dmarcLookup(domain: string): Promise<DmarcLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<DmarcLookupResult>>(
      `/auth/dmarc?domain=${encodeURIComponent(domain)}`,
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Inbox Tests
  // ---------------------------------------------------------------------------

  async listInboxTests(): Promise<InboxTest[]> {
    const res =
      await this.request<EmailGuardListResponse<InboxTest>>("/inbox-tests");
    return res.data;
  }

  async createInboxTest(params: {
    subject: string;
    body: string;
    from_email: string;
  }): Promise<InboxTest> {
    const res = await this.request<EmailGuardSingleResponse<InboxTest>>(
      "/inbox-tests",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
    );
    return res.data;
  }

  async getInboxTest(id: number): Promise<InboxTest> {
    const res = await this.request<EmailGuardSingleResponse<InboxTest>>(
      `/inbox-tests/${id}`,
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

  async createSpamFilterTest(params: {
    subject: string;
    body: string;
  }): Promise<SpamFilterTest> {
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
  // Content Spam Check
  // ---------------------------------------------------------------------------

  async checkContentSpam(content: string): Promise<SpamCheckResult> {
    const res = await this.request<EmailGuardSingleResponse<SpamCheckResult>>(
      "/content/spam-check",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    );
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Contact Verification
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

  async downloadContactList(uuid: string): Promise<Blob> {
    await this.throttle();

    const res = await fetch(
      `${this.baseUrl}/contact-verification/${uuid}/download`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/octet-stream",
        },
      },
    );

    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new EmailGuardApiError(res.status, body);
    }

    this.lastRequestTime = Date.now();
    return res.blob();
  }

  // ---------------------------------------------------------------------------
  // Host Lookups
  // ---------------------------------------------------------------------------

  async domainHostLookup(domain: string): Promise<HostLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<HostLookupResult>>(
      `/host/domain?domain=${encodeURIComponent(domain)}`,
    );
    return res.data;
  }

  async emailHostLookup(email: string): Promise<HostLookupResult> {
    const res = await this.request<EmailGuardSingleResponse<HostLookupResult>>(
      `/host/email?email=${encodeURIComponent(email)}`,
    );
    return res.data;
  }
}

// =============================================================================
// Singleton export
// =============================================================================

export const emailguard = new EmailGuardClient();
