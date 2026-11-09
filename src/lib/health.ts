export type DbStatus = "ok" | "error" | "not_configured";

export type Health = {
  status: "ok" | "degraded";
  service: "inheritance";
  commit: string | null;
  db: DbStatus;
  time: string;
};

/** Pure so it can be unit tested without a request context. */
export function buildHealth(
  env: Record<string, string | undefined>,
  now: Date,
  db: DbStatus,
): Health {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return {
    status: db === "ok" ? "ok" : "degraded",
    service: "inheritance",
    commit: sha ? sha.slice(0, 7) : null,
    db,
    time: now.toISOString(),
  };
}
