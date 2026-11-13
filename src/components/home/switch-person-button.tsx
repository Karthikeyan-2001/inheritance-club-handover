"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { UsersIcon } from "lucide-react";
import { signInAsDemo } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DemoUserKey } from "@/lib/demo/demo-users";

function Inner({ label, primary }: { label: string; primary: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={primary ? "lg" : "default"} variant={primary ? "default" : "outline"} disabled={pending} data-testid="switch-person">
      {pending ? <Spinner /> : <UsersIcon aria-hidden="true" />}
      {pending ? `Switching to ${label}…` : `Switch to ${label}`}
    </Button>
  );
}

/**
 * "Switch to Dr. Meena" for when the next step belongs to someone else. It is the same one-click
 * switch as the menu: the club (own copy or shared) is read from where the visitor already is.
 */
export function SwitchPersonButton({ personKey, label, primary, inCopy }: { personKey: DemoUserKey; label: string; primary: boolean; inCopy: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={signInAsDemo}>
      <input type="hidden" name="user" value={personKey} />
      <input type="hidden" name="next" value="/" />
      <input type="hidden" name="club" value={inCopy ? "mine" : "shared"} />
      <Inner label={label} primary={primary} />
    </form>
  );
}
