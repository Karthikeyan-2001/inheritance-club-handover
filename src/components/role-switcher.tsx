"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ChevronDownIcon, UsersIcon } from "lucide-react";
import { signInAsDemo, signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/access";
import { DEMO_USERS, type DemoUserKey } from "@/lib/demo/demo-users";

/** Covers the page while a switch is under way (it takes a few seconds), so nothing can be pressed twice. */
function SwitchingOverlay() {
  const { pending, data } = useFormStatus();
  if (!pending) return null;
  const who = DEMO_USERS.find((u) => u.key === data?.get("user"));
  const signingOut = !who;
  return (
    <div role="status" aria-live="assertive" className="fixed inset-0 z-[60] grid place-items-center bg-background/80 backdrop-blur-sm">
      <div className="rise-in flex items-center gap-3 rounded-2xl border bg-card px-6 py-4 shadow-lg shadow-primary/10">
        <Spinner className="size-5 text-primary" />
        <div>
          <p className="font-medium">{signingOut ? "Signing you out…" : `Switching to ${who.name}…`}</p>
          {!signingOut && <p className="text-sm text-muted-foreground">Loading what a {ROLE_LABELS[who.role].toLowerCase()} is allowed to read.</p>}
        </div>
      </div>
    </div>
  );
}

// Menu items are plain Radix items that submit forms living OUTSIDE the menu. Native
// <button>s inside menu items get activated by the same keypress that opens the menu,
// which would switch accounts unintentionally for keyboard users.
export function RoleSwitcher({
  name,
  roleLabel,
  currentKey,
  inCopy,
}: {
  name: string;
  roleLabel: string;
  currentKey: DemoUserKey | null;
  /** Signed in to the visitor's own copy of the demo club: switch among its accounts. */
  inCopy: boolean;
}) {
  const pathname = usePathname();
  const switchForm = useRef<HTMLFormElement>(null);
  const userInput = useRef<HTMLInputElement>(null);
  const signOutForm = useRef<HTMLFormElement>(null);

  function switchTo(key: DemoUserKey) {
    if (!switchForm.current || !userInput.current) return;
    userInput.current.value = key;
    switchForm.current.requestSubmit();
  }

  return (
    <>
      <form ref={switchForm} action={signInAsDemo} hidden>
        <input ref={userInput} type="hidden" name="user" defaultValue="" />
        <input type="hidden" name="next" value={pathname} />
        <input type="hidden" name="club" value={inCopy ? "mine" : "shared"} />
        <SwitchingOverlay />
      </form>
      <form ref={signOutForm} action={signOut} hidden>
        <SwitchingOverlay />
      </form>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label={`Signed in as ${name}, ${roleLabel}. Switch demo role`} className="h-11 gap-2.5 rounded-full pr-3 pl-1.5">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {name.replace(/^Dr\.\s*/, "").charAt(0).toUpperCase()}
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="font-semibold">{name}</span>
              <span className="text-xs font-normal text-muted-foreground">{roleLabel}</span>
            </span>
            <span className="hidden items-center gap-1 border-l pl-2.5 text-xs font-medium sm:flex">
              <UsersIcon aria-hidden="true" className="size-3.5" />
              Switch person
            </span>
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 rounded-2xl p-2">
          <DropdownMenuLabel className="whitespace-normal">
            <span className="block">{inCopy ? "Switch role in your demo club" : "Switch shared demo role"}</span>
            <span className="block text-xs font-normal text-muted-foreground">Each person can read different records. The database enforces it.</span>
          </DropdownMenuLabel>
          {DEMO_USERS.map((u) => (
            <DropdownMenuItem key={u.key} disabled={u.key === currentKey} onSelect={() => switchTo(u.key)} className="items-start gap-3 rounded-xl py-2">
              <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                {u.name.replace(/^Dr\.\s*/, "").charAt(0)}
              </span>
              <span className="flex flex-col">
                <span className="font-medium">
                  {u.name} <span className="font-normal text-muted-foreground">· {ROLE_LABELS[u.role]}</span>
                  {u.key === currentKey && <span className="ml-2 text-xs text-primary">(current)</span>}
                </span>
                <span className="text-xs text-muted-foreground">{u.summary}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()} className="rounded-xl">
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
