import Link from "next/link";
import { LogInIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown on a page that needs a signed-in person: what they would see, and one button to get there. */
export function SignInPrompt({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-6 shadow-sm shadow-primary/5">
      <p className="font-semibold">Sign in to {what}</p>
      <p className="text-sm text-muted-foreground">The demo takes about half a minute to set up and everything in it is invented.</p>
      <Button asChild>
        <Link href="/login">
          <LogInIcon aria-hidden="true" />
          Choose a demo account
        </Link>
      </Button>
    </div>
  );
}
