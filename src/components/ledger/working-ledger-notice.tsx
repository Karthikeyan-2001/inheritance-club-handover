import Link from "next/link";
import { Button } from "@/components/ui/button";

/** For roles that only read approved versions (incoming lead, members): where to look instead. */
export function WorkingLedgerNotice() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-sm" data-testid="working-ledger-notice">
      <p>The working ledger is visible to the outgoing committee and the advisor until a version is approved. You see what has been checked and approved.</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/handover">Open the handover</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/review?tab=versions">See approved versions</Link>
        </Button>
      </div>
    </div>
  );
}
