"use client";

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive">
      <div className="flex items-center justify-between gap-3">
        <p>{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 text-destructive hover:text-destructive/80 font-medium underline underline-offset-2"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
