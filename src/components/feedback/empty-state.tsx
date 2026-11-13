import type { ReactNode } from "react";
import { InboxIcon } from "lucide-react";

/** "Nothing here yet", with what to do about it. Never a blank gap. */
export function EmptyState({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-6 py-10 text-center" data-testid="empty-state">
      <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-secondary text-secondary-foreground">
        <InboxIcon className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      {children}
    </div>
  );
}
