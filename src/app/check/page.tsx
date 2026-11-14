import { Suspense } from "react";
import type { Metadata } from "next";
import { Docket } from "@/components/ledger/docket";
import { Gaps } from "@/components/ledger/gaps";
import { loadQuestions } from "@/components/check/question-data";
import { Questions } from "@/components/check/questions";
import { TrustLegend } from "@/components/ledger/trust-legend";
import { WorkingLedgerNotice } from "@/components/ledger/working-ledger-notice";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { SignInPrompt } from "@/components/feedback/sign-in-prompt";
import { NextStepBar } from "@/components/next-step-bar";
import { PageHeader } from "@/components/page-header";
import { TabNav } from "@/components/tab-nav";
import { findGaps, type GapInput } from "@/lib/ledger-view";
import { openCount } from "@/lib/questions";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { istToday } from "@/lib/time";

export const metadata: Metadata = { title: "Check the records · Inheritance" };

const TABS = [
  { key: "conflicts", label: "Conflicts", hint: "Records that disagree with each other" },
  { key: "gaps", label: "Gaps", hint: "Things the records do not say" },
  { key: "questions", label: "Questions", hint: "Gaps the outgoing lead can answer" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function CheckContent({ searchParams }: { searchParams: PageProps<"/check">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database" />;
  }
  if (!viewer) return <SignInPrompt what="check the records" />;
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const { role, workspaceId } = viewer.membership;
  if (role === "incoming_lead" || role === "member") return <WorkingLedgerNotice />;
  const sp = await searchParams;
  // Anything else (including the old "docket" from links made before this page) is conflicts.
  const tab: TabKey = sp.tab === "gaps" || sp.tab === "questions" ? sp.tab : "conflicts";

  // Counts for the tabs and the next-step bar, read through RLS like everything else here.
  const supabase = await createSupabaseServerClient();
  const [docket, items, asked] = await Promise.all([
    supabase.from("docket_entries").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("obligations").select("id, kind, description, status, trust_state, next_due, fulfilment_checked_at").eq("workspace_id", workspaceId),
    loadQuestions(supabase, workspaceId),
  ]);
  const conflicts = docket.error ? null : (docket.count ?? 0);
  const gaps = items.error ? null : findGaps((items.data ?? []) as unknown as GapInput[]).length;
  const questions = asked.error ? null : openCount(asked.questions);
  const lead = role === "outgoing_lead";
  const counted = (key: TabKey, label: string) => {
    const n = key === "conflicts" ? conflicts : key === "gaps" ? gaps : questions;
    const name = key === "questions" && lead ? "Questions for you" : label;
    return n === null ? name : `${name} (${n})`;
  };
  const reviewer = role === "outgoing_lead" || role === "advisor";
  // The lead answers what they can before reviewing; once on the questions, review is next.
  const toQuestions = lead && tab !== "questions" && (questions ?? 0) > 0;
  return (
    <div className="flex flex-col gap-6">
      <TabNav label="Check sections" basePath="/check" tabs={TABS.map((t) => ({ ...t, label: counted(t.key, t.label) }))} current={tab} />
      {tab === "conflicts" ? (
        <>
          <TrustLegend />
          <Docket workspaceId={workspaceId} />
        </>
      ) : tab === "gaps" ? (
        <Gaps workspaceId={workspaceId} />
      ) : asked.error ? (
        <ErrorState title="Could not load the questions">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>
      ) : (
        <Questions questions={asked.questions} canAnswer={lead} today={istToday()} />
      )}
      {toQuestions ? (
        <NextStepBar label={`Next: answer ${plural(questions!, "question")}`} href="/check?tab=questions">
          {conflicts !== null && gaps !== null && (
            <strong>
              {plural(conflicts, "conflict")} and {plural(gaps, "gap")}.{" "}
            </strong>
          )}
          You can close some of them yourself: say what happened, and each answer becomes a quote on its item.
        </NextStepBar>
      ) : (
        <NextStepBar label={reviewer ? "Next: review and approve" : undefined} href={reviewer ? "/review" : undefined}>
          {conflicts !== null && gaps !== null && (
            <strong>
              {plural(conflicts, "conflict")} and {plural(gaps, "gap")}.{" "}
            </strong>
          )}
          {reviewer
            ? tab === "questions" && lead
              ? "Next, accept or reject each item. Accepted items your answers changed need accepting again; then the advisor approves the handover."
              : "Next, accept or reject each item; then the advisor approves the handover."
            : "The outgoing lead and the advisor review these before anything is handed over."}
        </NextStepBar>
      )}
    </div>
  );
}

export default function CheckPage(props: PageProps<"/check">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title="Check the records"
        purpose="Where the club's records disagree with each other, what they never say, and the questions the outgoing lead can answer about it. Look here before reviewing, so nothing is handed over as fact by mistake."
      />
      <Suspense fallback={<LoadingBlock label="Looking for conflicts and gaps…" variant="list" rows={3} />}>
        <CheckContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
