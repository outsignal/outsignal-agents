import { Header } from "@/components/layout/header";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";

interface PageShellProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  noPadding?: boolean;
  children: React.ReactNode;
}

export function PageShell({
  title,
  description,
  actions,
  breadcrumbs,
  noPadding,
  children,
}: PageShellProps) {
  return (
    <div>
      {breadcrumbs && <Breadcrumb items={breadcrumbs} />}
      <Header title={title} description={description} actions={actions} />
      {noPadding ? children : (
        <div className="p-6 space-y-6">{children}</div>
      )}
    </div>
  );
}
