import { Suspense } from "react";
import type { Metadata } from "next";
import { VersionView } from "@/components/review/version-view";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { SignInPrompt } from "@/components/feedback/sign-in-prompt";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Version · Inheritance" };

async function VersionContent({ params }: { params: PageProps<"/review/versions/[number]">["params"] }) {
  const { number } = await params;
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database" />;
  }
  if (!viewer) return <SignInPrompt what="see this version" />;
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return <p>That is not a version number.</p>;
  return <VersionView workspaceId={viewer.membership.workspaceId} number={n} />;
}

export default function VersionPage(props: PageProps<"/review/versions/[number]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <Suspense fallback={<LoadingBlock label="Loading the version…" variant="list" rows={4} />}>
        <VersionContent params={props.params} />
      </Suspense>
    </main>
  );
}
