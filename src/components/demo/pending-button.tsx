"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** A submit button that shows a pending label while its form's server action runs. */
export function PendingButton({
  children,
  pendingLabel,
  variant = "default",
  className,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: "default" | "outline" | "secondary";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
