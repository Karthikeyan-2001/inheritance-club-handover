"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const REASSURE = [
  "Fetching only what your role may read…",
  "Still working. Each list is checked against your permissions first.",
  "Taking a little longer than usual. Nothing is lost; it will appear here.",
];

/**
 * A placeholder shaped like the content that is coming, with a spoken status. The message
 * changes after a few seconds so a long wait is explained, not just endured. The skeleton
 * rows hold the space, so the page does not jump when the content arrives.
 */
export function LoadingBlock({ label, rows = 3, variant = "cards" }: { label: string; rows?: number; variant?: "cards" | "list" | "table" }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setStage(1), 3500);
    const b = setTimeout(() => setStage(2), 9000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-4" data-testid="loading-block">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="flex gap-1">
          <span className="soft-pulse size-1.5 rounded-full bg-primary" />
          <span className="soft-pulse size-1.5 rounded-full bg-primary [animation-delay:200ms]" />
          <span className="soft-pulse size-1.5 rounded-full bg-primary [animation-delay:400ms]" />
        </span>
        <span>{label}</span>
        {stage > 0 && <span className="text-muted-foreground/80">· {REASSURE[stage]}</span>}
      </p>
      {variant === "cards" && (
        <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          ))}
        </div>
      )}
      {variant === "list" && (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          ))}
        </div>
      )}
      {variant === "table" && (
        <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4" aria-hidden="true">
          {Array.from({ length: rows + 2 }, (_, i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      )}
    </div>
  );
}
