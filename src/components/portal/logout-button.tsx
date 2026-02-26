"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/portal/login");
  };

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      Sign Out
    </button>
  );
}
