"use client";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8 max-w-xl mx-auto">
      <h2 className="text-xl font-bold text-red-600 mb-2">Something went wrong</h2>
      <pre className="bg-muted p-4 rounded text-sm mb-4 whitespace-pre-wrap break-words text-foreground">
        {error.message}
        {error.digest && `\n\nDigest: ${error.digest}`}
      </pre>
      <button
        onClick={reset}
        className="px-4 py-2 bg-brand text-brand-foreground rounded hover:bg-brand-strong font-medium"
      >
        Try again
      </button>
    </div>
  );
}
