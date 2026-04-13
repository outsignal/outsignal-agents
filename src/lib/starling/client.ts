// =============================================================================
// Starling Bank API Client
// https://api.starlingbank.com/api/v2
//
// Personal Access Token auth. Used for incoming payment reconciliation
// against invoices.
// =============================================================================

// =============================================================================
// Types
// =============================================================================

export interface StarlingAccount {
  accountUid: string;
  accountType: string;
  defaultCategory: string;
  currency: string;
  createdAt: string;
  name: string;
}

export interface StarlingAccountsResponse {
  accounts: StarlingAccount[];
}

export interface StarlingAmount {
  currency: string;
  minorUnits: number;
}

export interface StarlingFeedItem {
  feedItemUid: string;
  categoryUid: string;
  amount: StarlingAmount;
  sourceAmount: StarlingAmount;
  direction: "IN" | "OUT";
  updatedAt: string;
  transactionTime: string;
  settlementTime: string;
  source: string;
  status: string;
  counterPartyName: string;
  counterPartyType: string;
  reference: string;
  country: string;
  spendingCategory: string;
}

export interface StarlingFeedResponse {
  feedItems: StarlingFeedItem[];
}

export interface StarlingBalance {
  clearedBalance: StarlingAmount;
  effectiveBalance: StarlingAmount;
  pendingTransactions: StarlingAmount;
  acceptedOverdraft: StarlingAmount;
  amount: StarlingAmount;
  totalClearedBalance: StarlingAmount;
  totalEffectiveBalance: StarlingAmount;
}

// =============================================================================
// Error class
// =============================================================================

export class StarlingApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Starling API error ${status}: ${body}`);
    this.name = "StarlingApiError";
  }
}

// =============================================================================
// Client
// =============================================================================

export class StarlingClient {
  private readonly baseUrl = "https://api.starlingbank.com/api/v2";

  private get token(): string {
    const t = process.env.STARLING_API_TOKEN;
    if (!t) {
      throw new Error("STARLING_API_TOKEN not configured");
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
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });
    };

    let res = await makeRequest();

    // Retry logic: max 1 retry per request
    if (!res.ok) {
      if (res.status === 401) {
        throw new StarlingApiError(res.status, "Token expired — re-authenticate in the Starling banking app");
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
        throw new StarlingApiError(res.status, "Token expired — re-authenticate in the Starling banking app");
      }
      const body = (await res.text()).slice(0, 500);
      throw new StarlingApiError(res.status, body);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  /** GET /accounts - returns list of accounts with accountUid and defaultCategory */
  async getAccounts(): Promise<StarlingAccount[]> {
    const res = await this.request<StarlingAccountsResponse>("/accounts");
    return res.accounts;
  }

  // ---------------------------------------------------------------------------
  // Transactions (Feed Items)
  // ---------------------------------------------------------------------------

  /**
   * GET /feed/account/{accountUid}/category/{categoryUid}/transactions-between
   *
   * Returns feed items between `since` and now.
   */
  async getTransactions(
    accountUid: string,
    categoryUid: string,
    since: Date,
  ): Promise<StarlingFeedItem[]> {
    const minTs = since.toISOString();
    const maxTs = new Date().toISOString();
    const endpoint =
      `/feed/account/${accountUid}/category/${categoryUid}/transactions-between` +
      `?minTransactionTimestamp=${encodeURIComponent(minTs)}` +
      `&maxTransactionTimestamp=${encodeURIComponent(maxTs)}`;

    const res = await this.request<StarlingFeedResponse>(endpoint);
    return res.feedItems;
  }

  // ---------------------------------------------------------------------------
  // Balance
  // ---------------------------------------------------------------------------

  /** GET /accounts/{accountUid}/balance - returns current balance */
  async getBalance(accountUid: string): Promise<StarlingBalance> {
    return this.request<StarlingBalance>(
      `/accounts/${accountUid}/balance`,
    );
  }
}

// =============================================================================
// Singleton export
// =============================================================================

export const starling = new StarlingClient();
