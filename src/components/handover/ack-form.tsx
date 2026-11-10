"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** The incoming lead's answer on one item. The pressed button's value is the answer; questions and declines need a note. */
export function AckForm({ action, version, obligation, current }: { action: Action; version: string; obligation: string; current: string | null }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 border-t pt-3 text-sm">
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="obligation" value={obligation} />
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Note (needed to ask a question or decline)</span>
        <input name="note" maxLength={500} className="rounded-md border bg-background px-2 py-1.5" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="action" value="accept" size="sm" variant={current === "accept" ? "default" : "outline"} disabled={pending}>
          Accept
        </Button>
        <Button type="submit" name="action" value="question" size="sm" variant={current === "question" ? "default" : "outline"} disabled={pending}>
          Ask a question
        </Button>
        <Button type="submit" name="action" value="decline" size="sm" variant={current === "decline" ? "destructive" : "outline"} disabled={pending}>
          Decline
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
