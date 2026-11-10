import { Suspense } from "react";
import Link from "next/link";
import { RoleSwitcher } from "@/components/role-switcher";
import { StepIndicator } from "@/components/step-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/access";
import { formatIstDate } from "@/lib/format";
import { getViewer } from "@/lib/session";

async function UserMenu() {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <span className="text-sm text-muted-foreground">Sign-in unavailable</span>;
  }
  if (!viewer) {
    return (
      <Button asChild size="sm">
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }
  const roleLabel = viewer.membership ? ROLE_LABELS[viewer.membership.role] : "No role";
  const copyUntil = viewer.membership?.sandboxExpiresAt ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {copyUntil && (
        <Badge variant="secondary" title="A private copy of the demo club, just for you">
          Your demo club · kept until {formatIstDate(copyUntil)}
        </Badge>
      )}
      <RoleSwitcher name={viewer.name} roleLabel={roleLabel} currentKey={viewer.demoKey} inCopy={copyUntil !== null} />
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Inheritance
          </Link>
          <Badge variant="outline">Synthetic demo</Badge>
          <Link href="/guide" className="text-sm underline-offset-4 hover:underline">
            Walkthrough
          </Link>
        </div>
        <Suspense fallback={<span className="text-sm text-muted-foreground">Checking sign-in…</span>}>
          <UserMenu />
        </Suspense>
      </div>
      <div className="mx-auto w-full max-w-5xl px-6 pb-3">
        <Suspense fallback={null}>
          <StepIndicator />
        </Suspense>
      </div>
    </header>
  );
}
