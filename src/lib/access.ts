// TypeScript mirror of the access rules enforced in Postgres (supabase/migrations/0003).
// The database is the source of truth; this exists for UI copy and unit tests only.
// Never use it to decide what to fetch: RLS filters first.

export const ACCESS_LEVELS = ["everyone", "committee", "finance", "private"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const APP_ROLES = ["outgoing_lead", "advisor", "incoming_lead", "treasurer", "member"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  outgoing_lead: "Outgoing lead",
  advisor: "Faculty advisor",
  incoming_lead: "Incoming lead",
  treasurer: "Treasurer",
  member: "Member",
};

export const ACCESS_LABELS: Record<AccessLevel, string> = {
  everyone: "Everyone",
  committee: "Committee",
  finance: "Finance",
  private: "Private",
};

/** Highest level a role may read by default (before own-private items and releases). */
export function clearance(role: AppRole): AccessLevel {
  switch (role) {
    case "advisor":
      return "private";
    case "outgoing_lead":
    case "treasurer":
      return "finance";
    case "incoming_lead":
      return "committee";
    case "member":
      return "everyone";
  }
}

export function levelRank(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level);
}

/** Most restrictive of several levels (an item inherits this from its sources). */
export function mostRestrictive(levels: readonly AccessLevel[]): AccessLevel {
  return levels.reduce<AccessLevel>(
    (acc, l) => (levelRank(l) > levelRank(acc) ? l : acc),
    "everyone",
  );
}

export type ReadInput = {
  role: AppRole;
  userId: string;
  level: AccessLevel;
  privateUploaders: readonly string[];
  releasedToRole: boolean;
};

/** Same rule as app.can_read() in SQL. */
export function canRead({ role, userId, level, privateUploaders, releasedToRole }: ReadInput): boolean {
  if (levelRank(level) <= levelRank(clearance(role))) return true;
  if (
    level === "private" &&
    role === "outgoing_lead" &&
    privateUploaders.length > 0 &&
    privateUploaders.every((u) => u === userId)
  ) {
    return true;
  }
  return releasedToRole;
}
