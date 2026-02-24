"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function CreateOnboardingInvitePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/onboarding-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: form.get("clientName"),
          clientEmail: form.get("clientEmail") || null,
          createWorkspace: form.get("createWorkspace") === "on",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create invite");
      }

      const data = await res.json();
      setCreatedUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (createdUrl) {
    return (
      <div>
        <Header title="Invite Created" />
        <div className="p-8 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">
                Onboarding link ready
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Share this link with your client to complete their onboarding:
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={createdUrl} className="font-mono text-sm" />
                <Button onClick={handleCopy} variant="outline">
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={() => router.push("/onboarding")}>
                  Back to Onboarding
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open(createdUrl, "_blank")}
                >
                  Preview
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header
        title="Create Onboarding Invite"
        description="Send the onboarding questionnaire to a client"
      />
      <div className="p-8 max-w-2xl">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Client Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="clientName">Client Name *</Label>
                <Input
                  id="clientName"
                  name="clientName"
                  required
                  placeholder="e.g. BlankTag Media"
                />
              </div>
              <div>
                <Label htmlFor="clientEmail">Client Email</Label>
                <Input
                  id="clientEmail"
                  name="clientEmail"
                  type="email"
                  placeholder="client@company.com"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  If provided, the onboarding link will be emailed automatically
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="createWorkspace"
                  name="createWorkspace"
                  defaultChecked
                  className="h-4 w-4 rounded border-input"
                />
                <Label htmlFor="createWorkspace" className="font-normal">
                  Create workspace on completion
                </Label>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Uncheck if you only need to collect onboarding info without setting up a workspace
              </p>
            </CardContent>
          </Card>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating..." : "Create Invite"}
          </Button>
        </form>
      </div>
    </div>
  );
}
