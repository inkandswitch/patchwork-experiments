// Depths where no survey has any: a harmonic fill. Each node to fill takes
// the mean of its four neighbours (in the grid): a neighbour with a value
// gives that value, a neighbour on land gives the shore's height (the water
// floor: the burned shore's depth one band out), another node to fill its
// current estimate. Solved by Gauss–Seidel with over-relaxation in a fixed
// order until no node moves by more than `tol`, so the same inputs give the
// same depths. A harmonic function is the smoothest surface through its
// boundary: no new hollows or shoals, and a plane comes back as itself
// (tested). A region with no neighbour of either kind (it can't happen in a
// grid with any shore) keeps the shore's height.
//
// Pure.

/**
 * @param {number} n  nodes a side
 * @param {Float32Array} values  heights, NaN where there are none
 * @param {Uint8Array} want  1 at the nodes to fill (water with no value)
 * @param {Int8Array} label  coast.js: +1 land, −1 water, 0 untold
 * @param {{ shore: number, tol?: number, maxSweeps?: number }} o  shore: the height a land neighbour gives
 * @returns {{ values: Float32Array, filled: number, sweeps: number, change: number }}  values: a copy, filled
 */
export function harmonicFill(n, values, want, label, { shore, tol = 1e-3, maxSweeps = 20000 } = {}) {
  const out = Float32Array.from(values);
  const todo = [];
  for (let k = 0; k < n * n; k++) if (want[k]) todo.push(k);
  if (!todo.length) return { values: out, filled: 0, sweeps: 0, change: 0 };
  const fixed = (k) => !want[k] && (label[k] > 0 || !Number.isNaN(out[k]));
  // a land neighbour gives the shore's height, whatever the land is
  const given = (k) => (label[k] > 0 ? shore : out[k]);
  // start each at the mean of what it touches that is known, else the shore
  for (const k of todo) {
    let s = 0, c = 0;
    for (const m of neighbours(n, k)) if (fixed(m)) (s += given(m)), c++;
    out[k] = c ? s / c : shore;
  }
  const omega = 1.9;
  let sweeps = 0, change = Infinity;
  while (change > tol && sweeps < maxSweeps) {
    change = 0;
    for (const k of todo) {
      let s = 0, c = 0;
      for (const m of neighbours(n, k)) {
        s += want[m] ? out[m] : fixed(m) ? given(m) : shore;
        c++;
      }
      const next = out[k] + omega * (s / c - out[k]);
      change = Math.max(change, Math.abs(next - out[k]));
      out[k] = next;
    }
    sweeps++;
  }
  return { values: out, filled: todo.length, sweeps, change };
}

function neighbours(n, k) {
  const i = k % n, j = (k - i) / n;
  const out = [];
  if (i > 0) out.push(k - 1);
  if (i < n - 1) out.push(k + 1);
  if (j > 0) out.push(k - n);
  if (j < n - 1) out.push(k + n);
  return out;
}
