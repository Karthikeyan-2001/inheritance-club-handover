import { Suspense } from "react";
import type { Metadata } from "next";
import { AliasEditor } from "@/components/import/alias-editor";
import { DangerZone } from "@/components/import/danger-zone";
import { ImportForm } from "@/components/import/import-form";
import { SourceList } from "@/components/import/source-list";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { SignInPrompt } from "@/components/feedback/sign-in-prompt";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS_LABELS, ROLE_LABELS } from "@/lib/access";
import { SAMPLE_SETS, sampleUrl } from "@/lib/import/samples";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Add files · Inheritance" };

function Samples() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground" data-testid="sample-downloads">
      <p className="font-medium text-foreground">Or download the sample files and choose them yourself</p>
      <p>Prefer to download the sample files and choose them yourself? Each is synthetic; set it to the level shown:</p>
      {SAMPLE_SETS.map((set) => (
        <div key={set.dir}>
          <p className="font-medium text-foreground">{set.title}</p>
          <ul className="mt-1 list-disc pl-5">
            {set.files.map((f) => (
              <li key={f.file}>
                <a className="underline" href={sampleUrl(set.dir, f.file)} download={f.file}>
                  {f.label}
                </a>{" "}
                — set to <span className="font-medium text-foreground">{ACCESS_LABELS[f.level]}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

async function Welcome({ searchParams }: { searchParams: PageProps<"/import">["searchParams"] }) {
  const { welcome } = await searchParams;
  if (welcome !== "empty") return null;
  return (
    <p role="status" className="rise-in rounded-2xl border border-primary/20 bg-accent px-5 py-4 text-sm text-accent-foreground">
      Your empty club is ready, and you are signed in as Arun, the outgoing lead. Press “Use the 4 sample
      files”, tick the box and import. Then build the ledger.
    </p>
  );
}

async function ImportContent() {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database" />;
  }
  if (!viewer) return <SignInPrompt what="add files" />;
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;

  const { role, workspaceId, workspaceName } = viewer.membership;
  const canImport = role === "outgoing_lead" || role === "advisor";
  const supabase = await createSupabaseServerClient();
  const [{ data: ws }, { count: fileCount }] = await Promise.all([
    supabase.from("workspaces").select("is_demo").eq("id", workspaceId).maybeSingle(),
    supabase.from("sources").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {canImport && (fileCount ?? 0) > 0 && (
        <div className="rise-in flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-accent px-5 py-4" data-testid="next-step-bar">
          <p className="text-sm text-accent-foreground">
            <strong>{fileCount} {fileCount === 1 ? "file is" : "files are"} in.</strong> Add more below, or move on and read them.
          </p>
          <Button asChild>
            <Link href="/ledger">
              Next: build the ledger
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add files</CardTitle>
          <CardDescription>
            {workspaceName}. You are signed in as {ROLE_LABELS[role].toLowerCase()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canImport ? (
            <>
              <ImportForm />
              <Samples />
            </>
          ) : (
            <p className="text-sm">
              Only the outgoing lead or the faculty advisor can import files. Below are the files your role is allowed to see.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Files already added</CardTitle>
          <CardDescription>Only files your role may read are listed. Removing a file also removes its messages.</CardDescription>
        </CardHeader>
        <CardContent>
          <SourceList workspaceId={workspaceId} viewerId={viewer.userId} viewerRole={role} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Names that mean the same thing</CardTitle>
          <CardDescription>Optional. Tell Inheritance when two names are the same person or organisation, such as “Prof. Iyer” and “the advisor”.</CardDescription>
        </CardHeader>
        <CardContent>
          <AliasEditor workspaceId={workspaceId} canEdit={canImport} />
        </CardContent>
      </Card>

      {canImport && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Delete this club</CardTitle>
          </CardHeader>
          <CardContent>
            <DangerZone workspaceName={workspaceName} isDemo={ws?.is_demo ?? true} isCopy={viewer.membership.sandboxExpiresAt !== null} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ImportPage(props: PageProps<"/import">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title="Add files"
        purpose="Bring in the club's WhatsApp exports, Trello board and meeting minutes, and choose who may see each one. Next you build the ledger from them."
      />
      <Suspense fallback={null}>
        <Welcome searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<LoadingBlock label="Loading your files…" variant="cards" rows={2} />}>
        <ImportContent />
      </Suspense>
    </main>
  );
}
