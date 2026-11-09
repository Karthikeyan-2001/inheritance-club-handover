export const STEPS = ["Connect", "Reconstruct", "Verify", "Review", "Handover"] as const;
export type Step = (typeof STEPS)[number];

/** The five-step workflow from the brief. Steps after `current` are shown as upcoming. */
export function StepIndicator({ current }: { current?: Step }) {
  const currentIndex = current ? STEPS.indexOf(current) : -1;
  return (
    <nav aria-label="Workflow steps">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((step, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
          return (
            <li key={step} className="flex items-center gap-2">
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={
                  state === "current"
                    ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground"
                    : state === "done"
                      ? "rounded-full border border-primary px-3 py-1 text-foreground"
                      : "rounded-full border px-3 py-1 text-muted-foreground"
                }
              >
                <span className="sr-only">{`Step ${i + 1} of ${STEPS.length}: `}</span>
                {step}
                {state === "done" && <span className="sr-only"> (done)</span>}
              </span>
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
