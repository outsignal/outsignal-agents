import { prisma } from "@/lib/db";
import { iproyal } from "@/lib/iproyal/client";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IPRoyalTestButton } from "./iproyal-test-button";

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface IPRoyalData {
  configured: boolean;
  connected: boolean;
  balance: number | null;
  totalOrders: number;
  activeProxies: {
    senderName: string;
    senderEmail: string | null;
    workspaceSlug: string;
    workspaceName: string;
    orderId: string;
    expireDate: string | null;
    autoExtend: boolean;
    status: string;
  }[];
  error?: string;
}

async function getIPRoyalData(): Promise<IPRoyalData> {
  const apiKey = process.env.IPROYAL_API_KEY;

  if (!apiKey) {
    return {
      configured: false,
      connected: false,
      balance: null,
      totalOrders: 0,
      activeProxies: [],
      error: "IPROYAL_API_KEY not configured",
    };
  }

  // Fetch balance, orders from IPRoyal API, and senders from DB in parallel
  const [balanceResult, ordersResult, senders] = await Promise.allSettled([
    iproyal.getBalance(),
    iproyal.getOrders({ status: "confirmed", per_page: 100 }),
    prisma.sender.findMany({
      where: { iproyalOrderId: { not: null } },
      select: {
        id: true,
        name: true,
        emailAddress: true,
        iproyalOrderId: true,
        workspaceSlug: true,
        workspace: { select: { name: true } },
      },
    }),
  ]);

  const balance =
    balanceResult.status === "fulfilled" ? balanceResult.value : null;
  const connected = balanceResult.status === "fulfilled";
  const orders =
    ordersResult.status === "fulfilled" ? ordersResult.value.data : [];
  const totalOrders = orders.length;
  const senderList =
    senders.status === "fulfilled" ? senders.value : [];

  // Build a map of orderId -> order details from IPRoyal
  const orderMap = new Map<string, (typeof orders)[0]>();
  for (const order of orders) {
    orderMap.set(String(order.id), order);
  }

  // Build active proxies list from DB senders, enriched with IPRoyal order data
  const activeProxies = senderList.map((sender) => {
    const order = sender.iproyalOrderId
      ? orderMap.get(sender.iproyalOrderId)
      : undefined;

    return {
      senderName: sender.name,
      senderEmail: sender.emailAddress,
      workspaceSlug: sender.workspaceSlug,
      workspaceName: sender.workspace.name,
      orderId: sender.iproyalOrderId!,
      expireDate: order?.expire_date ?? null,
      autoExtend: order?.auto_extend_settings?.is_enabled ?? false,
      status: order?.status ?? "unknown",
    };
  });

  return {
    configured: true,
    connected,
    balance,
    totalOrders,
    activeProxies,
    error:
      balanceResult.status === "rejected"
        ? String(balanceResult.reason)
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function IntegrationsPage() {
  const data = await getIPRoyalData();
  const monthlyEstimate = data.activeProxies.length * 4;

  return (
    <div>
      <Header
        title="Integrations"
        description="Third-party service connections and proxy management"
      />

      <div className="p-6 space-y-6">
        {/* IPRoyal Card */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-[#635BFF]/10">
                  <svg
                    className="h-5 w-5 text-[#635BFF]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A8.966 8.966 0 013 12c0-1.97.633-3.794 1.708-5.274"
                    />
                  </svg>
                </div>
                <div>
                  <CardTitle className="text-base">IPRoyal Proxies</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Residential proxy management for LinkedIn senders
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <IPRoyalTestButton />
                {data.configured ? (
                  data.connected ? (
                    <Badge variant="success" dot>
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="warning" dot>
                      Error
                    </Badge>
                  )
                ) : (
                  <Badge variant="destructive" dot>
                    Not Configured
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-6 py-4 border-b border-border/50 mb-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Balance</p>
                <p className="text-xl font-semibold tabular-nums">
                  {data.balance != null ? formatUSD(data.balance) : "--"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Active Proxies
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {data.activeProxies.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Monthly Spend (est.)
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {formatUSD(monthlyEstimate)}
                </p>
              </div>
            </div>

            {/* Active proxies table */}
            {data.activeProxies.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sender</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Auto-extend</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.activeProxies.map((proxy) => (
                    <TableRow key={proxy.orderId}>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">
                            {proxy.senderName}
                          </p>
                          {proxy.senderEmail && (
                            <p className="text-xs text-muted-foreground">
                              {proxy.senderEmail}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {proxy.workspaceName}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">
                        {proxy.orderId}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(proxy.expireDate)}
                      </TableCell>
                      <TableCell>
                        {proxy.autoExtend ? (
                          <Badge variant="success" size="xs">
                            On
                          </Badge>
                        ) : (
                          <Badge variant="secondary" size="xs">
                            Off
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={proxy.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {data.configured
                  ? "No senders have proxies assigned yet"
                  : "Configure IPROYAL_API_KEY to get started"}
              </div>
            )}

            {data.error && data.configured && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <p className="text-xs text-destructive">{data.error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge sub-component
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "confirmed":
      return (
        <Badge variant="success" size="xs">
          Active
        </Badge>
      );
    case "in-progress":
      return (
        <Badge variant="warning" size="xs">
          Provisioning
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="destructive" size="xs">
          Expired
        </Badge>
      );
    case "unpaid":
      return (
        <Badge variant="destructive" size="xs">
          Unpaid
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" size="xs">
          {status}
        </Badge>
      );
  }
}
