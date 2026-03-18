import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Building, Users, Globe } from "lucide-react";

export default async function PortalSettingsPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const [workspace, currentMember] = await Promise.all([
    prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: {
        name: true,
        slug: true,
        vertical: true,
        package: true,
        senderEmailDomains: true,
        createdAt: true,
      },
    }),
    prisma.member.findFirst({
      where: { workspaceSlug, email: session.email, status: { not: "disabled" } },
      select: { email: true, name: true },
    }),
  ]);

  if (!workspace) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-muted-foreground">
          Your workspace is being set up. Check back soon.
        </div>
      </div>
    );
  }

  // Parse senderEmailDomains JSON string
  let domains: string[] = [];
  if (workspace.senderEmailDomains) {
    try {
      const parsed = JSON.parse(workspace.senderEmailDomains);
      if (Array.isArray(parsed)) domains = parsed;
    } catch {
      // Not valid JSON, ignore
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your workspace configuration and account details
        </p>
      </div>

      {/* Workspace Details */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Building className="h-4 w-4" />
            Workspace
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <dt className="text-xs text-muted-foreground font-medium">
                Workspace Name
              </dt>
              <dd className="text-sm text-foreground mt-1 font-medium">
                {workspace.name}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground font-medium">
                Workspace ID
              </dt>
              <dd className="text-sm text-muted-foreground mt-1 font-mono">
                {workspace.slug}
              </dd>
            </div>
            {workspace.vertical && (
              <div>
                <dt className="text-xs text-muted-foreground font-medium">
                  Industry Vertical
                </dt>
                <dd className="text-sm text-foreground mt-1">
                  {workspace.vertical}
                </dd>
              </div>
            )}
            {workspace.package && (
              <div>
                <dt className="text-xs text-muted-foreground font-medium">
                  Package
                </dt>
                <dd className="mt-1">
                  <Badge variant="secondary" className="text-xs">
                    {workspace.package}
                  </Badge>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground font-medium">
                Member Since
              </dt>
              <dd className="text-sm text-muted-foreground mt-1 font-mono tabular-nums">
                {workspace.createdAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Account Contact */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Account Contact
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {currentMember ? (
              <>
                <div>
                  <dt className="text-xs text-muted-foreground font-medium">
                    Contact Email
                  </dt>
                  <dd className="text-sm text-muted-foreground mt-1 font-mono">
                    {currentMember.email}
                  </dd>
                </div>
                {currentMember.name && (
                  <div>
                    <dt className="text-xs text-muted-foreground font-medium">
                      Name
                    </dt>
                    <dd className="text-sm text-foreground mt-1">
                      {currentMember.name}
                    </dd>
                  </div>
                )}
              </>
            ) : (
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground">
                  No contact details configured. Contact your Outsignal account manager to update.
                </p>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Sending Domains */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Sending Domains
          </CardTitle>
        </CardHeader>
        <CardContent>
          {domains.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {domains.map((domain) => (
                <Badge key={domain} variant="outline" className="text-xs font-mono">
                  {domain}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No sending domains configured yet. Your account manager will set these up for your campaigns.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Support */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Support
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Need to update your settings or have questions about your account?
            Contact your Outsignal account manager for assistance.
          </p>
          <a
            href="mailto:support@outsignal.ai"
            className="inline-flex mt-3 text-sm text-brand hover:text-brand-strong font-medium transition-colors"
          >
            support@outsignal.ai
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
