"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Step, StepField } from "./onboarding-steps";
import { DomainStep } from "./domain-step";

interface TypeformEngineProps {
  steps: Step[];
  onComplete: (answers: Record<string, unknown>) => Promise<void>;
  prefill?: Record<string, unknown>;
  readOnlyFields?: string[];
}

export function TypeformEngine({
  steps,
  onComplete,
  prefill = {},
  readOnlyFields = [],
}: TypeformEngineProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>(prefill);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const progress = ((currentStep + 1) / steps.length) * 100;
  const isMultiField = step?.fields && step.fields.length > 0;

  // Focus first input on step change
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [currentStep]);

  const goNext = useCallback(() => {
    if (!step) return;

    // Validate required fields
    if (step.fields && step.fields.length > 0) {
      for (const field of step.fields) {
        if (field.required && !answers[field.id]) {
          setError(`${field.label} is required`);
          return;
        }
      }
    } else if (step.required && !answers[step.id]) {
      setError("This field is required");
      return;
    }
    setError(null);

    if (isLast) {
      setSubmitting(true);
      onComplete(answers)
        .then(() => setDone(true))
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Submission failed");
          setSubmitting(false);
        });
      return;
    }

    setDirection("forward");
    setCurrentStep((s) => s + 1);
  }, [step, answers, isLast, onComplete]);

  const goBack = useCallback(() => {
    if (currentStep === 0) return;
    setError(null);
    setDirection("backward");
    setCurrentStep((s) => s - 1);
  }, [currentStep]);

  // Keyboard handler — disable Enter-to-submit for multi-field and textarea steps
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && !e.shiftKey) {
        if (step?.type === "textarea" || isMultiField) return;
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, step?.type, isMultiField]);

  function updateAnswer(fieldId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    setError(null);
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
          <svg
            className="h-10 w-10 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">
          Onboarding Complete!
        </h1>
        <p className="mt-3 text-lg text-gray-600">
          Thank you — we&apos;ll be in touch shortly to get your campaigns
          started.
        </p>
      </div>
    );
  }

  if (!step) return null;

  // Render a single field input
  function renderField(
    field: { id: string; type: string; placeholder?: string; label?: string; description?: string },
    ref?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  ) {
    const isReadOnly = readOnlyFields.includes(field.id);

    if (field.type === "checkbox") {
      return (
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={!!answers[field.id]}
            onChange={(e) => updateAnswer(field.id, e.target.checked)}
            className="h-5 w-5 rounded border-gray-300 accent-[#635BFF]"
          />
          <span className="text-base text-gray-700">{field.label || "Yes"}</span>
        </label>
      );
    }

    if (field.type === "textarea") {
      return (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={(answers[field.id] as string) || ""}
          onChange={(e) => updateAnswer(field.id, e.target.value)}
          placeholder={field.placeholder}
          readOnly={isReadOnly}
          rows={3}
          className="w-full resize-none border-0 border-b-2 border-gray-300 bg-transparent px-0 pb-2 text-lg text-gray-900 placeholder:text-gray-300 focus:border-[#635BFF] focus:outline-none focus:ring-0"
        />
      );
    }

    return (
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        type={field.type === "email" ? "email" : "text"}
        value={(answers[field.id] as string) || ""}
        onChange={(e) => updateAnswer(field.id, e.target.value)}
        placeholder={field.placeholder}
        readOnly={isReadOnly}
        className="w-full border-0 border-b-2 border-gray-300 bg-transparent px-0 pb-2 text-lg text-gray-900 placeholder:text-gray-300 focus:border-[#635BFF] focus:outline-none focus:ring-0"
      />
    );
  }

  const isReadOnly = readOnlyFields.includes(step.id);
  const hasRequiredFields = step.fields?.some((f) => f.required) || step.required;

  return (
    <div className="relative min-h-screen">
      {/* Progress bar */}
      <div className="fixed left-0 right-0 top-0 z-50 h-1 bg-gray-200">
        <div
          className="h-full bg-[#635BFF] transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Back button */}
      {currentStep > 0 && (
        <button
          onClick={goBack}
          className="fixed left-6 top-6 z-40 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </button>
      )}

      {/* Step counter */}
      <div className="fixed right-6 top-6 z-40 text-sm text-gray-400">
        {currentStep + 1} / {steps.length}
      </div>

      {/* Main content */}
      <div
        key={currentStep}
        className={`flex min-h-screen flex-col items-center justify-center px-6 ${
          direction === "forward"
            ? "animate-slide-up"
            : "animate-slide-down"
        }`}
      >
        <div className="w-full max-w-xl">
          {/* Question */}
          <h2 className="text-2xl font-bold text-gray-900 md:text-3xl">
            {step.question}
          </h2>
          {step.description && (
            <p className="mt-2 text-base text-gray-500">{step.description}</p>
          )}

          {/* Input(s) */}
          <div className="mt-8">
            {step.type === "custom" && step.id === "domains" ? (
              <DomainStep
                website={(answers.website as string) || ""}
                selectedDomains={(answers.domains as string[]) || []}
                onChange={(domains) => updateAnswer("domains", domains)}
              />
            ) : isMultiField ? (
              <div className="space-y-6">
                {step.fields!.map((field: StepField, i: number) => (
                  <div key={field.id}>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      {field.label}
                      {field.required && <span className="ml-1 text-red-500">*</span>}
                    </label>
                    {field.description && (
                      <p className="mb-1.5 text-xs text-gray-400">{field.description}</p>
                    )}
                    {renderField(
                      field,
                      i === 0 ? inputRef : undefined,
                    )}
                  </div>
                ))}
              </div>
            ) : step.type === "checkbox" ? (
              renderField({ id: step.id, type: "checkbox", label: "Yes" })
            ) : step.type === "textarea" ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={(answers[step.id] as string) || ""}
                onChange={(e) => updateAnswer(step.id, e.target.value)}
                placeholder={step.placeholder}
                readOnly={isReadOnly}
                rows={4}
                className="w-full resize-none border-0 border-b-2 border-gray-300 bg-transparent px-0 pb-2 text-xl text-gray-900 placeholder:text-gray-300 focus:border-[#635BFF] focus:outline-none focus:ring-0"
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type={step.type === "email" ? "email" : "text"}
                value={(answers[step.id] as string) || ""}
                onChange={(e) => updateAnswer(step.id, e.target.value)}
                placeholder={step.placeholder}
                readOnly={isReadOnly}
                className="w-full border-0 border-b-2 border-gray-300 bg-transparent px-0 pb-2 text-xl text-gray-900 placeholder:text-gray-300 focus:border-[#635BFF] focus:outline-none focus:ring-0"
              />
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}

          {/* Next button + hint */}
          <div className="mt-8 flex items-center gap-4">
            <button
              onClick={goNext}
              disabled={submitting}
              className="rounded-lg bg-[#635BFF] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#5548e0] disabled:opacity-50"
            >
              {submitting
                ? "Submitting..."
                : isLast
                  ? "Complete"
                  : "OK"}
            </button>
            {!isMultiField && step.type !== "textarea" && !isLast && (
              <span className="text-xs text-gray-400">
                press <kbd className="rounded border border-gray-300 px-1.5 py-0.5 font-mono">Enter ↵</kbd>
              </span>
            )}
            {(step.type === "textarea" || isMultiField) && (
              <span className="text-xs text-gray-400">
                Fill in the fields above, then click OK
              </span>
            )}
          </div>

          {/* Skip hint for optional steps */}
          {!hasRequiredFields && !isMultiField && step.type !== "checkbox" && (
            <button
              onClick={goNext}
              className="mt-4 text-xs text-gray-400 hover:text-gray-600"
            >
              Skip this question
            </button>
          )}
          {!hasRequiredFields && isMultiField && (
            <button
              onClick={goNext}
              className="mt-4 text-xs text-gray-400 hover:text-gray-600"
            >
              Skip this section
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
