import { Suspense } from "react";
import Link from "next/link";
import { RoleSwitcher } from "@/components/role-switcher";
import { StepIndicator } from "@/components/step-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/access";
import { DEMO_USERS } from "@/lib/demo/demo-users";
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
  const currentKey = DEMO_USERS.find((u) => u.email === viewer.email)?.key ?? null;
  const roleLabel = viewer.membership ? ROLE_LABELS[viewer.membership.role] : "No role";
  return <RoleSwitcher name={viewer.name} roleLabel={roleLabel} currentKey={currentKey} />;
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
