import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { HandoverView } from "@/components/handover/handover-view";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/session";
import { istToday } from "@/lib/time";

export const metadata: Metadata = { title: "Handover · Inheritance" };

async function HandoverContent() {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <p role="alert">Could not reach the database. Try again in a minute.</p>;
  }
  if (!viewer) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Sign in to see the handover.</p>
        <Button asChild>
          <Link href="/login">Choose a demo account</Link>
        </Button>
      </div>
    );
  }
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const { role, workspaceId } = viewer.membership;
  // Today in IST, for "overdue" and "start now".
  const today = istToday();
  return <HandoverView workspaceId={workspaceId} role={role} userId={viewer.userId} today={today} />;
}

export default function HandoverPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Handover</h1>
        <p className="max-w-3xl text-muted-foreground">
          What the outgoing committee leaves behind, from the latest approved version: who is waiting, what recurs and when to start. Every item shows its quotes or says “No evidence kept”. The incoming lead
          accepts, questions or declines each item; every answer is recorded.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading the handover…</p>}>
        <HandoverContent />
      </Suspense>
    </main>
  );
}
