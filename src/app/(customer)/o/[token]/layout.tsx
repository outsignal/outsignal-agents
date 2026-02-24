import { OutsignalLogo } from "@/components/brand/outsignal-logo";

export default function OnboardingInviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <OutsignalLogo className="h-8 w-auto text-gray-900" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
