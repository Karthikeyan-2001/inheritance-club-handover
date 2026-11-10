"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** For reviewers: hold back an item the incoming lead may not read, and say only who holds it and the topic. */
export function SealForm({ action, options }: { action: Action; options: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(action, null);
  if (options.length === 0) return <p className="text-sm text-muted-foreground">Every restricted item you can read already has a placeholder or has been released.</p>;
  return (
    <form action={formAction} className="flex flex-col gap-3 text-sm" aria-label="Add a sealed placeholder">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Item</span>
        <select name="obligation" required className="rounded-md border bg-background px-2 py-1.5">
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Who holds it</span>
        <select name="holder" required className="rounded-md border bg-background px-2 py-1.5">
          <option value="advisor">Faculty advisor</option>
          <option value="outgoing_lead">Outgoing lead</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Topic shown to everyone (a few words, no details)</span>
        <input name="topic" required minLength={3} maxLength={80} className="rounded-md border bg-background px-2 py-1.5" />
      </label>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Working…" : "Add the placeholder"}
        </Button>
      </div>
      {state?.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-muted-foreground">
          {state.ok}
        </p>
      )}
    </form>
  );
}
