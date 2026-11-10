"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** The outgoing lead's or advisor's reply to the incoming lead's question or decline. */
export function ReplyForm({ action, ack }: { action: Action; ack: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2 text-sm">
      <input type="hidden" name="ack" value={ack} />
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Reply to the incoming lead</span>
        <textarea name="text" required maxLength={1000} rows={2} className="rounded-md border bg-background px-2 py-1.5" />
      </label>
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Sending…" : "Send reply"}
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
