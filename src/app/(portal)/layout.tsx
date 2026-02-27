import Link from "next/link";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { LogoutButton } from "@/components/portal/logout-button";
import { PortalNav } from "@/components/portal/portal-nav";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/portal">
              <OutsignalLogo className="h-7 w-auto text-foreground" iconColor="currentColor" />
            </Link>
            <PortalNav />
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
