import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AliasEditor } from "@/components/import/alias-editor";
import { DangerZone } from "@/components/import/danger-zone";
import { ImportForm } from "@/components/import/import-form";
import { SourceList } from "@/components/import/source-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/access";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Connect · Inheritance" };

const SAMPLES = [
  ["whatsapp-committee.txt", "Committee chat (WhatsApp)"],
  ["trello-board.json", "Trello board"],
  ["minutes.md", "Minutes (try setting this one to Finance)"],
] as const;

async function ImportContent() {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <p role="alert">Could not reach the database. Try again in a minute.</p>;
  }
  if (!viewer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to import files</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">Choose a demo account</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!viewer.membership) return <p>Your account is not a member of a workspace.</p>;

  const { role, workspaceId, workspaceName } = viewer.membership;
  const canImport = role === "outgoing_lead" || role === "advisor";
  const supabase = await createSupabaseServerClient();
  const { data: ws } = await supabase.from("workspaces").select("is_demo").eq("id", workspaceId).maybeSingle();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Import files</CardTitle>
          <CardDescription>
            {workspaceName}. You are signed in as {ROLE_LABELS[role].toLowerCase()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canImport ? (
            <>
              <ImportForm />
              <div className="text-sm text-muted-foreground">
                <p>No files of your own? Download the synthetic sample files and import them:</p>
                <ul className="mt-1 list-disc pl-5">
                  {SAMPLES.map(([file, label]) => (
                    <li key={file}>
                      <a className="underline" href={`/samples/mini/${file}`} download>
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
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
          <CardTitle>Imported files</CardTitle>
          <CardDescription>Only files your role may read are listed. Removing a file also removes its messages.</CardDescription>
        </CardHeader>
        <CardContent>
          <SourceList workspaceId={workspaceId} viewerId={viewer.userId} viewerRole={role} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aliases</CardTitle>
          <CardDescription>Tell Inheritance when different names mean the same person or organisation.</CardDescription>
        </CardHeader>
        <CardContent>
          <AliasEditor workspaceId={workspaceId} canEdit={canImport} />
        </CardContent>
      </Card>

      {canImport && (
        <Card>
          <CardHeader>
            <CardTitle>Delete workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <DangerZone workspaceName={workspaceName} isDemo={ws?.is_demo ?? true} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ImportPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Connect</h1>
        <p className="max-w-3xl text-muted-foreground">
          Bring in the club&apos;s WhatsApp exports, Trello board and meeting minutes. Choose who may see each file before importing it.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ImportContent />
      </Suspense>
    </main>
  );
}
