"use client"

import * as React from "react"
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, MoreHorizontalIcon, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-stone-50 sticky top-0 z-10", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-stone-50 border-t border-stone-100 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group border-b border-stone-100 transition-colors duration-150 hover:bg-stone-50 data-[state=selected]:bg-[oklch(0.55_0.25_275/0.05)]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-4 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-stone-500 whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-3 align-middle text-sm text-stone-700 whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-stone-500 mt-4 text-sm", className)}
      {...props}
    />
  )
}

/* --- Sortable Header --- */

interface SortableTableHeadProps extends React.ComponentProps<"th"> {
  sortKey: string
  currentSort: { key: string; direction: "asc" | "desc" } | null
  onSort: (key: string) => void
}

function SortableTableHead({
  sortKey,
  currentSort,
  onSort,
  className,
  children,
  ...props
}: SortableTableHeadProps) {
  const isActive = currentSort?.key === sortKey
  const direction = isActive ? currentSort.direction : null

  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-4 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-stone-500 whitespace-nowrap cursor-pointer select-none [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      onClick={() => onSort(sortKey)}
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {direction === "asc" ? (
          <ChevronUpIcon className="size-3.5 text-stone-900" />
        ) : direction === "desc" ? (
          <ChevronDownIcon className="size-3.5 text-stone-900" />
        ) : (
          <ChevronsUpDownIcon className="size-3.5 text-stone-400" />
        )}
      </span>
    </th>
  )
}

/* --- Row Actions --- */

interface TableRowAction {
  label: string
  icon?: LucideIcon
  onClick: () => void
  destructive?: boolean
}

interface TableRowActionsProps {
  actions: TableRowAction[]
}

function TableRowActions({ actions }: TableRowActionsProps) {
  return (
    <div className="flex justify-end opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex size-8 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Row actions"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.label}
              onClick={action.onClick}
              variant={action.destructive ? "destructive" : "default"}
            >
              {action.icon && <action.icon className="size-4" />}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  SortableTableHead,
  TableRowActions,
}

export type { SortableTableHeadProps, TableRowAction, TableRowActionsProps }
