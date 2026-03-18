import Link from "next/link"
import { cn } from "@/lib/utils"

interface StatusItem {
  label: string
  value: string | number
  status?: "green" | "amber" | "red" | "neutral"
  href?: string
}

interface StatusIndicatorRowProps {
  items: StatusItem[]
  className?: string
}

const dotColors = {
  green: "bg-emerald-500 dark:bg-emerald-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  red: "bg-red-500 dark:bg-red-400",
  neutral: "bg-muted-foreground/40",
}

function StatusChip({ label, value, status = "neutral" }: StatusItem) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={cn("size-2 shrink-0 rounded-full", dotColors[status])} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium font-mono tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export function StatusIndicatorRow({ items, className }: StatusIndicatorRowProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-5 py-3", className)}>
      {items.map((item) =>
        item.href ? (
          <Link key={item.label} href={item.href} className="hover:opacity-70 transition-opacity">
            <StatusChip {...item} />
          </Link>
        ) : (
          <StatusChip key={item.label} {...item} />
        )
      )}
    </div>
  )
}
