// Mirrors app.needs_rereview() (migration 0013): an accepted or edited item whose status or
// trust differs from what it was accepted with has changed since a reviewer last looked.

export type ReviewedRow = {
  review_state: string;
  status: string;
  trust_state: string;
  reviewed_status: string | null;
  reviewed_trust: string | null;
};

export function needsRereview(row: ReviewedRow): boolean {
  if (row.review_state !== "accepted" && row.review_state !== "edited") return false;
  return row.status !== row.reviewed_status || row.trust_state !== row.reviewed_trust;
}

export type Change = { was: string | null; now: string };

/** What moved since the item was accepted: null for the part that did not. */
export function rereviewChange(row: ReviewedRow): { status: Change | null; trust: Change | null } {
  return {
    status: row.status !== row.reviewed_status ? { was: row.reviewed_status, now: row.status } : null,
    trust: row.trust_state !== row.reviewed_trust ? { was: row.reviewed_trust, now: row.trust_state } : null,
  };
}
