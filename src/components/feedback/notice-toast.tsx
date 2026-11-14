"use client";

import { CheckCircle2Icon, XIcon } from "lucide-react";

/**
 * A confirmation that outlives the form that caused it (a card that moved to another list).
 * Fixed to the bottom of the window, so the sticky header never covers it however far the page
 * is scrolled. It stays until dismissed or replaced.
 */
export function NoticeToast({ notice, onDismiss, testId }: { notice: string | null; onDismiss: () => void; testId: string }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 empty:hidden">
      {notice && (
        <p role="status" className="rise-in pointer-events-auto flex w-full max-w-2xl items-start justify-between gap-3 rounded-xl border border-success/30 bg-success-soft px-4 py-2.5 text-sm text-success shadow-lg" data-testid={testId}>
          <span className="flex items-start gap-2">
            <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {notice}
          </span>
          <button type="button" onClick={onDismiss} aria-label="Dismiss this message" className="rounded-md p-0.5 hover:bg-card/60">
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </p>
      )}
    </div>
  );
}
