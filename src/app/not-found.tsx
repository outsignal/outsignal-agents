import Link from "next/link";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="max-w-sm w-full text-center">
        <CardContent className="pt-6 space-y-4">
          <OutsignalLogo variant="mark" className="h-10 w-10 mx-auto" iconColor="currentColor" />
          <div>
            <h2 className="text-lg font-semibold">Page not found</h2>
            <p className="text-sm text-muted-foreground mt-1">
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
          </div>
          <Button variant="brand" asChild>
            <Link href="/">Go to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
