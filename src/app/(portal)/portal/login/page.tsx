"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";

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
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md py-2 px-4 text-sm font-semibold transition-colors disabled:opacity-50"
        style={{ backgroundColor: "#F0FF7A", color: "#18181b" }}
      >
        {loading ? "Sending..." : "Send Login Link"}
      </button>
    </form>
  );
}

export default function PortalLoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <OutsignalLogo className="h-8 w-auto text-foreground mx-auto" />
          <h1 className="mt-6 text-xl font-heading font-bold">Client Portal</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to view your campaign performance
          </p>
        </div>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
