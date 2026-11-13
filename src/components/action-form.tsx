"use client";

import { useActionState, type ReactNode } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { FormState } from "@/lib/form-state";

/** A small form bound to a server action, showing its success or error message. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Working…",
  variant = "default",
  className = "flex flex-col gap-3",
  confirm,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
  className?: string;
  /** Ask before submitting; for actions that cannot be undone. */
  confirm?: { title: string; description: ReactNode; confirmLabel: string };
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      aria-busy={pending}
      // Enter in a text box would submit without the question; only the dialog's "yes" may.
      onSubmit={confirm ? (e) => { if (e.currentTarget.dataset.confirmed !== "1") e.preventDefault(); } : undefined}
    >
      {children}
      <div>
        {confirm ? (
          <ConfirmButton variant={variant} title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} pending={pending} pendingLabel={pendingLabel}>
            {submitLabel}
          </ConfirmButton>
        ) : (
          <Button type="submit" variant={variant} size="sm" disabled={pending}>
            {pending && <Spinner />}
            {pending ? pendingLabel : submitLabel}
          </Button>
        )}
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
          {state.ok}
        </p>
      )}
    </form>
  );
}
