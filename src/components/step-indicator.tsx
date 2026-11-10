"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { STEP_HREF, STEPS, stepForPath } from "@/lib/steps";

/** The five-step workflow from the brief. The current step follows the page you are on. */
export function StepIndicator() {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const current = stepForPath(pathname, tab);
  const currentIndex = current ? STEPS.indexOf(current) : -1;
  return (
    <nav aria-label="Workflow steps">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((step, i) => {
          const isCurrent = i === currentIndex;
          const href = STEP_HREF[step];
          const cls = isCurrent
            ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground"
            : href
              ? "rounded-full border px-3 py-1 text-foreground hover:bg-accent"
              : "rounded-full border border-dashed px-3 py-1 text-muted-foreground";
          const label = (
            <>
              <span className="sr-only">{`Step ${i + 1} of ${STEPS.length}: `}</span>
              {step}
              {!href && <span className="sr-only"> (coming soon)</span>}
            </>
          );
          return (
            <li key={step} className="flex items-center gap-2">
              {href ? (
                <Link href={href} aria-current={isCurrent ? "step" : undefined} className={cls}>
                  {label}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "step" : undefined} className={cls}>
                  {label}
                </span>
              )}
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
