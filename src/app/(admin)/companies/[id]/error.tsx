"use client";

export default function CompanyDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Could not load company details.
      </p>
      <button
        onClick={reset}
        className="text-sm underline text-muted-foreground hover:text-foreground"
      >
        Try again
      </button>
    </div>
  );
}
