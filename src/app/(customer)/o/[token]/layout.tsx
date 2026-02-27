import { OutsignalLogo } from "@/components/brand/outsignal-logo";

export default function OnboardingInviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <div className="h-0.5 bg-brand" />
      <header className="border-b px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <OutsignalLogo className="h-8 w-auto text-gray-900" iconColor="currentColor" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
