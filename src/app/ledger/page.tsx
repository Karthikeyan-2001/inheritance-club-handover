import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Timeline } from "@/components/ledger/timeline";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/session";
import { parseTimelineParams } from "@/lib/timeline-query";

export const metadata: Metadata = { title: "Ledger · Inheritance" };

const TABS = ["Commitments", "Recurring", "Docket", "Gaps", "Timeline"] as const;

function Tabs() {
  return (
    <nav aria-label="Ledger sections">
      <ul className="flex flex-wrap gap-2 border-b pb-2 text-sm">
        {TABS.map((t) =>
          t === "Timeline" ? (
            <li key={t}>
              <Link href="/ledger?tab=timeline" aria-current="page" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">
                {t}
              </Link>
            </li>
          ) : (
            <li key={t}>
              <span aria-disabled="true" className="rounded-md px-3 py-1.5 text-muted-foreground">
                {t}
                <span className="sr-only"> (coming soon)</span>
              </span>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

async function LedgerContent({ searchParams }: { searchParams: PageProps<"/ledger">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <p role="alert">Could not reach the database. Try again in a minute.</p>;
  }
  if (!viewer) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Sign in to see the ledger.</p>
        <Button asChild>
          <Link href="/login">Choose a demo account</Link>
        </Button>
      </div>
    );
  }
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const params = parseTimelineParams(await searchParams);
  return <Timeline workspaceId={viewer.membership.workspaceId} params={params} />;
}

export default function LedgerPage(props: PageProps<"/ledger">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ledger</h1>
        <p className="max-w-3xl text-muted-foreground">
          Obligations, recurring duties, conflicts and gaps arrive in later steps. The timeline shows every imported message your role may
          read.
        </p>
      </div>
      <Tabs />
      <Suspense fallback={<p className="text-muted-foreground">Loading the timeline…</p>}>
        <LedgerContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
