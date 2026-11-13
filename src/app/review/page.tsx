import { Suspense } from "react";
import type { Metadata } from "next";
import { Conflicts } from "@/components/review/conflicts";
import { Draft } from "@/components/review/draft";
import { History } from "@/components/review/history";
import { Versions } from "@/components/review/versions";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { ErrorState } from "@/components/feedback/error-state";
import { SignInPrompt } from "@/components/feedback/sign-in-prompt";
import { PageHeader } from "@/components/page-header";
import { TabNav } from "@/components/tab-nav";
import type { AppRole } from "@/lib/access";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Review · Inheritance" };

const TABS = [
  { key: "draft", label: "Check and sign off", hint: "Accept items, mark ready, approve" },
  { key: "conflicts", label: "Rulings", hint: "Records that disagree, and the advisor's rulings" },
  { key: "versions", label: "Approved versions", hint: "Versions that can never change" },
  { key: "history", label: "Audit history", hint: "Every review action, with who and why" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Who sees which tab. The database still decides what each tab can read. */
function tabsFor(role: AppRole): TabKey[] {
  if (role === "outgoing_lead" || role === "advisor") return ["draft", "conflicts", "versions", "history"];
  if (role === "treasurer") return ["conflicts", "versions"];
  return ["versions"];
}

async function ReviewContent({ searchParams }: { searchParams: PageProps<"/review">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database" />;
  }
  if (!viewer) return <SignInPrompt what="review the ledger" />;
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const { role, workspaceId } = viewer.membership;
  const allowed = tabsFor(role);
  const sp = await searchParams;
  const asked = TABS.find((t) => t.key === sp.tab)?.key;
  const tab: TabKey = asked && allowed.includes(asked) ? asked : allowed[0];
  return (
    <div className="flex flex-col gap-6">
      <TabNav label="Review sections" basePath="/review" tabs={TABS.filter((t) => allowed.includes(t.key))} current={tab} />
      {tab === "draft" ? (
        <Draft role={role} workspaceId={workspaceId} />
      ) : tab === "conflicts" ? (
        <Conflicts workspaceId={workspaceId} canRule={role === "advisor"} />
      ) : tab === "history" ? (
        <History workspaceId={workspaceId} />
      ) : (
        <Versions workspaceId={workspaceId} />
      )}
    </div>
  );
}

export default function ReviewPage(props: PageProps<"/review">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title="Review"
        purpose="The outgoing lead checks each item against its quotes and marks the draft ready. The faculty advisor approves it as a version that can never change. The incoming lead sees only approved versions."
      />
      <Suspense fallback={<LoadingBlock label="Loading the review…" variant="list" rows={4} />}>
        <ReviewContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
