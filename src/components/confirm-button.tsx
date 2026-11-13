"use client";

import { useRef, useState, type ReactNode } from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * A button that asks "are you sure?" first. It is for actions that cannot be undone. Pressing it
 * checks the surrounding form's required fields, so the question is only asked once the form is
 * complete; "Yes" then submits the form. Focus starts on Cancel, so Enter is the safe answer.
 */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  variant = "destructive",
  disabled,
  pending = false,
  pendingLabel = "Working…",
  size = "sm",
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
  disabled?: boolean;
  /** The form is submitting: keep this component mounted (so the dialog can finish closing and return focus) but disable it. */
  pending?: boolean;
  pendingLabel?: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || pending}
        onClick={(e) => {
          const f = e.currentTarget.closest("form");
          if (f && !f.reportValidity()) return;
          form.current = f;
          setOpen(true);
        }}
      >
        {pending && <Spinner />}
        {pending ? pendingLabel : children}
      </Button>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-foreground/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[71] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-6 shadow-xl shadow-primary/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-sm text-muted-foreground">{description}</div>
          </AlertDialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={variant} onClick={() => {
                const f = form.current;
                if (!f) return;
                f.dataset.confirmed = "1";
                try {
                  f.requestSubmit();
                } finally {
                  delete f.dataset.confirmed;
                }
              }}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
