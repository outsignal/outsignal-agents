"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Invalid password");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="light relative min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-white via-brand/[0.03] to-brand/15" style={{ colorScheme: "light" }}>
      {/* Secondary gradient wash */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at 75% 90%, oklch(0.55 0.25 280 / 0.12), transparent),
            radial-gradient(ellipse 40% 40% at 20% 15%, oklch(0.7 0.15 300 / 0.06), transparent)
          `,
        }}
      />

      {/* Top-left logo */}
      <OutsignalLogo
        variant="wordmark"
        className="absolute top-8 left-8 h-7 w-auto text-foreground"
      />

      {/* Login card */}
      <Card className="relative w-full max-w-md rounded-xl border border-border/50 shadow-xl">
        <CardContent className="px-8 pt-10 pb-10 space-y-8">
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Admin Dashboard
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to access the admin dashboard
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && <ErrorBanner message={error} />}

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                autoFocus
                className="h-11"
              />
            </div>

            <Button
              type="submit"
              variant="brand"
              disabled={loading}
              className="w-full h-11"
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Footer */}
      <p className="absolute bottom-6 text-xs text-muted-foreground/60">
        &copy; {new Date().getFullYear()} Outsignal
      </p>
    </div>
  );
}
