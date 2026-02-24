"use client";

import { ONBOARDING_STEPS } from "./onboarding-steps";
import { TypeformEngine } from "./typeform-engine";

interface OnboardingClientProps {
  proposalToken?: string;
  inviteToken?: string;
  createWorkspace?: boolean;
  prefillName?: string;
  prefillEmail?: string;
}

export function OnboardingClient({
  proposalToken,
  inviteToken,
  createWorkspace = true,
  prefillName,
  prefillEmail,
}: OnboardingClientProps) {
  const prefill: Record<string, unknown> = {};
  const readOnlyFields: string[] = [];

  if (prefillName) {
    prefill.name = prefillName;
    readOnlyFields.push("name");
  }
  if (prefillEmail) {
    prefill.notificationEmails = prefillEmail;
  }

  async function handleComplete(answers: Record<string, unknown>) {
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...answers,
        ...(proposalToken ? { proposalToken } : {}),
        ...(inviteToken ? { onboardingInviteToken: inviteToken } : {}),
        createWorkspace,
        senderEmailDomains: answers.domains || [],
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to submit onboarding");
    }
  }

  return (
    <TypeformEngine
      steps={ONBOARDING_STEPS}
      onComplete={handleComplete}
      prefill={prefill}
      readOnlyFields={readOnlyFields}
    />
  );
}
