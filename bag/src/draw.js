// The draw rules, as data on the bag doc (`rule`), and the one place a draw's
// randomness lives.

export const RULES = Object.freeze([
  { value: "random", label: "At random" },
  { value: "random-replace", label: "At random, with replacement" },
  { value: "top", label: "Last in, first out" },
]);
export const DEFAULT_RULE = "random";

/** A bag doc's rule, or the default when it names none this version knows. */
export const ruleOf = (doc) => (RULES.some((r) => r.value === doc?.rule) ? doc.rule : DEFAULT_RULE);

/** Does a draw by this rule leave the item in (and hand out a copy)? */
export const replaces = (rule) => rule === "random-replace";

/**
 * Which of `n` items (in put order, oldest first) a draw takes: an index in
 * [0, n), or -1 when there is nothing to draw.
 *
 * THE SEAM FOR FAIRNESS: this is the only place a draw's randomness comes
 * from, and today it is this view's own `random` (Math.random): whoever
 * draws could choose. A fair value drawn jointly by the players (a
 * stage-level capability, planned) will replace `random` here, and nothing
 * else changes.
 * @param {string} rule  @param {number} n  @param {() => number} [random]  in [0, 1)
 */
export function drawIndex(rule, n, random = Math.random) {
  if (!Number.isInteger(n) || n <= 0) return -1;
  if (rule === "top") return n - 1;
  const r = Number(random());
  return Math.min(n - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * n)));
}
