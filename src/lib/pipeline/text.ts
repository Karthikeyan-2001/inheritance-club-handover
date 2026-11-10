// Small, deterministic text helpers for the pipeline: content-word tokens for finding related
// messages, and verbatim sentence extraction for quotes built by code.

// Common English words plus the chat filler seen in club records. Matching on these would
// link every message to every other.
const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be been before being below between both but by can
  could did do does doing done down during each few for from further get got had has have having he her here hers
  him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our
  ours out over own same she should so some such than that the their them then there these they this those through
  to too under until up very was we were what when where which while who whom why will with would you your yours
  yet still ok okay sure da yes yeah pls please thanks thank hi hello guys all also one two will shall need needs
  let lets i'll we'll i'm it's don't can't send sent make made give take put going go club committee team today
  tomorrow yesterday week month year sem semester every next last time card moved list from to`
    .split(/\s+/)
    .filter(Boolean),
);

/** Light stemming: enough to join "returned"/"return", "posters"/"poster", "printing"/"print". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

/** Distinct content words of a text, stemmed. Numbers of 2+ digits count (amounts, board counts). */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    const w = raw.replace(/^'+|'+$/g, "").replace(/'s$/, "");
    if (w.length < 3 && !/^\d{2,}$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** Sentences of a text, each an exact substring of it (so a quote built from one verifies). */
/** Titles and initials whose full stop does not end a sentence ("Mr. Dsouza", "Prof. Iyer", "Mr. R. Ganesan"). */
const NOT_AN_END = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Smt|Shri|[A-Z])\.$/;

export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const re = /[^.!?]+[.!?]*/g;
    let carry = "";
    for (const m of line.matchAll(re)) {
      const piece = carry + m[0];
      if (NOT_AN_END.test(piece.trimEnd())) {
        carry = piece;
        continue;
      }
      carry = "";
      const s = piece.trim();
      if (s) out.push(s);
    }
    if (carry.trim()) out.push(carry.trim());
  }
  return out;
}

/** The first sentence of `text` that contains `words` (case- and space-insensitive), or null. */
export function sentenceContaining(text: string, words: string): string | null {
  const needle = words.toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle) return null;
  return sentences(text).find((s) => s.toLowerCase().replace(/\s+/g, " ").includes(needle)) ?? null;
}

/** pg_trgm-style similarity (shared trigrams over all trigrams of padded words). */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Set<string>();
    for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      const p = `  ${w} `;
      for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  const union = ga.size + gb.size - shared;
  return union === 0 ? 0 : shared / union;
}
