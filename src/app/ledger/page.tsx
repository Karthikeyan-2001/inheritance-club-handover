import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Commitments } from "@/components/ledger/commitments";
import { ExtractionPanel } from "@/components/ledger/extraction-panel";
import { Timeline } from "@/components/ledger/timeline";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/session";
import { parseTimelineParams } from "@/lib/timeline-query";

export const metadata: Metadata = { title: "Ledger · Inheritance" };

const TABS = [
  { key: "commitments", label: "Commitments" },
  { key: "recurring", label: "Recurring" },
  { key: "docket", label: "Docket" },
  { key: "gaps", label: "Gaps" },
  { key: "timeline", label: "Timeline" },
] as const;
const READY = new Set(["commitments", "timeline"]);
type TabKey = (typeof TABS)[number]["key"];

function Tabs({ current }: { current: TabKey }) {
  return (
    <nav aria-label="Ledger sections">
      <ul className="flex flex-wrap gap-2 border-b pb-2 text-sm">
        {TABS.map((t) => (
          <li key={t.key}>
            {READY.has(t.key) ? (
              <Link
                href={`/ledger?tab=${t.key}`}
                aria-current={t.key === current ? "page" : undefined}
                className={t.key === current ? "rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground" : "rounded-md px-3 py-1.5 hover:bg-accent"}
              >
                {t.label}
              </Link>
            ) : (
              <span aria-disabled="true" className="rounded-md px-3 py-1.5 text-muted-foreground">
                {t.label}
                <span className="sr-only"> (coming soon)</span>
              </span>
            )}
          </li>
        ))}
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
  const sp = await searchParams;
  const tab: TabKey = sp.tab === "timeline" ? "timeline" : "commitments";
  const { role, workspaceId } = viewer.membership;
  return (
    <div className="flex flex-col gap-6">
      <Tabs current={tab} />
      {tab === "timeline" ? (
        <Timeline workspaceId={workspaceId} params={parseTimelineParams(sp)} />
      ) : (
        <>
          <ExtractionPanel
            canRun={role === "outgoing_lead" || role === "advisor"}
            provider={process.env.LLM_PROVIDER === "fake" ? "fake" : "anthropic"}
            model={process.env.LLM_MODEL_FAST ?? "not configured"}
          />
          <Commitments workspaceId={workspaceId} />
        </>
      )}
    </div>
  );
}

export default function LedgerPage(props: PageProps<"/ledger">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ledger</h1>
        <p className="max-w-3xl text-muted-foreground">
          Commitments found in the records your role may read, each with a quote checked against its source. Recurring duties, conflicts and
          gaps arrive in later steps; the timeline shows every imported message.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading the timeline…</p>}>
        <LedgerContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
