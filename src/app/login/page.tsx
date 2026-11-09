import { Suspense } from "react";
import type { Metadata } from "next";
import { signInAsDemo } from "@/app/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/access";
import { DEMO_USERS } from "@/lib/demo/demo-users";

export const metadata: Metadata = { title: "Sign in · Inheritance" };

const ERRORS: Record<string, string> = {
  "unknown-user": "That demo account does not exist.",
  "not-configured": "Sign-in is not configured on this deployment yet (Supabase settings are missing).",
  "sign-in-failed": "Sign-in failed. The demo accounts may not be seeded yet.",
};

async function LoginError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
      {message}
    </p>
  );
}

export default function LoginPage(props: PageProps<"/login">) {
  const password = process.env.DEMO_USER_PASSWORD;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">Synthetic demo data</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Choose a demo account</h1>
        <p className="max-w-2xl text-muted-foreground">
          Each account has a different role in the same synthetic club. Switching accounts
          changes what the database lets you read: permissions are enforced by Postgres
          row-level security, not by hiding things on screen. These accounts are shared by
          everyone trying the demo.
        </p>
      </div>

      <Suspense fallback={null}>
        <LoginError searchParams={props.searchParams} />
      </Suspense>

      <ul className="grid gap-4 sm:grid-cols-2" aria-label="Demo accounts">
        {DEMO_USERS.map((u) => (
          <li key={u.key}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-xl">{u.name}</CardTitle>
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
                  <Button type="submit" className="w-full">
                    Sign in as {u.name}
                  </Button>
                </form>
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
