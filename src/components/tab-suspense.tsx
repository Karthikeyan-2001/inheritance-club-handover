"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/**
 * A loading boundary that starts over for each tab. Without the key, React keeps the old tab's
 * content on screen while the new one loads, which looks like a frozen page. With it, the
 * placeholder appears the moment the new tab's page starts to arrive.
 */
export function TabSuspense({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const tab = useSearchParams().get("tab") ?? "";
  return (
    <Suspense key={tab} fallback={fallback}>
      {children}
    </Suspense>
  );
}
