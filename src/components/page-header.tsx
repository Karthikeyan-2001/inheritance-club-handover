import type { ReactNode } from "react";

/**
 * The top of every page: its name and one line saying what it is for. The line is the page's
 * own guide, so a first-time visitor never needs a walkthrough.
 */
export function PageHeader({ title, purpose, children }: { title: string; purpose: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-3xl text-base text-muted-foreground" data-testid="page-purpose">
        {purpose}
      </p>
      {children}
    </div>
  );
}
