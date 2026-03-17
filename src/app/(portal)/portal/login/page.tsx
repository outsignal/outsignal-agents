"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";

function LoginForm() {
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam === "expired" ? "That link has expired. Please request a new one." : null,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        throw new Error("Too many attempts. Please wait a minute and try again.");
      }
      if (!res.ok) {
        throw new Error("Something went wrong. Please try again.");
      }

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return sent ? (
    <div className="rounded-lg border border-border/50 bg-card p-6 text-center space-y-2">
      <p className="font-medium">Check your email</p>
      <p className="text-sm text-muted-foreground">
        We sent a login link to <strong>{email}</strong>. Click the link to sign in.
      </p>
    </div>
  ) : (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <ErrorBanner message={error} />}

      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1.5">
          Email address
        </label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="h-11"
        />
      </div>

      <Button
        type="submit"
        variant="brand"
        disabled={loading}
        className="w-full h-11"
      >
        {loading ? "Sending..." : "Send Login Link"}
      </Button>
    </form>
  );
}

export default function PortalLoginPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-white via-brand/[0.03] to-brand/15">
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
              Client Portal
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to view your campaign performance
            </p>
          </div>

          <Suspense>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>

      {/* Footer */}
      <p className="absolute bottom-6 text-xs text-muted-foreground/60">
        &copy; {new Date().getFullYear()} Outsignal
      </p>
    </div>
  );
}
