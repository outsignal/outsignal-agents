"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ActivityError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string }; // required by Next.js error boundary
  reset: () => void;
}) {
  void _error;
  return (
    <div className="p-6 flex items-center justify-center min-h-[50vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <h2 className="text-lg font-medium">
            Something went wrong loading this page
          </h2>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your activity log. Please try again or go back
            to the dashboard.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={reset} variant="brand">
              Try again
            </Button>
            <Button variant="outline" asChild>
              <Link href="/portal">Go back</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
