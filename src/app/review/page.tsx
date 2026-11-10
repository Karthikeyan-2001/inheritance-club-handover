import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Conflicts } from "@/components/review/conflicts";
import { Draft } from "@/components/review/draft";
import { History } from "@/components/review/history";
import { Versions } from "@/components/review/versions";
import { Button } from "@/components/ui/button";
import type { AppRole } from "@/lib/access";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Review · Inheritance" };

const TABS = [
  { key: "draft", label: "Draft" },
  { key: "conflicts", label: "Conflicts" },
  { key: "versions", label: "Versions" },
  { key: "history", label: "History" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Who sees which tab. The database still decides what each tab can read. */
function tabsFor(role: AppRole): TabKey[] {
  if (role === "outgoing_lead" || role === "advisor") return ["draft", "conflicts", "versions", "history"];
  if (role === "treasurer") return ["conflicts", "versions"];
  return ["versions"];
}

function Tabs({ current, allowed }: { current: TabKey; allowed: TabKey[] }) {
  return (
    <nav aria-label="Review sections">
      <ul className="flex flex-wrap gap-2 border-b pb-2 text-sm">
        {TABS.filter((t) => allowed.includes(t.key)).map((t) => (
          <li key={t.key}>
            <Link
              href={`/review?tab=${t.key}`}
              aria-current={t.key === current ? "page" : undefined}
              className={t.key === current ? "rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground" : "rounded-md px-3 py-1.5 hover:bg-accent"}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

async function ReviewContent({ searchParams }: { searchParams: PageProps<"/review">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <p role="alert">Could not reach the database. Try again in a minute.</p>;
  }
  if (!viewer) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Sign in to review.</p>
        <Button asChild>
          <Link href="/login">Choose a demo account</Link>
        </Button>
      </div>
    );
  }
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const { role, workspaceId } = viewer.membership;
  const allowed = tabsFor(role);
  const sp = await searchParams;
  const asked = TABS.find((t) => t.key === sp.tab)?.key;
  const tab: TabKey = asked && allowed.includes(asked) ? asked : allowed[0];
  return (
    <div className="flex flex-col gap-6">
      <Tabs current={tab} allowed={allowed} />
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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Review</h1>
        <p className="max-w-3xl text-muted-foreground">
          The outgoing lead checks each item against its quotes, then marks the accepted draft ready. The faculty advisor rules on conflicts and approves it as a version that can never be
          changed. Every action needs a reason and is written to the audit log. The incoming lead sees only approved versions.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading the review…</p>}>
        <ReviewContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
