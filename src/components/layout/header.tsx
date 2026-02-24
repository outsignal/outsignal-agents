import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b px-8 py-4">
      <div>
        <h1 className="text-2xl font-heading font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
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
