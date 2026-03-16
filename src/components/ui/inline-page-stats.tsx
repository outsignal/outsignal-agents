import { cn } from "@/lib/utils"

interface StatItem {
  label: string
  value: string | number
}

interface InlinePageStatsProps {
  stats: StatItem[]
  className?: string
}

export function InlinePageStats({ stats, className }: InlinePageStatsProps) {
  return (
    <span className={cn("text-sm text-muted-foreground", className)}>
      {stats.map((stat, i) => (
        <span key={stat.label}>
          {i > 0 && <span className="mx-1.5 text-border">&middot;</span>}
          <span className="font-medium text-foreground tabular-nums">{stat.value}</span>
          {" "}
          {stat.label}
        </span>
      ))}
    </span>
  )
}
