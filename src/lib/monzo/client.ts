// =============================================================================
// Monzo Bank API Client
// https://api.monzo.com
//
// OAuth access token auth. Used for cost tracking and expense categorisation.
// =============================================================================

// =============================================================================
// Types
// =============================================================================

export interface MonzoAccount {
  id: string;
  description: string;
  created: string;
  type: string;
  currency: string;
  country_code: string;
  closed: boolean;
}

export interface MonzoAccountsResponse {
  accounts: MonzoAccount[];
}

export interface MonzoMerchant {
  id: string;
  group_id: string;
  name: string;
  category: string;
  logo: string;
}

export interface MonzoTransaction {
  id: string;
  created: string;
  description: string;
  amount: number; // minor units, negative for outgoing
  currency: string;
  merchant: MonzoMerchant | null;
  notes: string;
  metadata: Record<string, string>;
  category: string;
  settled: string;
  local_amount: number;
  local_currency: string;
  is_load: boolean;
  decline_reason: string;
}

export interface MonzoTransactionsResponse {
  transactions: MonzoTransaction[];
}

export interface MonzoBalance {
  balance: number; // minor units
  total_balance: number;
  balance_including_flexible_savings: number;
  currency: string;
  spend_today: number;
  local_currency: string;
  local_exchange_rate: number;
  local_spend: MonzoLocalSpend[];
}

export interface MonzoLocalSpend {
  spend_today: number;
  currency: string;
}

// =============================================================================
// Error class
// =============================================================================

export class MonzoApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Monzo API error ${status}: ${body}`);
    this.name = "MonzoApiError";
  }
}

// =============================================================================
// Client
// =============================================================================

export class MonzoClient {
  private readonly baseUrl = "https://api.monzo.com";

  private get token(): string {
    const t = process.env.MONZO_API_TOKEN;
    if (!t) {
      throw new Error("MONZO_API_TOKEN not configured");
    }
    return t;
  }

  // ---------------------------------------------------------------------------
  // Core request helper
  // ---------------------------------------------------------------------------

  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const makeRequest = async (): Promise<Response> => {
      return fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...options?.headers,
        },
      });
    };

    let res = await makeRequest();

    // Retry logic: max 1 retry per request
    if (!res.ok) {
      if (res.status === 401) {
        throw new MonzoApiError(res.status, "Token expired — re-authenticate in the Monzo banking app");
      }

      if (res.status === 429) {
        // Rate limited: retry once after 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));
        res = await makeRequest();
      } else if (res.status >= 500 && res.status <= 503) {
        // Server error: retry once after 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));
        res = await makeRequest();
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        throw new MonzoApiError(res.status, "Token expired — re-authenticate in the Monzo banking app");
      }
      const body = (await res.text()).slice(0, 500);
      throw new MonzoApiError(res.status, body);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  /** GET /accounts - returns list of accounts */
  async getAccounts(): Promise<MonzoAccount[]> {
    const res = await this.request<MonzoAccountsResponse>("/accounts");
    return res.accounts;
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  /**
   * GET /transactions?account_id={accountId}&since={since}
   *
   * Returns transactions since the given date.
   * Monzo limits to 90 days of transaction history for non-current accounts.
   */
  async getTransactions(
    accountId: string,
    since: Date,
  ): Promise<MonzoTransaction[]> {
    const sinceStr = since.toISOString();
    const endpoint =
      `/transactions?account_id=${encodeURIComponent(accountId)}` +
      `&since=${encodeURIComponent(sinceStr)}` +
      `&expand[]=merchant`;

    const res = await this.request<MonzoTransactionsResponse>(endpoint);
    return res.transactions;
  }

  // ---------------------------------------------------------------------------
  // Balance
  // ---------------------------------------------------------------------------

  /** GET /balance?account_id={accountId} - returns balance */
  async getBalance(accountId: string): Promise<MonzoBalance> {
    return this.request<MonzoBalance>(
      `/balance?account_id=${encodeURIComponent(accountId)}`,
    );
  }
}

// =============================================================================
// Singleton export
// =============================================================================

export const monzo = new MonzoClient();
