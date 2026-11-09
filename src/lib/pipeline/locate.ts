// Where a verified quote sits inside its source message, for highlighting. Uses the same
// normalisation as the verifier (verify.ts), then maps the match back to the original text.

import { normaliseForQuote } from "./verify.ts";

export type QuoteSpan = { start: number; end: number };

/** Normalise one character the way normaliseForQuote does, tracking the original index of each output char. */
function foldWithMap(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let pendingSpace = -1;
  let i = 0;
  for (const ch of text) {
    const at = i;
    i += ch.length;
    if (/\s/u.test(ch)) {
      if (folded.length > 0 && pendingSpace < 0) pendingSpace = at;
      continue;
    }
    const piece = normaliseForQuote(ch);
    if (!piece) continue;
    if (pendingSpace >= 0) {
      folded += " ";
      origin.push(pendingSpace);
      pendingSpace = -1;
    }
    for (let k = 0; k < piece.length; k++) origin.push(at);
    folded += piece;
  }
  return { folded, origin };
}

/**
 * The span of `text` that the quote matches, or null when it cannot be placed (the message
 * is still shown, without a highlight). The span covers whole original characters.
 */
export function locateQuote(text: string, quote: string): QuoteSpan | null {
  const q = normaliseForQuote(quote);
  if (!q) return null;
  const { folded, origin } = foldWithMap(text);
  const at = folded.indexOf(q);
  if (at < 0) return null;
  const start = origin[at];
  const lastChar = origin[at + q.length - 1];
  const end = lastChar + (String.fromCodePoint(text.codePointAt(lastChar) ?? 32).length);
  return { start, end };
}

export type Segment = { text: string; mark: boolean };

/** Split a message into plain and highlighted parts. */
export function highlightSegments(text: string, quote: string): Segment[] {
  const span = locateQuote(text, quote);
  if (!span) return [{ text, mark: false }];
  return [
    { text: text.slice(0, span.start), mark: false },
    { text: text.slice(span.start, span.end), mark: true },
    { text: text.slice(span.end), mark: false },
  ].filter((s) => s.text.length > 0);
}
