import { cn } from "cn";

/** A grey-lilac block with a slow shimmer. Decorative: the surrounding region carries the status. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("skeleton h-4 w-full", className)} {...props} />;
}
