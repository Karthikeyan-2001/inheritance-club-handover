import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Something failed. Says what, and gives a way forward (try again, or go home). */
export function ErrorState({ title = "Something went wrong", children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/25 bg-danger-soft px-5 py-4">
      <div className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangleIcon aria-hidden="true" className="size-5" />
        {title}
      </div>
      <p className="text-sm text-foreground">{children ?? "The data service did not answer. Nothing was changed. Try again in a moment."}</p>
      <div className="flex gap-2">
        {onRetry && (
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </div>
  );
}
