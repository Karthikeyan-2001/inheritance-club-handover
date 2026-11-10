import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a request carries Vercel's cron credential: `Authorization: Bearer <CRON_SECRET>`.
 * Refuses when the secret is unset or too short, so an unconfigured deployment never runs
 * the clean-up for anyone. Hashing first makes the comparison constant-time for any length.
 */
export function cronAuthorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
