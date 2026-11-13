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

/** The page each step starts on. Verify is the Docket (records that disagree), the Gaps tab and the source messages. */
export const STEP_HREF: Partial<Record<Step, string>> = {
  Connect: "/import",
  Reconstruct: "/ledger",
  Verify: "/ledger?tab=docket",
  Review: "/review",
  Handover: "/handover",
};

const VERIFY_TABS = new Set(["docket", "gaps"]);

export function stepForPath(pathname: string, tab?: string | null): Step | null {
  if (pathname.startsWith("/import")) return "Connect";
  if (pathname.startsWith("/ledger/evidence")) return "Verify";
  if (pathname.startsWith("/ledger")) return tab && VERIFY_TABS.has(tab) ? "Verify" : "Reconstruct";
  if (pathname.startsWith("/review")) return "Review";
  if (pathname.startsWith("/handover")) return "Handover";
  return null;
}
