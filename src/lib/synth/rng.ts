// Seeded randomness, so the generator makes the same files every time.

/** mulberry32: small, fast, good enough for filler chat. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
  };
}
export type Rng = ReturnType<typeof makeRng>;

/** A stable seed for a named stream, so adding a chat does not change the others. */
export function seedFor(base: number, name: string): number {
  let h = base >>> 0;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
