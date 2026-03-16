import * as React from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  illustration?: React.ReactNode;
  title: string;
  description: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  variant?: "default" | "compact" | "card";
  className?: string;
}

const variantStyles = {
  default: {
    padding: "py-16 px-8",
    iconContainer: "h-14 w-14",
    icon: "h-6 w-6",
    title: "text-lg font-semibold",
    card: "border-dashed",
  },
  compact: {
    padding: "py-8 px-4",
    iconContainer: "h-10 w-10",
    icon: "h-4 w-4",
    title: "text-base font-semibold",
    card: "border-dashed",
  },
  card: {
    padding: "py-12 px-6",
    iconContainer: "h-12 w-12",
    icon: "h-5 w-5",
    title: "text-lg font-semibold",
    card: "border-solid",
  },
} as const;

function ActionButton({ action, variant }: { action: EmptyStateAction; variant?: string }) {
  if (action.href) {
    return (
      <Button variant="brand" size={variant === "compact" ? "sm" : "default"} asChild>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button variant="brand" size={variant === "compact" ? "sm" : "default"} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

function SecondaryActionLink({ action }: { action: EmptyStateAction }) {
  if (action.href) {
    return (
      <Link
        href={action.href}
        className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
      >
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
    >
      {action.label}
    </button>
  );
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
  secondaryAction,
  variant = "default",
  className,
}: EmptyStateProps) {
  const styles = variantStyles[variant];

  return (
    <Card className={cn(styles.card, className)}>
      <CardContent
        className={cn(
          "flex flex-col items-center justify-center animate-fade-in",
          styles.padding,
        )}
      >
        {illustration ? (
          <div className="mb-5">{illustration}</div>
        ) : Icon ? (
          <div
            className={cn(
              "rounded-full bg-muted flex items-center justify-center mb-5",
              styles.iconContainer,
            )}
          >
            <Icon className={cn("text-muted-foreground", styles.icon)} aria-hidden="true" />
          </div>
        ) : null}

        <h3 className={cn(styles.title, "text-foreground mb-1")}>{title}</h3>

        <p className="text-sm text-muted-foreground text-center max-w-sm">
          {description}
        </p>

        {action && (
          <div className="mt-5">
            <ActionButton action={action} variant={variant} />
          </div>
        )}

        {secondaryAction && (
          <div className="mt-3">
            <SecondaryActionLink action={secondaryAction} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
