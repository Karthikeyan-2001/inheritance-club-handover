import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Commitments } from "@/components/ledger/commitments";
import { Gaps } from "@/components/ledger/gaps";
import { TrustLegend } from "@/components/ledger/trust-legend";
import { Docket } from "@/components/ledger/docket";
import { PipelinePanel } from "@/components/ledger/pipeline-panel";
import { Recurring } from "@/components/ledger/recurring";
import { Timeline } from "@/components/ledger/timeline";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { ErrorState } from "@/components/feedback/error-state";
import { SignInPrompt } from "@/components/feedback/sign-in-prompt";
import { PageHeader } from "@/components/page-header";
import { TabNav } from "@/components/tab-nav";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/session";
import { parseTimelineParams } from "@/lib/timeline-query";

export const metadata: Metadata = { title: "Ledger · Inheritance" };

const TABS = [
  { key: "commitments", label: "Promises", hint: "Things the committee promised to people" },
  { key: "recurring", label: "Yearly duties", hint: "Duties that come round every cycle, with their approvals" },
  { key: "docket", label: "Conflicts", hint: "Records that disagree with each other" },
  { key: "gaps", label: "Gaps", hint: "Things the records do not say" },
  { key: "timeline", label: "All messages", hint: "Every imported message, searchable" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

async function LedgerContent({ searchParams }: { searchParams: PageProps<"/ledger">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database" />;
  }
  if (!viewer) return <SignInPrompt what="see the ledger" />;
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const sp = await searchParams;
  const tab: TabKey = sp.tab === "timeline" || sp.tab === "recurring" || sp.tab === "docket" || sp.tab === "gaps" ? sp.tab : "commitments";
  const { role, workspaceId } = viewer.membership;
  const sealed = (role === "incoming_lead" || role === "member") && tab !== "timeline";
  return (
    <div className="flex flex-col gap-6">
      <TabNav label="Ledger sections" basePath="/ledger" tabs={TABS} current={tab} />
      {sealed ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-sm" data-testid="working-ledger-notice">
          <p>
            The working ledger is visible to the outgoing committee and the advisor until a version is approved. You see what has been checked and approved.
          </p>
          <Button asChild>
            <Link href="/review?tab=versions">See approved versions</Link>
          </Button>
        </div>
      ) : tab === "timeline" ? (
        <Timeline workspaceId={workspaceId} params={parseTimelineParams(sp)} />
      ) : tab === "docket" ? (
        <>
          <TrustLegend />
          <Docket workspaceId={workspaceId} />
        </>
      ) : tab === "gaps" ? (
        <Gaps workspaceId={workspaceId} />
      ) : (
        <>
          <PipelinePanel
            canRun={role === "outgoing_lead" || role === "advisor"}
            provider={process.env.LLM_PROVIDER === "fake" ? "fake" : "anthropic"}
            model={process.env.LLM_MODEL_FAST ?? "not configured"}
          />
          <TrustLegend />
          {tab === "recurring" ? <Recurring workspaceId={workspaceId} /> : <Commitments workspaceId={workspaceId} />}
        </>
      )}
    </div>
  );
}

export default function LedgerPage(props: PageProps<"/ledger">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title="Ledger"
        purpose="Everything the old committee promised or must do each year, found in the records your role may read. Each item shows its quote and what happened next, or “No evidence kept”."
      />
      <Suspense fallback={<LoadingBlock label="Loading the ledger…" variant="list" rows={4} />}>
        <LedgerContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
