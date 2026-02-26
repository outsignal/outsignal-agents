import Link from "next/link";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { LogoutButton } from "@/components/portal/logout-button";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/portal">
              <OutsignalLogo className="h-7 w-auto text-foreground" />
            </Link>
            <nav className="flex items-center gap-6">
              <Link
                href="/portal"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/portal/linkedin"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                LinkedIn
              </Link>
            </nav>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
