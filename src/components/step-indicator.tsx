"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { STEP_HREF, STEP_LABEL, STEPS, stepForPath } from "@/lib/steps";

/** The five steps of a handover. The current step follows the page you are on, and earlier ones show as passed. */
export function StepIndicator() {
  const pathname = usePathname();
  const current = stepForPath(pathname);
  const currentIndex = current ? STEPS.indexOf(current) : -1;
  return (
    <nav aria-label="Workflow steps" className={`relative overflow-x-auto ${current ? "" : "max-lg:hidden"}`}>
      <ol className="flex items-center gap-1 text-sm lg:min-w-max">
        {STEPS.map((step, i) => {
          const isCurrent = i === currentIndex;
          const passed = currentIndex > i;
          const href = STEP_HREF[step];
          const cls = isCurrent
            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
            : "text-secondary-foreground hover:bg-secondary";
          const body = (
            <>
              <span className="sr-only">{`Step ${i + 1} of ${STEPS.length}: `}</span>
              <span
                aria-hidden="true"
                className={`grid size-5 place-items-center rounded-full text-[11px] font-semibold ${isCurrent ? "bg-primary-foreground/25" : passed ? "bg-success text-white" : "bg-secondary text-secondary-foreground"}`}
              >
                {passed ? <CheckIcon className="size-3" /> : i + 1}
              </span>
              <span className={isCurrent ? "" : "max-lg:sr-only"}>{STEP_LABEL[step]}</span>
            </>
          );
          return (
            <li key={step} className="flex items-center gap-1">
              {href ? (
                <Link href={href} aria-current={isCurrent ? "step" : undefined} className={`flex items-center gap-2 rounded-full px-3 py-1.5 font-medium transition-colors ${cls}`}>
                  {body}
                </Link>
              ) : (
                <span className="flex items-center gap-2 rounded-full px-3 py-1.5 text-muted-foreground">{body}</span>
              )}
              {i < STEPS.length - 1 && <span aria-hidden="true" className={`h-px w-4 ${passed ? "bg-success" : "bg-border"}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
