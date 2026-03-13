import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <header className="flex items-center justify-between border-b border-border/50 px-8 py-5">
        <div className="space-y-1">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
      </header>
      <div className="p-8 space-y-6">
        {/* Filter tabs */}
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-md" />
          ))}
        </div>
        {/* Strategy cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        {/* Chart area */}
        <Skeleton className="h-72 rounded-lg" />
        {/* Table */}
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}
