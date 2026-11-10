"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { endTour, goToTourStop } from "@/app/actions/tour";
import { PendingButton } from "@/components/demo/pending-button";
import { Button } from "@/components/ui/button";
import { isOnStop, type TourStop, type TourTrack } from "@/lib/tour/tour";

export type TourDockProps = {
  track: TourTrack;
  trackLabel: string;
  index: number;
  total: number;
  stop: TourStop;
  /** Who the stop is seen as, and whether the visitor is signed in as them now. */
  asName: string;
  asRole: string;
  rightPerson: boolean;
  nextAsName: string | null;
};

const WAIT_MS = 8000;

/** Ring the stop's element once it is on the page (sections stream in), and scroll it into view. */
function useHighlight(selector: string | undefined, active: boolean) {
  useEffect(() => {
    if (!selector || !active) return;
    let el: Element | null = null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mark = (): boolean => {
      let found: Element | null = null;
      try {
        found = document.querySelector(selector);
      } catch {
        return true; // an unsupported selector: give up quietly
      }
      if (!found) return false;
      el = found;
      el.setAttribute("data-tour-highlight", "");
      // A tall element is shown from its top, so the reader starts where it starts.
      const room = window.innerHeight - (document.querySelector('[data-testid="tour"]')?.clientHeight ?? 0);
      const tall = el.getBoundingClientRect().height > room * 0.7;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: tall ? "start" : "center" });
      return true;
    };
    if (mark()) return () => el?.removeAttribute("data-tour-highlight");
    const observer = new MutationObserver(() => {
      if (mark()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => observer.disconnect(), WAIT_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      el?.removeAttribute("data-tour-highlight");
    };
  }, [selector, active]);
}

function StopForm({ track, index, children }: { track: TourTrack; index: number; children: React.ReactNode }) {
  return (
    <form action={goToTourStop}>
      <input type="hidden" name="track" value={track} />
      <input type="hidden" name="index" value={index} />
      {children}
    </form>
  );
}

/**
 * The guided tour, docked at the bottom of the screen so it stays in view while the page
 * scrolls to the highlighted element. Back and Next are forms (server actions), so they
 * work before hydration and each move is a real sign-in when the role changes.
 */
export function TourDock(p: TourDockProps) {
  const pathname = usePathname();
  const search = useSearchParams();
  const tab = search.get("tab");
  const here = isOnStop(p.stop, pathname, tab) && p.rightPerson;
  const [open, setOpen] = useState(true);
  useHighlight(p.stop.highlight, here);
  // Anything scrolled into view (a link target, a focused field) stops above the dock.
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollPaddingBottom = open ? "20rem" : "5rem";
    return () => {
      root.style.scrollPaddingBottom = "";
    };
  }, [open]);

  const last = p.index === p.total - 1;
  const where = search.toString() ? `${pathname}?${search.toString()}` : pathname;
  const label = `Guided tour, stop ${p.index + 1} of ${p.total}`;

  return (
    <>
      {/* Room at the end of the page, so the dock never covers the last content. */}
      <div aria-hidden="true" className={open ? "h-72" : "h-16"} />
      <aside
        aria-label="Guided tour"
        data-testid="tour"
        data-stop={p.stop.id}
        className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 shadow-[0_-4px_16px_rgb(0_0_0/0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className="sr-only">{label}. </span>
              <span aria-hidden="true">
                Guided tour · {p.trackLabel} · {p.index + 1} / {p.total}
                {p.stop.step ? ` · ${p.stop.step}` : ""}
              </span>
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open}
                aria-controls="tour-body"
                onClick={() => setOpen((o) => !o)}
              >
                {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronUpIcon aria-hidden="true" />}
                {open ? "Hide" : "Show"}
              </Button>
              <form action={endTour}>
                <input type="hidden" name="next" value={where} />
                <Button type="submit" variant="ghost" size="sm">
                  Exit tour
                </Button>
              </form>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="h-1 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${((p.index + 1) / p.total) * 100}%` }} />
          </div>

          {open && (
            <div id="tour-body" className="flex flex-col gap-3">
              <h2 className="text-base font-semibold" data-testid="tour-title">
                {p.stop.title}
              </h2>
              {here ? (
                <div className="flex max-h-40 flex-col gap-2 overflow-y-auto text-sm text-muted-foreground">
                  {p.stop.body.map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                  {p.stop.tryThis && (
                    <p className="text-foreground">
                      <strong>Try this:</strong> {p.stop.tryThis}
                    </p>
                  )}
                </div>
              ) : (
                <p role="status" className="text-sm" data-testid="tour-away">
                  {p.rightPerson
                    ? "You have left this stop's page. Explore as much as you like, then return to it or carry on."
                    : `This stop is seen as ${p.asName} (${p.asRole}). Return to it to switch to ${p.asName}.`}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {!here && (
                  <StopForm track={p.track} index={p.index}>
                    <PendingButton variant="outline" size="sm" pendingLabel="Opening…">
                      Return to this stop
                    </PendingButton>
                  </StopForm>
                )}
                {p.index > 0 && (
                  <StopForm track={p.track} index={p.index - 1}>
                    <PendingButton variant="outline" size="sm" pendingLabel="Going back…">
                      Back
                    </PendingButton>
                  </StopForm>
                )}
                {last ? (
                  <form action={endTour}>
                    <input type="hidden" name="next" value={where} />
                    <Button type="submit" size="sm">
                      Finish tour
                    </Button>
                  </form>
                ) : (
                  <StopForm track={p.track} index={p.index + 1}>
                    <PendingButton size="sm" pendingLabel={p.nextAsName ? `Signing in as ${p.nextAsName}…` : "Opening…"}>
                      {p.nextAsName ? `Next, as ${p.nextAsName}` : "Next"}
                    </PendingButton>
                  </StopForm>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
