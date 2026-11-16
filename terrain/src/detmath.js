// Math whose answers are the same in every JavaScript engine, for the
// geometry a build writes into a GLB: +, −, ×, ÷ and sqrt are correctly
// rounded (IEEE 754), so the same inputs give the same bits anywhere; the
// engines' Math.sin, Math.cos, Math.tan and Math.hypot are not required to
// be, and node's and Chrome's V8 have been seen to differ by an ulp (a
// GLB built in the browser and in node then differs). So: a length by
// sqrt, and sine and cosine by a fixed polynomial after a fixed range
// reduction (accurate to about 1e-15; tested against Math).
//
// Pure.

/** √(dx² + dz²), the same bits everywhere (Math.hypot isn't). */
export const len = (dx, dz) => Math.sqrt(dx * dx + dz * dz);

const PI_2_HI = 1.5707963267341256, PI_2_LO = 6.077100506506192e-11;

// sin and cos on [−π/4, π/4], Taylor to x^17 / x^16: below 1e-16 relative there
function sinK(x) {
  const z = x * x;
  return x * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 + z * (1 / 6227020800 + z * (-1 / 1307674368000 + z * (1 / 355687428096000)))))))));
}
function cosK(x) {
  const z = x * x;
  return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320 + z * (-1 / 3628800 + z * (1 / 479001600 + z * (-1 / 87178291200 + z * (1 / 20922789888000))))))));
}
/** x as k·π/2 + r, |r| ≤ π/4 (Cody–Waite, two parts): [k mod 4, r]. */
function reduce(x) {
  const k = Math.round(x / (PI_2_HI + PI_2_LO));
  const r = x - k * PI_2_HI - k * PI_2_LO;
  return [((k % 4) + 4) % 4, r];
}
/** sin x, the same bits in every engine. */
export function dsin(x) {
  const [q, r] = reduce(x);
  return q === 0 ? sinK(r) : q === 1 ? cosK(r) : q === 2 ? -sinK(r) : -cosK(r);
}
/** cos x, the same bits in every engine. */
export function dcos(x) {
  const [q, r] = reduce(x);
  return q === 0 ? cosK(r) : q === 1 ? -sinK(r) : q === 2 ? -cosK(r) : sinK(r);
}
/** tan x. */
export const dtan = (x) => dsin(x) / dcos(x);
