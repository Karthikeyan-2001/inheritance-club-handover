import { Suspense } from "react";
import type { Metadata } from "next";
import { HandoverView } from "@/components/handover/handover-view";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { ErrorState } from "@/components/feedback/error-state";
import { SignInPrompt } from "@/components/feedback/sign-in-prompt";
import { PageHeader } from "@/components/page-header";
import { getViewer } from "@/lib/session";
import { istToday } from "@/lib/time";

export const metadata: Metadata = { title: "Handover · Inheritance" };

async function HandoverContent() {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database" />;
  }
  if (!viewer) return <SignInPrompt what="see the handover" />;
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const { role, workspaceId } = viewer.membership;
  // Today in IST, for "overdue" and "start now".
  const today = istToday();
  return <HandoverView workspaceId={workspaceId} role={role} userId={viewer.userId} today={today} />;
}

export default function HandoverPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title="Handover"
        purpose="What the outgoing committee leaves behind, from the latest approved version: who is waiting, what recurs and when to start. The incoming lead accepts, questions or declines each item."
      />
      <Suspense fallback={<LoadingBlock label="Loading the handover…" variant="list" rows={4} />}>
        <HandoverContent />
      </Suspense>
    </main>
  );
}
