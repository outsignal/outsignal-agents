import { SkeletonTableRow } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import { EmptyState } from "@/components/ui/empty-state";

interface DataTableShellProps {
  loading?: boolean;
  error?: string | null;
  isEmpty?: boolean;
  emptyIcon?: React.ComponentType<{ className?: string }>;
  emptyTitle?: string;
  emptyDescription?: string;
  children: React.ReactNode;
  pagination?: React.ReactNode;
  skeletonRows?: number;
}

export function DataTableShell({
  loading,
  error,
  isEmpty,
  emptyIcon,
  emptyTitle = "No data found",
  emptyDescription = "There are no items to display.",
  children,
  pagination,
  skeletonRows = 5,
}: DataTableShellProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card">
        {/* Skeleton header row */}
        <SkeletonTableRow columns={5} className="bg-muted/30" />
        {/* Skeleton data rows */}
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <SkeletonTableRow key={i} columns={5} withActions />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorBanner message={error} />;
  }

  if (isEmpty) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <>
      {children}
      {pagination}
    </>
  );
}
