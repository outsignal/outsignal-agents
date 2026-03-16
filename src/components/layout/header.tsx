import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-border/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
      <div className="min-w-0">
        <h1 className="text-lg font-medium truncate">
          {title}
        </h1>
        {description && (
          <div className="text-sm text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">{actions}</div>
    </header>
  );
}

export function RefreshButton() {
  return (
    <form>
      <Button variant="outline" size="sm" type="submit">
        <RefreshCw className="h-4 w-4 mr-2" />
        Refresh
      </Button>
    </form>
  );
}
