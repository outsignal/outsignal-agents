"use client";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 space-y-4">
      <h2 className="text-2xl font-heading font-bold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm max-w-md text-center">
        {error.message || "An unexpected error occurred while loading this page."}
      </p>
      <Button onClick={reset} className="bg-brand text-brand-foreground hover:bg-brand/90">
        Try again
      </Button>
    </div>
  );
}
