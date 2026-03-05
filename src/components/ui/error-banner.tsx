"use client";

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
      <div className="flex items-center justify-between gap-3">
        <p>{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 text-red-600 hover:text-red-800 font-medium underline underline-offset-2"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
