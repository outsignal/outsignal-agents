import { getPortalSession } from "@/lib/portal-session";
import { ThemeProvider } from "@/components/theme-provider";
import { PortalAppShell } from "@/components/portal/portal-app-shell";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session: { workspaceSlug: string; email: string } | null = null;
  try {
    session = await getPortalSession();
  } catch {
    // Not authenticated — render without shell (login page)
  }

  if (session) {
    return (
      <ThemeProvider>
        <PortalAppShell workspaceSlug={session.workspaceSlug}>
          {children}
        </PortalAppShell>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider forcedTheme="light">
      <div className="min-h-screen bg-background">{children}</div>
    </ThemeProvider>
  );
}
