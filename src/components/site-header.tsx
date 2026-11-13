import { Suspense } from "react";
import Link from "next/link";
import { RoleSwitcher } from "@/components/role-switcher";
import { StepIndicator } from "@/components/step-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
        <Badge variant="secondary" title="A private copy of the demo club, just for you" className="hidden md:inline-flex">
          Your demo club · kept until {formatIstDate(copyUntil)}
        </Badge>
      )}
      <RoleSwitcher name={viewer.name} roleLabel={roleLabel} currentKey={viewer.demoKey} inCopy={copyUntil !== null} />
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-primary">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
              I
            </span>
            Inheritance
          </Link>
          <Badge variant="secondary" title="Every person, club and message in this app is invented">
            Synthetic demo
          </Badge>
        </div>
        <Suspense fallback={<Skeleton className="h-10 w-44 rounded-lg" />}>
          <UserMenu />
        </Suspense>
      </div>
      <div className="mx-auto w-full max-w-5xl px-4 pb-3 sm:px-6">
        <Suspense fallback={null}>
          <StepIndicator />
        </Suspense>
      </div>
    </header>
  );
}
