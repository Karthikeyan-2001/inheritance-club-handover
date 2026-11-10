import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { VersionView } from "@/components/review/version-view";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Version · Inheritance" };

async function VersionContent({ params }: { params: PageProps<"/review/versions/[number]">["params"] }) {
  const { number } = await params;
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <p role="alert">Could not reach the database. Try again in a minute.</p>;
  }
  if (!viewer) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Sign in to see this version.</p>
        <Button asChild>
          <Link href="/login">Choose a demo account</Link>
        </Button>
      </div>
    );
  }
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return <p>That is not a version number.</p>;
  return <VersionView workspaceId={viewer.membership.workspaceId} number={n} />;
}

export default function VersionPage(props: PageProps<"/review/versions/[number]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Loading the version…</p>}>
        <VersionContent params={props.params} />
      </Suspense>
    </main>
  );
}
