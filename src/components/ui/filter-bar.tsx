interface FilterBarProps {
  children: React.ReactNode;
  resultCount?: number;
  resultLabel?: string;
}

export function FilterBar({ children, resultCount, resultLabel }: FilterBarProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <div className="flex flex-1 flex-wrap items-center gap-3">
        {children}
      </div>
      {resultCount !== undefined && (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {resultCount} {resultLabel || "results"}
        </span>
      )}
    </div>
  );
}
