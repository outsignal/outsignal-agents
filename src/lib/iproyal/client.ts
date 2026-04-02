export interface IPRoyalProduct {
  id: number;
  name: string;
  plans: {
    id: number;
    name: string;
    price: number;
    min_quantity: number;
    max_quantity: number;
  }[];
  locations: {
    id: number;
    name: string;
    out_of_stock: boolean;
    child_locations: unknown[];
  }[];
  questions: {
    id: number;
    text: string;
    is_required: boolean;
  }[];
  quantity_discounts: {
    quantity_from: number;
    discount_percent: number;
  }[];
}

export interface IPRoyalPricing {
  pre_discount_price: number;
  price_with_vat: number;
  vat: number | null;
  price: number;
  pre_discount_price_per_item: number;
  price_per_item: number;
  plan_discount_percent: number;
  location_discount_percent: number;
  coupon_discount_percent: number;
  quantity_discount_percent: number;
  total_discount_percent: number;
  quantity_required_for_next_discount: {
    quantity: number;
    discount: number;
  } | null;
  message: string | null;
}

export interface IPRoyalOrder {
  id: number;
  note: string | null;
  product_name: string;
  plan_name: string;
  expire_date: string;
  status: "unpaid" | "in-progress" | "confirmed" | "refunded" | "expired";
  location: string;
  locations: string;
  quantity: number;
  proxy_data: {
    ports: { socks5: number; "http|https": number };
    proxies: (string | Record<string, unknown>)[];
  };
  auto_extend_settings: {
    order_id: number;
    is_enabled: boolean;
    product_plan_id: number;
    payment_type: string;
    card_id: number | null;
  } | null;
  extended_history: unknown[];
}

export interface IPRoyalAutoExtendSettings {
  order_id: number;
  is_enabled: boolean;
  product_plan_id: number;
  payment_type: string;
  card_id: number | null;
}

export interface ProxyCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  url: string;
}

export class IPRoyalApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`IPRoyal API error ${status}: ${body}`);
    this.name = "IPRoyalApiError";
  }
}

export class IPRoyalClient {
  private baseUrl = "https://apid.iproyal.com/v1/reseller";
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.IPROYAL_API_KEY;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error(
        "IPROYAL_API_KEY environment variable is not set",
      );
    }

    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const res = await fetch(url, {
      method,
      headers: {
        "X-Access-Token": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw new IPRoyalApiError(res.status, text);
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async getProducts(): Promise<IPRoyalProduct[]> {
    const res = await this.request<{ data: IPRoyalProduct[] }>("GET", "/products");
    return res.data;
  }

  async calculatePricing(params: {
    product_id: number;
    product_plan_id: number;
    product_location_id: number;
    quantity: number;
    coupon_code?: string;
  }): Promise<IPRoyalPricing> {
    const queryParams: Record<string, string> = {
      product_id: String(params.product_id),
      product_plan_id: String(params.product_plan_id),
      product_location_id: String(params.product_location_id),
      quantity: String(params.quantity),
    };
    if (params.coupon_code) {
      queryParams.coupon_code = params.coupon_code;
    }
    return this.request<IPRoyalPricing>("GET", "/orders/calculate-pricing", undefined, queryParams);
  }

  async createOrder(params: {
    product_id: number;
    product_plan_id: number;
    product_location_id: number;
    quantity: number;
    auto_extend?: boolean;
    coupon_code?: string;
  }): Promise<IPRoyalOrder> {
    return this.request<IPRoyalOrder>("POST", "/orders", params);
  }

  async getOrders(params?: {
    product_id?: number;
    status?: string;
    page?: number;
    per_page?: number;
  }): Promise<{
    data: IPRoyalOrder[];
    meta: { current_page: number; total: number; last_page: number };
  }> {
    const queryParams: Record<string, string> = {};
    if (params?.product_id) queryParams.product_id = String(params.product_id);
    if (params?.status) queryParams.status = params.status;
    if (params?.page) queryParams.page = String(params.page);
    if (params?.per_page) queryParams.per_page = String(params.per_page);

    return this.request("GET", "/orders", undefined, Object.keys(queryParams).length ? queryParams : undefined);
  }

  async getOrder(orderId: number): Promise<IPRoyalOrder> {
    return this.request<IPRoyalOrder>("GET", `/orders/${orderId}`);
  }

  async extendOrder(orderId: number, productPlanId: number): Promise<IPRoyalOrder> {
    return this.request<IPRoyalOrder>("POST", `/orders/${orderId}/extend`, {
      product_plan_id: productPlanId,
    });
  }

  async toggleAutoExtend(params: {
    order_id: number;
    is_enabled: boolean;
    product_plan_id?: number;
    payment_type?: string;
  }): Promise<IPRoyalAutoExtendSettings> {
    return this.request<IPRoyalAutoExtendSettings>(
      "POST",
      "/orders/toggle-auto-extend",
      params,
    );
  }

  async changeCredentials(params: {
    order_id: number;
    proxies: string[];
    username?: string;
    password?: string;
    random_password?: boolean;
    is_reset?: boolean;
  }): Promise<void> {
    await this.request<unknown>("POST", "/orders/proxies/change-credentials", params);
  }

  async getBalance(): Promise<number> {
    return this.request<number>("GET", "/balance");
  }
}

export function parseProxyCredentials(order: IPRoyalOrder): ProxyCredentials | null {
  if (!order.proxy_data?.proxies?.length) return null;

  const proxy = order.proxy_data.proxies[0];

  // Handle object format (IPRoyal API sometimes returns objects instead of strings)
  if (typeof proxy === "object" && proxy !== null) {
    const obj = proxy as Record<string, unknown>;
    const host = String(obj.ip ?? obj.host ?? "");
    const port = Number(obj.port ?? order.proxy_data.ports["http|https"] ?? 0);
    const username = String(obj.username ?? "");
    const password = String(obj.password ?? "");
    if (!host || !port || !username || !password) return null;
    return {
      host,
      port,
      username,
      password,
      url: `http://${username}:${password}@${host}:${port}`,
    };
  }

  // Handle string format: "host:port:username:password"
  if (typeof proxy !== "string") return null;

  const parts = proxy.split(":");
  if (parts.length < 4) return null;

  const host = parts[0];
  const port = order.proxy_data.ports["http|https"] || Number(parts[1]);
  const username = parts[2];
  const password = parts.slice(3).join(":");

  return {
    host,
    port,
    username,
    password,
    url: `http://${username}:${password}@${host}:${port}`,
  };
}

export const iproyal = new IPRoyalClient();

export default IPRoyalClient;
