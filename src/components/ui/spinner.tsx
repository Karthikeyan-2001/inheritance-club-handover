import { Loader2Icon } from "lucide-react";
import { cn } from "cn";

/** A spinning ring for buttons. Hidden from screen readers; the button's label says what is happening. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2Icon aria-hidden="true" className={cn("size-4 animate-spin motion-reduce:animate-none", className)} />;
}
