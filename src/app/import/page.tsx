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

// Synthetic sample files. The photography club is the fuller one: four files at four levels.
const SAMPLE_SETS = [
  {
    dir: "photo",
    title: "Photography club, one term (recommended)",
    files: [
      ["whatsapp-committee.txt", "Committee chat (WhatsApp, iPhone export)", "Committee"],
      ["whatsapp-accounts.txt", "Accounts chat (WhatsApp)", "Finance"],
      ["WhatsApp Chat with Prof. Iyer.txt", "Arun's one-to-one chat with the advisor", "Private"],
      ["minutes.docx", "Meeting minutes (Word)", "Committee"],
    ],
  },
  {
    dir: "mini",
    title: "IoT club, a few weeks (small)",
    files: [
      ["whatsapp-committee.txt", "Committee chat (WhatsApp)", "Committee"],
      ["trello-board.json", "Trello board", "Committee"],
      ["minutes.md", "Minutes", "Finance"],
    ],
  },
] as const;

function Samples() {
  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground">
      <p>No files of your own? Download a set of synthetic sample files, then import each one at the level shown:</p>
      {SAMPLE_SETS.map((set) => (
        <div key={set.dir}>
          <p className="font-medium text-foreground">{set.title}</p>
          <ul className="mt-1 list-disc pl-5">
            {set.files.map(([file, label, level]) => (
              <li key={file}>
                <a className="underline" href={`/samples/${set.dir}/${encodeURIComponent(file)}`} download={file}>
                  {label}
                </a>{" "}
                — set to <span className="font-medium text-foreground">{level}</span>
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
    <p role="status" className="rounded-md border px-4 py-3 text-sm">
      Your empty club is ready, and you are signed in as Arun, the outgoing lead. Step 1: download the
      photography club&apos;s four sample files below and import each at the level shown (you can choose
      several files at once). Step 2: open Ledger and press Build the ledger. Then review it, mark it
      ready, and switch to Dr. Meena to approve it.
    </p>
  );
}

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
            <DangerZone workspaceName={workspaceName} isDemo={ws?.is_demo ?? true} isCopy={viewer.membership.sandboxExpiresAt !== null} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ImportPage(props: PageProps<"/import">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Connect</h1>
        <p className="max-w-3xl text-muted-foreground">
          Bring in the club&apos;s WhatsApp exports, Trello board and meeting minutes. Choose who may see each file before importing it.
        </p>
      </div>
      <Suspense fallback={null}>
        <Welcome searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ImportContent />
      </Suspense>
    </main>
  );
}
