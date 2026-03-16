"use client"

import * as React from "react"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface FilterPopoverProps {
  children: React.ReactNode
  activeCount?: number
  className?: string
}

export function FilterPopover({ children, activeCount, className }: FilterPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-1.5", className)}>
          <SlidersHorizontal className="size-3.5" />
          Filters
          {activeCount != null && activeCount > 0 && (
            <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-brand text-[10px] font-medium text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4 space-y-4">
        {children}
      </PopoverContent>
    </Popover>
  )
}
