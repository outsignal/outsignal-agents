"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Loader2, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { provisionProxy } from "@/lib/linkedin/actions";

interface ProxyStatusCellProps {
  senderId: string;
  proxyUrl: string | null;
  iproyalOrderId: string | null;
}

export function ProxyStatusCell({
  senderId,
  proxyUrl,
  iproyalOrderId,
}: ProxyStatusCellProps) {
  const router = useRouter();
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleProvision() {
    setProvisioning(true);
    setError(null);

    try {
      const result = await provisionProxy(senderId);

      if (!result.success) {
        setError(result.error || "Provisioning failed");
        return;
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to provision proxy");
    } finally {
      setProvisioning(false);
    }
  }

  // Active proxy via IPRoyal
  if (proxyUrl && iproyalOrderId) {
    const proxyHost = extractHost(proxyUrl);
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Badge variant="success" dot className="text-xs cursor-default">
                <ShieldCheck className="size-3" />
                Proxy Active
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="space-y-1">
              <p className="font-medium">IPRoyal Residential Proxy</p>
              <p className="opacity-70">Host: {proxyHost}</p>
              <p className="opacity-70">Order: {iproyalOrderId}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Manual proxy (has URL but no IPRoyal order)
  if (proxyUrl && !iproyalOrderId) {
    const proxyHost = extractHost(proxyUrl);
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Badge variant="info" dot className="text-xs cursor-default">
                <Shield className="size-3" />
                Manual Proxy
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="space-y-1">
              <p className="font-medium">Manually configured proxy</p>
              <p className="opacity-70">Host: {proxyHost}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // No proxy
  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="text-xs">
        <ShieldOff className="size-3" />
        No Proxy
      </Badge>
      <button
        onClick={handleProvision}
        disabled={provisioning}
        className="inline-flex items-center rounded-md border border-[#635BFF]/30 bg-[#635BFF]/5 px-2 py-1 text-[11px] font-medium text-[#635BFF] hover:bg-[#635BFF]/10 hover:border-[#635BFF]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {provisioning ? (
          <>
            <Loader2 className="size-3 mr-1 animate-spin" />
            Provisioning...
          </>
        ) : (
          "Provision"
        )}
      </button>
      {error && (
        <span className="text-[11px] text-destructive max-w-[160px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Extract host:port from a proxy URL like http://user:pass@host:port */
function extractHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "—"}`;
  } catch {
    // Fallback for non-standard proxy URLs
    const match = url.match(/@([^/]+)/);
    return match?.[1] ?? url.slice(0, 30);
  }
}
