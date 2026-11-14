import { Suspense } from "react";
import type { Metadata } from "next";
import { Timeline } from "@/components/ledger/timeline";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { SignInPrompt } from "@/components/feedback/sign-in-prompt";
import { PageHeader } from "@/components/page-header";
import { getViewer } from "@/lib/session";
import { parseTimelineParams } from "@/lib/timeline-query";

export const metadata: Metadata = { title: "All messages · Inheritance" };

// Not a step of the handover: the raw messages behind every step, for looking things up.
async function MessagesContent({ searchParams }: { searchParams: PageProps<"/messages">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database" />;
  }
  if (!viewer) return <SignInPrompt what="read the messages" />;
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  return <Timeline workspaceId={viewer.membership.workspaceId} params={parseTimelineParams(await searchParams)} />;
}

export default function MessagesPage(props: PageProps<"/messages">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title="All messages"
        purpose="Every imported message your role may read, in time order. Search by file or by words to find what a claim rests on."
      />
      <Suspense fallback={<LoadingBlock label="Loading the messages…" variant="list" rows={5} />}>
        <MessagesContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
