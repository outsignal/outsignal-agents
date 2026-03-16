"use client"

import * as React from "react"
import { InboxIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  SortableTableHead,
  TableRowActions,
  type TableRowAction,
} from "@/components/ui/table"

export interface DataTableColumn<T> {
  /** Unique key for this column — used for sorting and accessing data */
  key: string
  /** Header label */
  header: string
  /** Whether this column is sortable */
  sortable?: boolean
  /** Render as monospace (font-mono) */
  mono?: boolean
  /** Text alignment */
  align?: "left" | "center" | "right"
  /** Custom cell renderer — receives the full row */
  render?: (row: T) => React.ReactNode
  /** Header className override */
  headerClassName?: string
  /** Cell className override */
  className?: string
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: DataTableColumn<T>[]
  /** Row data */
  data: T[]
  /** Enable sorting (default: false) */
  sortable?: boolean
  /** Custom empty state (defaults to a simple "No data" message) */
  emptyState?: React.ReactNode
  /** Whether data is loading */
  loading?: boolean
  /** Click handler for a row — receives the row data */
  onRowClick?: (row: T) => void
  /** Row actions — receives the row data, returns action definitions */
  rowActions?: (row: T) => TableRowAction[]
  /** Extract a unique key from each row (defaults to index) */
  getRowKey?: (row: T, index: number) => string | number
  /** Additional className for the table container */
  className?: string
}

export function DataTable<T>({
  columns,
  data,
  sortable = false,
  emptyState,
  loading = false,
  onRowClick,
  rowActions,
  getRowKey,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<{
    key: string
    direction: "asc" | "desc"
  } | null>(null)

  const handleSort = React.useCallback(
    (key: string) => {
      if (!sortable) return
      setSort((prev) => {
        if (prev?.key === key) {
          if (prev.direction === "asc") return { key, direction: "desc" }
          // If already desc, clear sort
          return null
        }
        return { key, direction: "asc" }
      })
    },
    [sortable]
  )

  const sortedData = React.useMemo(() => {
    if (!sort) return data
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return data

    return [...data].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sort.key]
      const bVal = (b as Record<string, unknown>)[sort.key]

      // Handle null/undefined
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      let comparison = 0
      if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal
      } else if (typeof aVal === "string" && typeof bVal === "string") {
        comparison = aVal.localeCompare(bVal)
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime()
      } else {
        comparison = String(aVal).localeCompare(String(bVal))
      }

      return sort.direction === "asc" ? comparison : -comparison
    })
  }, [data, sort, columns])

  const hasActions = !!rowActions
  const totalColumns = columns.length + (hasActions ? 1 : 0)

  // Loading state — skeleton rows
  if (loading) {
    return (
      <Table className={className}>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.headerClassName
                )}
              >
                {col.header}
              </TableHead>
            ))}
            {hasActions && <TableHead className="w-12" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, rowIdx) => (
            <TableRow key={rowIdx}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  <Skeleton className="h-4 w-full max-w-[120px]" />
                </TableCell>
              ))}
              {hasActions && (
                <TableCell>
                  <Skeleton className="size-6 rounded" />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  // Empty state
  if (data.length === 0) {
    return (
      <Table className={className}>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  col.align === "right" && "text-right",
                  col.align === "center" && "text-center",
                  col.headerClassName
                )}
              >
                {col.header}
              </TableHead>
            ))}
            {hasActions && <TableHead className="w-12" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={totalColumns} className="h-32 text-center">
              {emptyState ?? (
                <div className="flex flex-col items-center justify-center gap-2 text-stone-400">
                  <InboxIcon className="size-8" />
                  <p className="text-sm">No data to display</p>
                </div>
              )}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((col) => {
            const headClassName = cn(
              col.align === "right" && "text-right",
              col.align === "center" && "text-center",
              col.headerClassName
            )

            if (sortable && col.sortable) {
              return (
                <SortableTableHead
                  key={col.key}
                  sortKey={col.key}
                  currentSort={sort}
                  onSort={handleSort}
                  className={headClassName}
                >
                  {col.header}
                </SortableTableHead>
              )
            }

            return (
              <TableHead key={col.key} className={headClassName}>
                {col.header}
              </TableHead>
            )
          })}
          {hasActions && <TableHead className="w-12" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedData.map((row, idx) => {
          const key = getRowKey ? getRowKey(row, idx) : idx

          return (
            <TableRow
              key={key}
              className={cn(onRowClick && "cursor-pointer")}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => {
                const value = col.render
                  ? col.render(row)
                  : (row as Record<string, unknown>)[col.key]

                return (
                  <TableCell
                    key={col.key}
                    className={cn(
                      col.mono && "font-mono",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.className
                    )}
                  >
                    {value as React.ReactNode}
                  </TableCell>
                )
              })}
              {hasActions && (
                <TableCell className="w-12 px-2">
                  <TableRowActions actions={rowActions(row)} />
                </TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
