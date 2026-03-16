import { cn } from "@/lib/utils"

// Base skeleton — unchanged from original
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-stone-100 animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

// --- Individual skeleton shapes ---

function SkeletonText({
  width = "60%",
  className,
  ...props
}: React.ComponentProps<"div"> & { width?: string }) {
  return (
    <Skeleton
      className={cn("h-4 rounded", className)}
      style={{ width }}
      {...props}
    />
  )
}

function SkeletonAvatar({
  size = "md",
  className,
  ...props
}: React.ComponentProps<"div"> & { size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-12 w-12",
  }
  return (
    <Skeleton
      className={cn("rounded-full shrink-0", sizeClasses[size], className)}
      {...props}
    />
  )
}

function SkeletonButton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <Skeleton
      className={cn("h-9 w-24 rounded-md", className)}
      {...props}
    />
  )
}

function SkeletonBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <Skeleton
      className={cn("h-5 w-16 rounded-full", className)}
      {...props}
    />
  )
}

// --- Compound skeletons ---

function SkeletonMetricCard({
  variant = "default",
  showSparkline = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "hero"
  showSparkline?: boolean
}) {
  const isHero = variant === "hero"
  return (
    <div
      className={cn(
        "rounded-lg border border-stone-200 bg-white p-6 space-y-3",
        isHero && "p-8",
        className
      )}
      {...props}
    >
      {/* Label */}
      <SkeletonText width={isHero ? "40%" : "50%"} className="h-3.5" />
      {/* Value */}
      <SkeletonText
        width={isHero ? "55%" : "45%"}
        className={cn(isHero ? "h-9" : "h-7")}
      />
      {/* Sparkline area */}
      {showSparkline && (
        <Skeleton className="h-12 w-full rounded-md mt-2" />
      )}
    </div>
  )
}

function SkeletonTableRow({
  columns = 5,
  withActions = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  columns?: number
  withActions?: boolean
}) {
  // Vary widths for a natural look
  const widthPattern = ["75%", "60%", "45%", "80%", "55%", "40%", "70%", "50%"]
  const totalCols = withActions ? columns + 1 : columns

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3 border-b border-stone-100",
        className
      )}
      {...props}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="flex-1">
          <SkeletonText width={widthPattern[i % widthPattern.length]} />
        </div>
      ))}
      {withActions && (
        <div className="flex items-center gap-2 shrink-0">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      )}
    </div>
  )
}

function SkeletonListItem({
  withAvatar = true,
  lines = 2,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  withAvatar?: boolean
  lines?: number
}) {
  const lineWidths = ["65%", "40%", "55%", "35%"]
  return (
    <div
      className={cn("flex items-center gap-3 py-3", className)}
      {...props}
    >
      {withAvatar && <SkeletonAvatar size="md" />}
      <div className="flex-1 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonText
            key={i}
            width={lineWidths[i % lineWidths.length]}
            className={i === 0 ? "h-4" : "h-3.5"}
          />
        ))}
      </div>
    </div>
  )
}

function SkeletonChart({
  height = 200,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  height?: number
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-stone-200 bg-white p-6 space-y-4",
        className
      )}
      {...props}
    >
      {/* Chart header area */}
      <div className="flex items-center justify-between">
        <SkeletonText width="30%" className="h-4" />
        <SkeletonBadge />
      </div>
      {/* Chart area */}
      <Skeleton
        className="w-full rounded-lg"
        style={{ height }}
      />
    </div>
  )
}

export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonButton,
  SkeletonBadge,
  SkeletonMetricCard,
  SkeletonTableRow,
  SkeletonListItem,
  SkeletonChart,
}
