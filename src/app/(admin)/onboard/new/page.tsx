"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const PACKAGES = [
  { value: "email", label: "Email Outbound" },
  { value: "linkedin", label: "LinkedIn Outbound" },
  { value: "email_linkedin", label: "Email + LinkedIn" },
];

const DEFAULT_PRICING: Record<
  string,
  { setupFee: number; platformCost: number; retainerCost: number }
> = {
  email: { setupFee: 0, platformCost: 450, retainerCost: 1050 },
  linkedin: { setupFee: 1500, platformCost: 350, retainerCost: 850 },
  email_linkedin: { setupFee: 1500, platformCost: 800, retainerCost: 1900 },
};

export default function CreateProposalPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [packageType, setPackageType] = useState("email");
  const [setupFee, setSetupFee] = useState(0);
  const [platformCost, setPlatformCost] = useState(450);
  const [retainerCost, setRetainerCost] = useState(1050);

  function handlePackageChange(pkg: string) {
    setPackageType(pkg);
    const defaults = DEFAULT_PRICING[pkg];
    if (defaults) {
      setSetupFee(defaults.setupFee);
      setPlatformCost(defaults.platformCost);
      setRetainerCost(defaults.retainerCost);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: form.get("clientName"),
          clientEmail: form.get("clientEmail") || null,
          companyOverview: form.get("companyOverview"),
          packageType,
          setupFee: setupFee * 100, // convert pounds to pence
          platformCost: platformCost * 100,
          retainerCost: retainerCost * 100,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create proposal");
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
        <Header title="Proposal Created" />
        <div className="p-8 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">
                Proposal link ready
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Share this link with your client to view the proposal:
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={createdUrl} className="font-mono text-sm" />
                <Button onClick={handleCopy} variant="outline">
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={() => router.push("/onboard")}>
                  Back to Proposals
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
      <Header title="Create Proposal" description="Set up a new client proposal" />
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
                  If provided, the proposal link will be emailed automatically
                </p>
              </div>
              <div>
                <Label htmlFor="companyOverview">Company Overview *</Label>
                <Textarea
                  id="companyOverview"
                  name="companyOverview"
                  required
                  rows={4}
                  placeholder="Brief description of the client's business, goals, and why they need outbound..."
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Package & Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Package Type</Label>
                <div className="mt-2 flex gap-2">
                  {PACKAGES.map((pkg) => (
                    <Button
                      key={pkg.value}
                      type="button"
                      variant={
                        packageType === pkg.value ? "default" : "outline"
                      }
                      onClick={() => handlePackageChange(pkg.value)}
                      className="flex-1"
                    >
                      {pkg.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="setupFee">Setup Fee (£)</Label>
                  <Input
                    id="setupFee"
                    type="number"
                    min={0}
                    value={setupFee}
                    onChange={(e) => setSetupFee(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="platformCost">Platform (£/mo)</Label>
                  <Input
                    id="platformCost"
                    type="number"
                    min={0}
                    value={platformCost}
                    onChange={(e) => setPlatformCost(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="retainerCost">Retainer (£/mo)</Label>
                  <Input
                    id="retainerCost"
                    type="number"
                    min={0}
                    value={retainerCost}
                    onChange={(e) => setRetainerCost(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-muted p-4 text-sm">
                <div className="flex justify-between">
                  <span>Monthly Total</span>
                  <span className="font-bold">
                    £{(platformCost + retainerCost).toLocaleString()}/mo
                  </span>
                </div>
                {setupFee > 0 && (
                  <div className="mt-1 flex justify-between text-muted-foreground">
                    <span>Setup Fee (one-off)</span>
                    <span>£{setupFee.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating..." : "Create Proposal"}
          </Button>
        </form>
      </div>
    </div>
  );
}
