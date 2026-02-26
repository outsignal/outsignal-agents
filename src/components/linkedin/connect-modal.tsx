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
} from "lucide-react";
import { connectLinkedIn } from "@/lib/linkedin/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionMethod = "infinite" | "credentials" | "extension";

type Step = "choose" | "form" | "loading" | "result";

interface ConnectModalProps {
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
      "Stay always connected with your LinkedIn credentials and 2FA secret key.",
    icon: Shield,
    recommended: true,
  },
  {
    id: "credentials",
    label: "Credentials Login",
    description: "Connect with your LinkedIn email and password.",
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

export function ConnectModal({
  open,
  onOpenChange,
  senderId,
  senderName,
}: ConnectModalProps) {
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
    // Block closing during loading
    if (step === "loading") return;
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  }

  function selectMethod(m: ConnectionMethod) {
    setMethod(m);
    setStep("form");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStep("loading");

    try {
      const loginMethod = method as "credentials" | "infinite";
      const res = await connectLinkedIn(senderId, loginMethod, {
        email: form.email,
        password: form.password,
        totpSecret: method === "infinite" ? form.totpSecret : undefined,
      });

      // 2FA detected — guide user to Infinite Login
      if (!res.success && String(res.error ?? "").includes("2fa")) {
        if (method === "infinite") {
          // Already using infinite login but TOTP failed
          setResult({
            success: false,
            error: "Your 2FA secret key appears to be invalid. Please check it and try again.",
          });
        } else {
          // Using credentials login — needs TOTP secret
          setResult({
            success: false,
            error: "This LinkedIn account has two-factor authentication enabled. Please go back and use \"Infinite Login\" with your 2FA secret key to stay always connected.",
          });
        }
        setStep("result");
        return;
      }

      setResult(res);
      setStep("result");
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "An unexpected error occurred",
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
        {step === "choose" && <ChooseStep senderName={senderName} onSelect={selectMethod} />}
        {step === "form" && (
          <FormStep
            method={method}
            form={form}
            setForm={setForm}
            onBack={() => setStep("choose")}
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
                    <span className="rounded-full bg-[#F0FF7A] px-2 py-0.5 text-[10px] font-semibold uppercase leading-none text-black">
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
// Step 2 — Login form
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
        <div className="space-y-2">
          <Label htmlFor="li-email">LinkedIn Email</Label>
          <Input
            id="li-email"
            type="email"
            required
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="li-password">LinkedIn Password</Label>
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

        {method === "infinite" && (
          <div className="space-y-2">
            <Label htmlFor="li-totp">2FA Secret Key</Label>
            <Input
              id="li-totp"
              type="text"
              placeholder="e.g. JBSWY3DPEHPK3PXP"
              value={form.totpSecret}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, totpSecret: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Find this in LinkedIn Settings &rarr; Sign in &amp; security &rarr;
              Two-step verification &rarr; Authenticator app. Copy the secret key
              shown during setup.
            </p>
          </div>
        )}

        <Button
          type="submit"
          className="mt-2 w-full bg-[#F0FF7A] text-black hover:bg-[#d9e66e]"
        >
          Connect Account
        </Button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Loading
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
// Step 4 — Result
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
        <Button
          onClick={onDone}
          className="mt-2 bg-[#F0FF7A] text-black hover:bg-[#d9e66e]"
        >
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
      <Button
        onClick={onRetry}
        variant="outline"
        className="mt-2"
      >
        Try Again
      </Button>
    </div>
  );
}

