import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The end of a step page: what this step produced, in one line, and the one button that moves
 * the handover on. `action` replaces the link when the next move is not a page (switching
 * person); with neither, it only says what happens next.
 */
export function NextStepBar({ children, label, href, action }: { children: ReactNode; label?: string; href?: string; action?: ReactNode }) {
  return (
    <div className="rise-in flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-accent px-5 py-4" data-testid="next-step-bar">
      <p className="text-sm text-accent-foreground">{children}</p>
      {action ??
        (label && href ? (
          <Button asChild>
            <Link href={href}>
              {label}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        ) : null)}
    </div>
  );
}
