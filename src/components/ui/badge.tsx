import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        brand:
          "bg-foreground/90 text-background border-foreground/20",
        success:
          "bg-emerald-50 text-emerald-700 border-emerald-200",
        warning:
          "bg-amber-50 text-amber-700 border-amber-200",
        info:
          "bg-blue-50 text-blue-600 border-blue-200",
        purple:
          "bg-purple-50 text-purple-600 border-purple-200",
      },
      size: {
        default: "px-2 py-0.5 text-xs",
        xs: "px-1.5 py-0.5 text-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const dotColorMap: Record<string, string> = {
  default: "bg-primary",
  secondary: "bg-secondary-foreground/50",
  destructive: "bg-white",
  outline: "bg-foreground",
  ghost: "bg-foreground",
  link: "bg-primary",
  brand: "bg-background",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  purple: "bg-purple-500",
}

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
    dot?: boolean
    shape?: "default" | "pill"
  }

function Badge({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  dot = false,
  shape = "default",
  children,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(
        badgeVariants({ variant, size }),
        shape === "pill" && "rounded-full",
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full shrink-0",
            dotColorMap[variant ?? "default"] ?? "bg-current",
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </Comp>
  )
}

export { Badge, badgeVariants }
