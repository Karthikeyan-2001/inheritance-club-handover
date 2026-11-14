"use client";

import { useCallback, useState, type ReactNode } from "react";
import { CheckCircle2Icon, XIcon } from "lucide-react";
import { cn } from "cn";
import { NoticeContext } from "./notice";

export type ItemFilter = "check" | "accepted" | "rejected" | "all";
type SectionKey = "changed" | "draft" | "accepted" | "rejected";

const SHOWS: Record<ItemFilter, SectionKey[]> = {
  check: ["changed", "draft"],
  accepted: ["accepted"],
  rejected: ["rejected"],
  all: ["changed", "draft", "accepted", "rejected"],
};

/**
 * The items of a review, with a filter that works at once (no round trip to the server) and a
 * confirmation line that stays when an item moves to another list. All the lists are rendered;
 * the filter only hides the ones you did not ask for.
 */
export function ReviewItems({
  counts,
  initial,
  sections,
}: {
  counts: Record<ItemFilter, number>;
  initial: ItemFilter;
  sections: Record<SectionKey, ReactNode>;
}) {
  const [filter, setFilter] = useState<ItemFilter>(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const notify = useCallback((message: string) => setNotice(message), []);
  const options: { key: ItemFilter; label: string }[] = [
    { key: "check", label: "To check" },
    { key: "accepted", label: "Accepted" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ];
  const visible = SHOWS[filter];

  return (
    <NoticeContext.Provider value={notify}>
      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Show items" className="flex flex-wrap gap-1.5 rounded-2xl border bg-secondary/60 p-1.5 text-sm">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={filter === o.key}
              onClick={() => setFilter(o.key)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-4 py-2",
                filter === o.key ? "bg-card font-semibold text-primary shadow-sm" : "text-secondary-foreground transition-colors hover:bg-card/70",
              )}
            >
              {o.label}
              <span className={cn("rounded-full px-2 text-xs tabular-nums", o.key === "check" && counts.check > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{counts[o.key]}</span>
            </button>
          ))}
        </div>

        <div aria-live="polite" className="sticky top-2 z-10 empty:hidden">
          {notice && (
            <p role="status" className="flex items-start justify-between gap-3 rounded-xl border border-success/30 bg-success-soft px-4 py-2.5 text-sm text-success shadow-sm" data-testid="review-notice">
              <span className="flex items-start gap-2">
                <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {notice}
              </span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss this message" className="rounded-md p-0.5 hover:bg-card/60">
                <XIcon aria-hidden="true" className="size-4" />
              </button>
            </p>
          )}
        </div>

        {filter === "check" && counts.check === 0 && (
          <p className="rounded-2xl border border-dashed bg-card/60 px-5 py-6 text-center text-sm text-muted-foreground" data-testid="all-checked">
            <strong className="text-foreground">Every item is checked.</strong> Look over what the next version holds, then sign off below.
          </p>
        )}

        {(Object.keys(sections) as SectionKey[]).map((key) => (
          <div key={key} hidden={!visible.includes(key)}>
            {sections[key]}
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}
