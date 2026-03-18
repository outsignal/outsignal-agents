export default function SystemUptimeLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-4 sm:px-8 sm:py-5">
        <div>
          <div className="h-5 w-36 bg-muted rounded animate-pulse" />
          <div className="h-4 w-64 bg-muted rounded animate-pulse mt-2" />
        </div>
        <div className="h-9 w-24 bg-muted rounded animate-pulse" />
      </div>
      <div className="px-6 space-y-6">
        {/* Banner skeleton */}
        <div className="h-12 bg-muted rounded-lg animate-pulse" />
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
        {/* Provider cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
        {/* Notification table */}
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
