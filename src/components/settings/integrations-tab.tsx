"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function IntegrationsTab() {
  const router = useRouter();

  useEffect(() => {
    router.push("/system-uptime");
  }, [router]);

  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      Redirecting to System Uptime...
    </div>
  );
}
