"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";

/** Shows a small spinner inside its parent Link while that link's page is loading. */
function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className="size-3.5" /> : null;
}

/**
 * One tab, as a link. The tab you pressed shows a spinner until its page arrives, so a slow
 * server never looks like a frozen page.
 */
export function TabLink({ href, on, title, children }: { href: string; on: boolean; title?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      title={title}
      className={
        on
          ? "flex items-center gap-2 rounded-xl bg-card px-4 py-2 font-semibold text-primary shadow-sm"
          : "flex items-center gap-2 rounded-xl px-4 py-2 text-secondary-foreground transition-colors hover:bg-card/70"
      }
    >
      {children}
      <LinkPending />
    </Link>
  );
}
