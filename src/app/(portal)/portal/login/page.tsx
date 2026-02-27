"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    <div className="rounded-lg border bg-card p-6 text-center space-y-2">
      <p className="font-medium">Check your email</p>
      <p className="text-sm text-muted-foreground">
        We sent a login link to <strong>{email}</strong>. Click the link to sign in.
      </p>
    </div>
  ) : (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

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
        />
      </div>

      <Button
        type="submit"
        variant="brand"
        disabled={loading}
        className="w-full"
      >
        {loading ? "Sending..." : "Send Login Link"}
      </Button>
    </form>
  );
}

export default function PortalLoginPage() {
  return (
    <div
      className="min-h-screen bg-background flex items-center justify-center px-4"
      style={{
        backgroundImage:
          "radial-gradient(circle, oklch(0.9 0 0) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <Card className="w-full max-w-sm overflow-hidden">
        <div className="h-1 bg-brand rounded-t-lg" />
        <CardContent className="pt-8 pb-8 space-y-8">
          <div className="text-center">
            <OutsignalLogo
              className="h-8 w-auto text-foreground mx-auto"
              iconColor="currentColor"
            />
            <h1 className="mt-6 text-xl font-heading font-semibold tracking-tight">
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
    </div>
  );
}
