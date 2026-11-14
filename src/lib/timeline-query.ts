import { z } from "zod";

export const TIMELINE_PAGE_SIZE = 50;

export type TimelineParams = { source: string | null; q: string; page: number };

/** Read and sanitise the timeline's URL parameters. Anything invalid falls back to a default. */
export function parseTimelineParams(sp: Record<string, string | string[] | undefined>): TimelineParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const source = z.uuid().safeParse(one("source"));
  const page = z.coerce.number().int().min(1).max(10_000).safeParse(one("page"));
  const q = (one("q") ?? "").toString().trim().slice(0, 100);
  return { source: source.success ? source.data : null, q, page: page.success ? page.data : 1 };
}

/** Escape LIKE wildcards so a search for "50%" matches the text literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function timelineHref(base: TimelineParams, patch: Partial<TimelineParams>): string {
  const p = { ...base, ...patch };
  const qs = new URLSearchParams();
  if (p.source) qs.set("source", p.source);
  if (p.q) qs.set("q", p.q);
  if (p.page > 1) qs.set("page", String(p.page));
  const s = qs.toString();
  return s ? `/messages?${s}` : "/messages";
}
