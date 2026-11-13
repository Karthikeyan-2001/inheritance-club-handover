"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Shown inside a form whose server action takes a while (building a demo club takes up to half a
 * minute). The bar fills toward 90% on a curve and the message changes with each stage, so the
 * wait reads as progress and not as a frozen page. It is an estimate, not a measurement, and
 * says "usually" rather than promising a time.
 */
export function BuildProgress(props: { steps: string[]; expectedSeconds?: number }) {
  const { pending } = useFormStatus();
  // Mounted only while pending, so the clock starts at zero each time.
  return pending ? <Running {...props} /> : null;
}

function Running({ steps, expectedSeconds = 20 }: { steps: string[]; expectedSeconds?: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 0.25), 250);
    return () => clearInterval(t);
  }, []);
  const pct = Math.min(90, Math.round(90 * (1 - Math.exp(-elapsed / (expectedSeconds / 2.2)))));
  const step = Math.min(steps.length - 1, Math.floor((elapsed / expectedSeconds) * steps.length));
  return (
    <div role="status" aria-live="polite" className="rise-in flex flex-col gap-2" data-testid="build-progress">
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="progress-stripes h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${Math.max(pct, 6)}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">
        {steps[step]} <span className="text-xs">This usually takes under half a minute.</span>
      </p>
    </div>
  );
}
