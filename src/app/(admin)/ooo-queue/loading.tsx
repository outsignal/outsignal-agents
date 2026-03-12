import { Skeleton } from "@/components/ui/skeleton";

export default function OooQueueLoading() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="border-b border-border px-8 py-4 flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-40 rounded" />
          <Skeleton className="h-4 w-72 rounded" />
        </div>
      </div>

      <div className="p-8 space-y-6">
        {/* Summary cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>

        {/* Filter row skeleton */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="h-8 w-48 rounded-md" />
        </div>

        {/* Table skeleton */}
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-6 py-4">
            <Skeleton className="h-5 w-32 rounded" />
          </div>
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-7 w-24 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
