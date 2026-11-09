// Where a verified quote sits inside its source message, for highlighting. Uses the same
// normalisation as the verifier (verify.ts) on the whole text, then maps the match back to
// the original by comparing normalised lengths of prefixes, so context-dependent folding
// (composed accents, final sigma) cannot make a verified quote unplaceable.

import { normaliseForQuote } from "./verify.ts";

export type QuoteSpan = { start: number; end: number };

/** normaliseForQuote without the final trim, so prefix lengths line up with the whole text. */
function foldKeepEdges(s: string): string {
  return normaliseForQuote(`|${s}|`).slice(1, -1);
}

/** Offsets just after each code point (plus 0), as UTF-16 indexes. */
function boundaries(text: string): number[] {
  const out = [0];
  let i = 0;
  for (const ch of text) {
    i += ch.length;
    out.push(i);
  }
  return out;
}

/**
 * The span of `text` that the quote matches, or null when it cannot be placed (the message
 * is still shown, without a highlight).
 */
export function locateQuote(text: string, quote: string): QuoteSpan | null {
  const q = normaliseForQuote(quote);
  if (!q) return null;
  const folded = foldKeepEdges(text);
  const at = folded.indexOf(q);
  if (at < 0) return null;
  const wantStart = at;
  const wantEnd = at + q.length;
  const bounds = boundaries(text);
  const len = bounds.map((b) => foldKeepEdges(text.slice(0, b)).length);
  let start = 0;
  for (let k = 0; k < bounds.length; k++) if (len[k] <= wantStart) start = bounds[k];
  let end = text.length;
  for (let k = 0; k < bounds.length; k++) {
    if (len[k] >= wantEnd) {
      end = bounds[k];
      break;
    }
  }
  // Keep combining marks with their base character.
  while (start > 0 && /\p{M}/u.test(text.charAt(start))) start--;
  while (end < text.length && /\p{M}/u.test(text.charAt(end))) end++;
  // A match may not start on collapsed whitespace the quote did not include.
  while (start < end && /\s/u.test(text.charAt(start)) && !/^\s/u.test(q)) start++;
  return end > start ? { start, end } : null;
}

export type Segment = { text: string; mark: boolean };

/** Split a message around a span (null: the whole message, unmarked). */
export function segmentsFor(text: string, span: QuoteSpan | null): Segment[] {
  if (!span) return [{ text, mark: false }];
  return [
    { text: text.slice(0, span.start), mark: false },
    { text: text.slice(span.start, span.end), mark: true },
    { text: text.slice(span.end), mark: false },
  ].filter((s) => s.text.length > 0);
}

/** Split a message into plain and highlighted parts. */
export function highlightSegments(text: string, quote: string): Segment[] {
  return segmentsFor(text, locateQuote(text, quote));
}
