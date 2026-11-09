// Deterministic quote verification (CLAUDE.md, non-negotiable 1). Code, not a model, decides
// whether a quote is really in the message it cites. Mirrored in SQL by app.norm_quote().

const QUOTE_CHARS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "–": "-", "—": "-", "−": "-",
};

/** NFKC, typographic quotes and dashes to ASCII, lower case, whitespace collapsed. */
export function normaliseForQuote(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛“”„‟–—−]/g, (c) => QUOTE_CHARS[c])
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Shortest acceptable quote, so that "I" or "ok" cannot "verify" against any message. */
export const MIN_QUOTE_CHARS = 12;

export type QuoteCheck = { ok: true } | { ok: false; reason: "quote_too_short" | "quote_not_found" };

export function verifyQuote(quote: string, eventText: string): QuoteCheck {
  const q = normaliseForQuote(quote);
  const t = normaliseForQuote(eventText);
  if (q.length < Math.min(MIN_QUOTE_CHARS, t.length) || q.length === 0) return { ok: false, reason: "quote_too_short" };
  return t.includes(q) ? { ok: true } : { ok: false, reason: "quote_not_found" };
}
