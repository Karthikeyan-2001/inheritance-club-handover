import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { signInAsDemo } from "@/app/actions/auth";
import { loadDemoClub, returnToDemoClub } from "@/app/actions/demo-club";
import { PendingButton } from "@/components/demo/pending-button";
import { BuildProgress } from "@/components/feedback/build-progress";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/access";
import { DEMO_USERS } from "@/lib/demo/demo-users";
import { SANDBOX_COOKIE, SANDBOX_TTL_HOURS, readSandboxCookie } from "@/lib/demo/sandbox";
import { sandboxConfig } from "@/lib/demo/sandbox-server";
import { formatIst } from "@/lib/format";

export const metadata: Metadata = { title: "Sign in · Inheritance" };

// Building a copy takes a few seconds (accounts, the club, the sign-off of version 1).
export const maxDuration = 60;

const ERRORS: Record<string, string> = {
  "unknown-user": "That demo account does not exist.",
  "not-configured": "Sign-in is not configured on this deployment yet (Supabase settings are missing).",
  "sign-in-failed": "Sign-in failed. The demo accounts may not be seeded yet.",
  "copy-not-configured": "Personal demo clubs are not configured on this deployment (the server's Supabase secret key is missing). The shared accounts below still work.",
  "copy-full": "Too many personal demo clubs are active right now. Please use the shared accounts below, or try again later.",
  "copy-busy": "Many personal demo clubs were started in the last hour. Please try again in a few minutes, or use the shared accounts below.",
  "copy-failed": "Your demo club could not be created. Please try again; if it keeps failing, use the shared accounts below.",
  "copy-expired": "Your demo club has expired or was deleted. Load a new one below.",
  "copy-missing": "You are not signed in to a demo club of your own, so there is no role to switch to there.",
};

const NOTICES: Record<string, string> = {
  "copy-deleted": "Your demo club and its four accounts were deleted.",
};

async function LoginMessage({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error, notice } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  if (message) {
    return (
      <p role="alert" className="rounded-2xl border border-destructive/25 bg-danger-soft px-5 py-4 text-sm text-foreground">
        {message}
      </p>
    );
  }
  const info = typeof notice === "string" ? NOTICES[notice] : undefined;
  if (!info) return null;
  return (
    <p role="status" className="rounded-2xl border border-primary/20 bg-accent px-5 py-4 text-sm text-accent-foreground">
      {info}
    </p>
  );
}

/** The two kinds of copy a visitor can start. */
function LoadForm({ fresh = false }: { fresh?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <form action={loadDemoClub} className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <input type="hidden" name="club" value="year" />
        <p className="text-base font-semibold">Explore a finished handover</p>
        <p className="text-xs font-medium text-primary">Best for a quick look</p>
        <p className="text-muted-foreground">
          A year of an IoT club&apos;s records (about 2,000 messages in five files at four access
          levels), the ledger built from them, version 1 approved, and a few items still to review.
        </p>
        <PendingButton variant={fresh ? "outline" : "default"} pendingLabel="Building your demo club…">
          {fresh ? "Start a fresh built club" : "Explore a built handover"}
        </PendingButton>
        <BuildProgress steps={["Creating four accounts…", "Loading a year of messages…", "Checking every quote…", "Approving version 1…"]} />
      </form>
      <form action={loadDemoClub} className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <input type="hidden" name="club" value="empty" />
        <p className="text-base font-semibold">Build one yourself</p>
        <p className="text-xs font-medium text-primary">Best for the full flow</p>
        <p className="text-muted-foreground">
          The same four people and nothing else. Import the synthetic sample files (or your own
          exports), build the ledger, review it, approve it and hand it over yourself.
        </p>
        <PendingButton variant="outline" pendingLabel="Creating your empty club…">
          {fresh ? "Start a fresh empty club" : "Start from your own files"}
        </PendingButton>
        <BuildProgress steps={["Creating four accounts…", "Setting up an empty club…"]} expectedSeconds={8} />
      </form>
    </div>
  );
}

/** Offers "Return to your demo club" when the visitor's signed cookie names a live copy. */
async function CopyActions() {
  await connection();
  const cfg = sandboxConfig();
  if (!cfg) {
    return <p className="text-sm text-muted-foreground">Personal demo clubs are not configured on this deployment.</p>;
  }
  const saved = readSandboxCookie(cfg.secret, (await cookies()).get(SANDBOX_COOKIE)?.value, new Date());
  if (!saved) return <LoadForm />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">You already have a demo club, kept until {formatIst(saved.expiresAt.toISOString())}.</p>
      <div className="flex flex-wrap gap-3">
        <form action={returnToDemoClub}>
          <PendingButton pendingLabel="Signing you in…">Return to your demo club</PendingButton>
        </form>
        <LoadForm fresh />
      </div>
      <p className="text-xs text-muted-foreground">A fresh club replaces your current one, which is then deleted.</p>
    </div>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  const password = process.env.DEMO_USER_PASSWORD;
  const days = Math.round(SANDBOX_TTL_HOURS / 24);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        title="Try Inheritance"
        purpose="Pick a club to explore. The club, its people and its messages are all invented, and what you do in your own copy never reaches anyone else."
      >
        <Badge variant="secondary" className="w-fit">Synthetic demo data</Badge>
      </PageHeader>

      <Suspense fallback={null}>
        <LoginMessage searchParams={props.searchParams} />
      </Suspense>

      <section aria-labelledby="own-club">
        <Card>
          <CardHeader>
            <CardTitle id="own-club" className="text-xl">Start here: your own demo club</CardTitle>
            <CardDescription>Recommended. Nothing you do here reaches other visitors.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="max-w-3xl">
              Builds a private club for you, with four people: Arun (outgoing lead), Dr. Meena
              (faculty advisor), Kavya (incoming lead) and Divya (treasurer). You start as Arun, and
              the home page then tells you what to do next. Switch person from the menu at the top
              right. The club and its accounts are deleted after {days} days.
            </p>
            <Suspense fallback={<LoadForm />}>
              <CopyActions />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="shared-accounts" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="shared-accounts" className="text-xl font-semibold tracking-tight">Or sign in to the shared club</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            These accounts and their club are shared by everyone trying the demo, so another
            visitor&apos;s reviews and answers show up here too.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Shared demo accounts">
          {DEMO_USERS.map((u) => (
            <li key={u.key}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-lg">{u.name}</CardTitle>
                  <CardDescription>{ROLE_LABELS[u.role]}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p>{u.summary}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                    <dt>Email</dt>
                    <dd className="font-mono">{u.email}</dd>
                    <dt>Password</dt>
                    <dd className="font-mono">{password ?? "(not configured)"}</dd>
                  </dl>
                </CardContent>
                <CardFooter>
                  <form action={signInAsDemo} className="w-full">
                    <input type="hidden" name="user" value={u.key} />
                    <input type="hidden" name="club" value="shared" />
                    <Button type="submit" variant="outline" className="w-full">
                      Sign in as {u.name}
                    </Button>
                  </form>
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
