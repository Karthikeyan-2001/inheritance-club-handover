export type Health = {
  status: "ok";
  service: "inheritance";
  commit: string | null;
  time: string;
};

/** Pure so it can be unit tested without a request context. */
export function buildHealth(
  env: Record<string, string | undefined>,
  now: Date,
): Health {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return {
    status: "ok",
    service: "inheritance",
    commit: sha ? sha.slice(0, 7) : null,
    time: now.toISOString(),
  };
}
