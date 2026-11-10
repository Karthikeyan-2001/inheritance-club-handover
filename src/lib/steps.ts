export const STEPS = ["Connect", "Reconstruct", "Verify", "Review", "Handover"] as const;
export type Step = (typeof STEPS)[number];

/** Pages that exist so far. Steps without a page are shown as upcoming. */
export const STEP_HREF: Partial<Record<Step, string>> = {
  Connect: "/import",
  Reconstruct: "/ledger",
  Review: "/review",
  Handover: "/handover",
};

export function stepForPath(pathname: string): Step | null {
  if (pathname.startsWith("/import")) return "Connect";
  if (pathname.startsWith("/ledger")) return "Reconstruct";
  if (pathname.startsWith("/review")) return "Review";
  if (pathname.startsWith("/handover")) return "Handover";
  return null;
}
