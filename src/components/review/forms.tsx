"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { FormState } from "@/lib/form-state";
import { FIELD_LABELS } from "@/lib/review/fields";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type FormButton = { label: string; value: string; variant?: "default" | "destructive" | "outline" | "secondary"; disabled?: boolean; confirm?: { title: string; description: string; confirmLabel: string } };

function Messages({ state }: { state: FormState }) {
  return (
    <>
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
    </>
  );
}

/**
 * A reason box with one or more submit buttons. The pressed button's value is sent under
 * `buttonName`, so one form can offer "Accept", "Reject" and so on. The database re-checks
 * who may do what; a refusal is shown here in plain words.
 */
export function ReasonForm({
  action,
  hidden,
  buttons,
  buttonName = "action",
  label = "Reason",
  placeholder = "Why? This goes in the audit log.",
  children,
  className = "flex flex-col gap-2",
}: {
  action: Action;
  hidden?: Record<string, string>;
  buttons: FormButton[];
  buttonName?: string;
  label?: string;
  placeholder?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <input name="reason" required minLength={3} maxLength={500} placeholder={placeholder} className="rounded-lg border border-input bg-card px-3 py-2" />
      </label>
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <Button key={b.value} type="submit" name={buttonName} value={b.value} variant={b.variant ?? "outline"} size="sm" disabled={pending || b.disabled}>
            {pending && <Spinner />}
            {pending ? "Working…" : b.label}
          </Button>
        ))}
      </div>
      <Messages state={state} />
    </form>
  );
}

export type EditField = { name: string; value: string; date: boolean };

/** Edit the fields a reviewer may change. Status and trust are not here: they come from evidence. */
export function EditForm({ action, id, fields }: { action: Action; id: string; fields: EditField[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Edit this item</summary>
      <div className="mt-2">
        <ReasonForm action={action} hidden={{ id }} buttons={[{ label: "Save the edit", value: "edit", variant: "default" }]} className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.name} className="flex flex-col gap-1">
                <span className="text-muted-foreground">{FIELD_LABELS[f.name] ?? f.name}</span>
                <input
                  name={`f_${f.name}`}
                  defaultValue={f.value}
                  placeholder={f.date ? "YYYY-MM-DD" : undefined}
                  className="rounded-md border bg-background px-2 py-1.5"
                />
              </label>
            ))}
          </div>
        </ReasonForm>
      </div>
    </details>
  );
}

/** The advisor's ruling on a conflict: done, not done, or cannot tell. */
export function RulingForm({ action, entry, current, options }: { action: Action; entry: string; current: string | null; options: { value: string; label: string }[] }) {
  return (
    <ReasonForm
      action={action}
      hidden={{ entry }}
      buttons={[{ label: current ? "Change the ruling" : "Record the ruling", value: "rule", variant: "default" }]}
      label="Reason for the ruling"
    >
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-muted-foreground">Ruling</legend>
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5">
            <input type="radio" name="ruling" value={o.value} required defaultChecked={current === o.value} />
            {o.label}
          </label>
        ))}
      </fieldset>
    </ReasonForm>
  );
}
