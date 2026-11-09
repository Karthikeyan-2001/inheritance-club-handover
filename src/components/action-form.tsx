"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

/** A small form bound to a server action, showing its success or error message. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Working…",
  variant = "default",
  className = "flex flex-col gap-3",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <div>
        <Button type="submit" variant={variant} size="sm" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.ok}
        </p>
      )}
    </form>
  );
}
