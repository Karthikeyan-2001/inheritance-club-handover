"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar under the header while a page change is under way. Next gives no "navigation
 * started" event, so a click on an in-app link records the URL it was made from; the bar runs
 * for as long as the address is still that URL, and stops by itself once it changes. It shows
 * only after 150 ms, so quick changes do not flash it, and gives up after 20 s.
 */
export function RouteProgress() {
  const here = `${usePathname()}?${useSearchParams().toString()}`;
  const [from, setFrom] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState<string | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      // A fresh click starts fresh: forget an earlier timeout or debounce for the same URL.
      setGaveUp(null);
      setShown(null);
      setFrom(`${location.pathname}?${location.search.replace(/^\?/, "")}`);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const busy = from !== null && from === here && gaveUp !== from;
  useEffect(() => {
    if (!busy || !from) return;
    const t = setTimeout(() => setShown(from), 150);
    const stop = setTimeout(() => setGaveUp(from), 20000);
    return () => {
      clearTimeout(t);
      clearTimeout(stop);
    };
  }, [busy, from]);

  if (!busy || shown !== from) return null;
  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-primary/15" data-testid="route-progress">
      <div className="route-bar h-full w-2/5 rounded-full bg-primary" />
    </div>
  );
}
