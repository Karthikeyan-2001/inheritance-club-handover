export const STEPS = ["Connect", "Reconstruct", "Verify", "Review", "Handover"] as const;
export type Step = (typeof STEPS)[number];

/** What each step is called on screen, in plain words. The keys above stay as they are. */
export const STEP_LABEL: Record<Step, string> = {
  Connect: "Add files",
  Reconstruct: "Build the ledger",
  Verify: "Check the records",
  Review: "Review and approve",
  Handover: "Hand over",
};

/** One page per step, so switching tabs inside a page never moves the step bar. Verify is /check (conflicts and gaps) and the source-message pages. */
export const STEP_HREF: Partial<Record<Step, string>> = {
  Connect: "/import",
  Reconstruct: "/ledger",
  Verify: "/check",
  Review: "/review",
  Handover: "/handover",
};

/** The step a page belongs to. Only the path counts: a tab never changes the step. `/messages` belongs to no step. */
export function stepForPath(pathname: string): Step | null {
  if (pathname.startsWith("/import")) return "Connect";
  if (pathname.startsWith("/ledger/evidence") || pathname.startsWith("/check")) return "Verify";
  if (pathname.startsWith("/ledger")) return "Reconstruct";
  if (pathname.startsWith("/review")) return "Review";
  if (pathname.startsWith("/handover")) return "Handover";
  return null;
}
