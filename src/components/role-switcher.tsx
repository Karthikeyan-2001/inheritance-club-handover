"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { signInAsDemo, signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
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

// Menu items are plain Radix items that submit forms living OUTSIDE the menu. Native
// <button>s inside menu items get activated by the same keypress that opens the menu,
// which would switch accounts unintentionally for keyboard users.
export function RoleSwitcher({
  name,
  roleLabel,
  currentKey,
}: {
  name: string;
  roleLabel: string;
  currentKey: DemoUserKey | null;
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
      </form>
      <form ref={signOutForm} action={signOut} hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label={`Signed in as ${name}, ${roleLabel}. Switch demo role`}>
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground">· {roleLabel}</span>
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Switch demo role</DropdownMenuLabel>
          {DEMO_USERS.map((u) => (
            <DropdownMenuItem key={u.key} disabled={u.key === currentKey} onSelect={() => switchTo(u.key)}>
              <span className="font-medium">{u.name}</span>
              <span className="text-muted-foreground">{ROLE_LABELS[u.role]}</span>
              {u.key === currentKey && <span className="ml-auto text-xs">(current)</span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
