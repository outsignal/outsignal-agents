"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  buildHref?: (page: number) => string;
  onPageChange?: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  buildHref,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalCount);
  const isFirst = currentPage <= 1;
  const isLast = currentPage >= totalPages;

  // Build page number list with ellipsis
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(
      (p) =>
        p === 1 ||
        p === totalPages ||
        Math.abs(p - currentPage) <= 1,
    )
    .reduce<(number | "...")[]>((acc, p, idx, arr) => {
      if (idx > 0 && p - (arr[idx - 1] ?? 0) > 1) acc.push("...");
      acc.push(p);
      return acc;
    }, []);

  function navButton(page: number, disabled: boolean, children: React.ReactNode) {
    if (buildHref && !disabled) {
      return (
        <Button variant="outline" size="sm" asChild>
          <Link href={buildHref(page)}>{children}</Link>
        </Button>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onPageChange?.(page)}
      >
        {children}
      </Button>
    );
  }

  function pageButton(page: number) {
    const isActive = page === currentPage;
    if (buildHref) {
      return (
        <Link
          key={page}
          href={buildHref(page)}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            isActive
              ? "bg-foreground text-background border-foreground"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {page}
        </Link>
      );
    }
    return (
      <button
        key={page}
        type="button"
        onClick={() => onPageChange?.(page)}
        className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
          isActive
            ? "bg-foreground text-background border-foreground"
            : "border-border text-muted-foreground hover:bg-muted"
        }`}
      >
        {page}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 pt-2">
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        Showing {from} to {to} of {totalCount} results
      </span>
      <div className="flex items-center gap-2">
        {navButton(currentPage - 1, isFirst, (
          <>
            <ChevronLeft className="h-4 w-4" />
            Previous
          </>
        ))}
        {pages.map((p, idx) =>
          p === "..." ? (
            <span
              key={`ellipsis-${idx}`}
              className="px-1 text-xs text-muted-foreground"
            >
              ...
            </span>
          ) : (
            pageButton(p)
          ),
        )}
        {navButton(currentPage + 1, isLast, (
          <>
            Next
            <ChevronRight className="h-4 w-4" />
          </>
        ))}
      </div>
    </div>
  );
}
