import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { signInAsDemo } from "@/app/actions/auth";
import { loadDemoClub, returnToDemoClub } from "@/app/actions/demo-club";
import { PendingButton } from "@/components/demo/pending-button";
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
      <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
        {message}
      </p>
    );
  }
  const info = typeof notice === "string" ? NOTICES[notice] : undefined;
  if (!info) return null;
  return (
    <p role="status" className="rounded-md border px-4 py-3 text-sm">
      {info}
    </p>
  );
}

function LoadForm({ fresh = false }: { fresh?: boolean }) {
  return (
    <form action={loadDemoClub}>
      <PendingButton variant={fresh ? "outline" : "default"} pendingLabel="Building your demo club… (a few seconds)">
        {fresh ? "Start a fresh copy instead" : "Load demo club"}
      </PendingButton>
    </form>
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
      <p className="text-xs text-muted-foreground">A fresh copy replaces your current one, which is then deleted.</p>
    </div>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  const password = process.env.DEMO_USER_PASSWORD;
  const days = Math.round(SANDBOX_TTL_HOURS / 24);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">Synthetic demo data</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Try Inheritance</h1>
        <p className="max-w-2xl text-muted-foreground">
          The demo club, its people and its messages are invented. Each demo account has a
          different role in the club, and switching accounts changes what the database lets you
          read: permissions are enforced by Postgres row-level security, not by hiding things on
          screen.
        </p>
      </div>

      <Suspense fallback={null}>
        <LoginMessage searchParams={props.searchParams} />
      </Suspense>

      <section aria-labelledby="own-club">
        <Card>
          <CardHeader>
            <CardTitle id="own-club" className="text-xl">Your own demo club</CardTitle>
            <CardDescription>Recommended. Nothing you do here reaches other visitors.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="max-w-3xl">
              Builds a private copy of the synthetic club for you, with four accounts of its own: Arun
              (outgoing lead), Dr. Meena (faculty advisor), Kavya (incoming lead) and Divya (treasurer).
              It holds the source messages, a ledger with version 1 approved, and items still to review.
              You start as Arun; switch roles from the menu at the top right. The copy and its accounts
              are deleted after {days} days.
            </p>
            <Suspense fallback={<LoadForm />}>
              <CopyActions />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="shared-accounts" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="shared-accounts" className="text-xl font-semibold tracking-tight">Or use the shared demo accounts</h2>
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
