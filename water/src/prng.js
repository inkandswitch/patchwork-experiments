// Seeded randomness for the surface's look (material.js: its fine detail and
// where foam starts), so every viewer draws the same water. A copy of
// sailing's (wind.js): packages don't import each other. Pure.

/** A seed (number or string) as a uint32. */
export function seedOf(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0 || 1;
  const s = String(seed ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0 || 1;
}

/** mulberry32: a small, good, seeded PRNG giving [0, 1). */
export function prng(seed) {
  let a = seedOf(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
