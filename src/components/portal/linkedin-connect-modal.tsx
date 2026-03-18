"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Shield,
  KeyRound,
  Puzzle,
  ArrowLeft,
  Check,
  X,
  Loader2,
  Info,
  ChevronDown,
  ChevronUp,
  Lock,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionMethod = "infinite" | "credentials" | "extension";

type Step =
  | "choose"
  | "twofa-check"
  | "twofa-guide"
  | "form"
  | "loading"
  | "result";

interface PortalConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  senderId: string;
  senderName: string;
}

interface FormState {
  email: string;
  password: string;
  totpSecret: string;
}

interface ResultState {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METHOD_OPTIONS: {
  id: ConnectionMethod;
  label: string;
  description: string;
  icon: typeof Shield;
  recommended?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
}[] = [
  {
    id: "infinite",
    label: "Infinite Login",
    description:
      "Stay always connected. No more disconnections or paused campaigns. Requires your LinkedIn credentials and a 2FA secret key.",
    icon: Shield,
    recommended: true,
  },
  {
    id: "credentials",
    label: "Credentials Login",
    description:
      "Quick connect with just your email and password. May disconnect periodically.",
    icon: KeyRound,
  },
  {
    id: "extension",
    label: "Connect with Extension",
    description: "Use a Chrome extension to import your existing session.",
    icon: Puzzle,
    disabled: true,
    disabledLabel: "Coming soon",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortalConnectModal({
  open,
  onOpenChange,
  senderId,
  senderName,
}: PortalConnectModalProps) {
  const [step, setStep] = useState<Step>("choose");
  const [method, setMethod] = useState<ConnectionMethod>("infinite");
  const [form, setForm] = useState<FormState>({
    email: "",
    password: "",
    totpSecret: "",
  });
  const [result, setResult] = useState<ResultState | null>(null);

  // ---- helpers ----

  function resetState() {
    setStep("choose");
    setMethod("infinite");
    setForm({ email: "", password: "", totpSecret: "" });
    setResult(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (step === "loading") return;
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  }

  function selectMethod(m: ConnectionMethod) {
    setMethod(m);
    if (m === "infinite") {
      setStep("twofa-check");
    } else {
      setStep("form");
    }
  }

  function handleBackFromForm() {
    if (method === "infinite") {
      setStep("twofa-check");
    } else {
      setStep("choose");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStep("loading");

    try {
      const loginMethod = method as "credentials" | "infinite";
      const res = await fetch("/api/portal/linkedin/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          senderId,
          method: loginMethod,
          email: form.email,
          password: form.password,
          totpSecret: method === "infinite" ? form.totpSecret : undefined,
        }),
      });
      const data = await res.json();

      if (!data.success && String(data.error ?? "").includes("2fa")) {
        if (method === "infinite") {
          setResult({
            success: false,
            error:
              "Your 2FA secret key appears to be invalid. Please check it and try again.",
          });
        } else {
          setResult({
            success: false,
            error:
              'This LinkedIn account has two-factor authentication enabled. Please go back and use "Infinite Login" with your 2FA secret key to stay always connected.',
          });
        }
        setStep("result");
        return;
      }

      setResult(data);
      setStep("result");
    } catch (err) {
      setResult({
        success: false,
        error:
          err instanceof Error ? err.message : "An unexpected error occurred",
      });
      setStep("result");
    }
  }

  // ---- render ----

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={step !== "loading"}
        onPointerDownOutside={(e) => {
          if (step === "loading") e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (step === "loading") e.preventDefault();
        }}
      >
        {step === "choose" && (
          <ChooseStep senderName={senderName} onSelect={selectMethod} />
        )}
        {step === "twofa-check" && (
          <TwoFACheckStep
            onYes={() => setStep("form")}
            onNo={() => setStep("twofa-guide")}
            onBack={() => setStep("choose")}
          />
        )}
        {step === "twofa-guide" && (
          <TwoFAGuideStep
            onNext={() => setStep("form")}
            onBack={() => setStep("twofa-check")}
          />
        )}
        {step === "form" && (
          <FormStep
            method={method}
            form={form}
            setForm={setForm}
            onBack={handleBackFromForm}
            onSubmit={handleSubmit}
          />
        )}
        {step === "loading" && <LoadingStep />}
        {step === "result" && result && (
          <ResultStep
            result={result}
            onDone={() => {
              resetState();
              onOpenChange(false);
            }}
            onRetry={() => setStep("form")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Choose connection method
// ---------------------------------------------------------------------------

function ChooseStep({
  senderName,
  onSelect,
}: {
  senderName: string;
  onSelect: (m: ConnectionMethod) => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect LinkedIn Account</DialogTitle>
        <DialogDescription>
          Choose how to connect {senderName}&apos;s LinkedIn account
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 pt-2">
        {METHOD_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isDisabled = opt.disabled;

          return (
            <button
              key={opt.id}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(opt.id)}
              className={`relative flex items-start gap-4 rounded-lg border p-4 text-left transition-colors ${
                isDisabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:border-foreground/25 hover:bg-accent/50"
              }`}
            >
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon className="size-5 text-muted-foreground" />
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{opt.label}</span>
                  {opt.recommended && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase leading-none text-brand-foreground">
                      Recommended
                    </span>
                  )}
                  {isDisabled && opt.disabledLabel && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase leading-none text-muted-foreground">
                      {opt.disabledLabel}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {opt.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — 2FA Check (Infinite Login only)
// ---------------------------------------------------------------------------

function TwoFACheckStep({
  onYes,
  onNo,
  onBack,
}: {
  onYes: () => void;
  onNo: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </button>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
        </div>
      </DialogHeader>

      <div className="flex flex-col gap-4 pt-2">
        <p className="text-sm text-muted-foreground">
          Do you have two-factor authentication (2FA) set up on your LinkedIn
          account?
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onYes}
            className="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors cursor-pointer hover:border-foreground/25 hover:bg-accent/50"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-100">
              <Check className="size-4 text-emerald-600" />
            </div>
            <div className="space-y-0.5">
              <span className="text-sm font-semibold">
                Yes, I have 2FA with an authenticator app
              </span>
              <p className="text-xs text-muted-foreground">
                I have my 2FA secret key ready
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={onNo}
            className="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors cursor-pointer hover:border-foreground/25 hover:bg-accent/50"
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100">
              <Info className="size-4 text-amber-600" />
            </div>
            <div className="space-y-0.5">
              <span className="text-sm font-semibold">
                No, I need to set it up
              </span>
              <p className="text-xs text-muted-foreground">
                I&apos;ll walk you through it — takes 60 seconds
              </p>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — 2FA Setup Guide (if user doesn't have 2FA)
// ---------------------------------------------------------------------------

function TwoFAGuideStep({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const steps = [
    <>
      Go to LinkedIn, click your <strong>profile picture</strong> in the top
      right
    </>,
    <>
      Open <strong>Settings &amp; Privacy</strong> from the dropdown
    </>,
    <>
      Click <strong>Sign in &amp; security</strong>, then{" "}
      <strong>Two-step verification</strong>
    </>,
    <>
      Click <strong>Set up</strong>, choose <strong>Authenticator app</strong> as
      your method, and click <strong>Continue</strong>
    </>,
    <>
      You&apos;ll see a QR code and a text key &mdash;{" "}
      <strong>copy the text key</strong> (this is your 2FA secret key)
    </>,
  ];

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </button>
          <DialogTitle>Set up LinkedIn 2FA in 60 seconds</DialogTitle>
        </div>
      </DialogHeader>

      <div className="flex flex-col gap-4 pt-2">
        <ol className="space-y-2.5 text-sm">
          {steps.map((content, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand mt-0.5">
                {i + 1}
              </span>
              <span className="text-muted-foreground leading-relaxed">
                {content}
              </span>
            </li>
          ))}
        </ol>

        {/* Annotated illustration */}
        <div className="rounded-lg border bg-muted/30 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/linkedin-2fa-guide.png"
            alt="LinkedIn 2FA setup screen showing where to find your secret key"
            className="w-full rounded"
          />
        </div>

        {/* Callout box */}
        <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            <strong>Important:</strong> Save this key somewhere safe &mdash;
            LinkedIn only shows it once. You&apos;ll need to paste it in the
            next step.
          </p>
        </div>

        <Button
          type="button"
          variant="brand"
          className="w-full"
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Login form (enhanced)
// ---------------------------------------------------------------------------

function FormStep({
  method,
  form,
  setForm,
  onBack,
  onSubmit,
}: {
  method: ConnectionMethod;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const [showWhatIs2FA, setShowWhatIs2FA] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
          >
            <ArrowLeft className="size-4" />
            <span className="sr-only">Back</span>
          </button>
          <DialogTitle>Enter LinkedIn Credentials</DialogTitle>
        </div>
      </DialogHeader>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 pt-2">
        {/* Email field */}
        <div className="space-y-2">
          <Label htmlFor="li-email">LinkedIn Email</Label>
          <Input
            id="li-email"
            type="email"
            required
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, email: e.target.value }))
            }
          />
          <p className="text-xs text-muted-foreground">
            The email address you use to log in to LinkedIn
          </p>
        </div>

        {/* Password field */}
        <div className="space-y-2">
          <Label htmlFor="li-password" className="flex items-center gap-1.5">
            <Lock className="size-3.5 text-muted-foreground" />
            LinkedIn Password
          </Label>
          <Input
            id="li-password"
            type="password"
            required
            placeholder="Enter your password"
            value={form.password}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, password: e.target.value }))
            }
          />
        </div>

        {/* 2FA Secret Key field (Infinite Login only) */}
        {method === "infinite" && (
          <div className="space-y-2">
            <Label htmlFor="li-totp">2FA Secret Key</Label>

            {/* Expandable: What's a 2FA secret key? */}
            <button
              type="button"
              onClick={() => setShowWhatIs2FA((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Info className="size-3.5" />
              <span>What&apos;s a 2FA secret key?</span>
              {showWhatIs2FA ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>

            {showWhatIs2FA && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-1.5 dark:border-blue-900/50 dark:bg-blue-950/30">
                <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
                  Your 2FA secret key is a long code (like{" "}
                  <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px] dark:bg-blue-900/50">
                    JBSWY3DPEHPK3PXP
                  </code>
                  ) that LinkedIn shows once when you set up two-factor
                  authentication with an authenticator app.
                </p>
                <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
                  It is <strong>NOT</strong> the 6-digit code that changes every
                  30 seconds &mdash; it&apos;s the permanent key used to
                  generate those codes.
                </p>
              </div>
            )}

            <Input
              id="li-totp"
              type="text"
              placeholder="e.g. JBSWY3DPEHPK3PXP"
              value={form.totpSecret}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, totpSecret: e.target.value }))
              }
            />

            {/* Expandable: Can't find your key? */}
            <button
              type="button"
              onClick={() => setShowRecovery((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Can&apos;t find your 2FA secret key?</span>
              {showRecovery ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>

            {showRecovery && (
              <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  If you set up 2FA using SMS or lost your secret key, you&apos;ll
                  need to:
                </p>
                <ol className="space-y-1 text-xs text-muted-foreground list-none">
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground/70">1.</span>
                    Go to LinkedIn &rarr; Settings &amp; Privacy &rarr; Sign in
                    &amp; security &rarr; Two-step verification
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground/70">2.</span>
                    Click <strong>Turn off</strong> to disable 2FA
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground/70">3.</span>
                    Re-enable it using <strong>Authenticator app</strong> (not
                    SMS)
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground/70">4.</span>
                    Copy the secret key shown during setup
                  </li>
                </ol>
                <p className="text-xs text-muted-foreground/80 italic">
                  Don&apos;t worry &mdash; this only takes a minute and won&apos;t
                  affect your LinkedIn account.
                </p>
              </div>
            )}
          </div>
        )}

        <Button type="submit" className="mt-2 w-full" variant="brand">
          Connect Account
        </Button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Loading
// ---------------------------------------------------------------------------

function LoadingStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <Loader2 className="size-10 animate-spin text-muted-foreground" />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium">Connecting to LinkedIn...</p>
        <p className="text-xs text-muted-foreground">
          This may take up to 30 seconds
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Result
// ---------------------------------------------------------------------------

function ResultStep({
  result,
  onDone,
  onRetry,
}: {
  result: ResultState;
  onDone: () => void;
  onRetry: () => void;
}) {
  if (result.success) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
          <Check className="size-7 text-emerald-600" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-base font-semibold">Connected Successfully</p>
          <p className="text-sm text-muted-foreground">
            Your LinkedIn account is now linked and ready to use.
          </p>
        </div>
        <Button onClick={onDone} className="mt-2" variant="brand">
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
        <X className="size-7 text-red-600" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-base font-semibold">Connection Failed</p>
        <p className="text-sm text-muted-foreground">
          {result.error ?? "Something went wrong. Please try again."}
        </p>
      </div>
      <Button onClick={onRetry} variant="outline" className="mt-2">
        Try Again
      </Button>
    </div>
  );
}
