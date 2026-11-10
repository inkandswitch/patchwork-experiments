// A sail's cloth as a function of its trim (DESIGN.md, "Trim feedback" §4,
// "Geometry"): a grid of rows parallel to the foot, from the luff to the
// leech, cambered to the side its air pushes it, twisted off at the head,
// flattened as it flogs, fluttering by how far its sheet is eased past zero
// lift, lowered by its reef or rolled by its furl. Pure, no THREE: ship.js
// draws the GLB's `Sail` and `Jib` nodes as clothVertices at NEUTRAL, and
// looks.js rewrites the same nodes' vertices each frame with the same
// function, so the file and the dressing can't disagree. Every function
// writes into the `out` it's given and allocates nothing.
//
// A cloth (the GLB's extras.sail.cloth, in its node's frame, the sail in
// the x = 0 plane, +x the side it bellies to at neutral):
//   { kind: "main" | "jib", rows, cols,
//     luff:  [x, y, z] × (rows + 1), tack (row 0) to head (row `rows`),
//     leech: [x, y, z] × (rows + 1), clew (row 0) to head,
//     depth, draft, twist,   camber (of the chord), where it's deepest, the head's twist (m)
//     foot,                  rows below this height (0..1) are drawn flatter: the main's foot on its boom
//     reef: { tack, head } | null,  the line a reef is measured on (the contract's luff), else the luff's ends
//     battens: { rows: [r…], from: c, width, off } | null }

/** The camber a sail keeps however hard it flogs (a flat sail still has some shape). */
export const FLAT = 0.12;

/** The cloth as the GLB draws it: full, bellied to +x, not flogging, nothing reefed or furled. */
export const NEUTRAL = Object.freeze({ belly: 1, flog: 0, luff: 0, sigma: 0, reef: 0, furl: 0, flat: 1, amp: 0, freq: 1 });

/**
 * The luff's bubble as it lifts (trim.js trimOf's `luff`): the cloth's
 * front `width` of the chord pushed back to windward, `depth` of the full
 * camber there at luff 1, breathing by `breathe` of itself (cosmetic).
 */
export const BUBBLE = Object.freeze({ width: 0.3, depth: 0.8, breathe: 0.25 });

/** Flutter: waves along the chord, and the power its amplitude grows by toward the leech (cosmetic). */
export const FLUTTER = Object.freeze({ waves: 1.5, power: 1.5 });

const TAU = 2 * Math.PI;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The number of vertices a cloth's grid has. */
export const clothCount = (cloth) => (cloth.rows + 1) * (cloth.cols + 1);

/** The camber's shape across the chord at t (0 luff, 1 leech): t·(1 − t)^k, 1 at `draft`. */
function profile(t, draft) {
  const k = (1 - draft) / draft;
  return (t * Math.pow(1 - t, k)) / (draft * Math.pow(1 - draft, k));
}

/** A polyline (flat [x, y, z] × n) at parameter p (0..1, its points evenly spaced in p), into out at o. */
function along(out, o, line, n, p) {
  const x = clamp(p, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const a = 3 * i;
  out[o] = line[a] + (line[a + 3] - line[a]) * f;
  out[o + 1] = line[a + 1] + (line[a + 4] - line[a + 1]) * f;
  out[o + 2] = line[a + 2] + (line[a + 5] - line[a + 2]) * f;
}

/** Where a polyline (flat [x, y, z] × n, rising) first reaches height `y`, as its parameter (0..1). */
function paramAtHeight(line, n, y) {
  if (!(y > line[1])) return 0;
  for (let i = 0; i < n - 1; i++) {
    const y0 = line[3 * i + 1], y1 = line[3 * i + 4];
    if (y <= y1) return (i + (y1 > y0 ? (y - y0) / (y1 - y0) : 0)) / (n - 1);
  }
  return 1;
}

/**
 * Where a reef of `f` cuts the cloth, into out: [luff, leech] parameters
 * and the height of the cut. The main is reefed level, as rig-sails.js
 * reefed does on the contract's sail: everything below the height f of
 * the way from its tack to its head (`cloth.reef`, the contract's own
 * tack and head in this frame; the luff's ends if it states none) is cut
 * away. Exact on the luff's and leech's polylines, so the reefed cloth's
 * outline is the contract's reefed polygon (to the leech's resampling).
 */
export function reefCut(out, cloth, f) {
  const n = cloth.rows + 1;
  const L = cloth.luff;
  const t = cloth.reef?.tack ?? [L[0], L[1], L[2]];
  const h = cloth.reef?.head ?? [L[3 * (n - 1)], L[3 * (n - 1) + 1], L[3 * (n - 1) + 2]];
  const cut = t[1] + f * (h[1] - t[1]);
  out[0] = paramAtHeight(L, n, cut);
  out[1] = paramAtHeight(cloth.leech, n, cut);
  out[2] = cut;
  return out;
}

// scratch (module-level: no allocation per call)
const lu = new Float64Array(3);
const le = new Float64Array(3);
const shift = new Float64Array(3);
const furlTo = new Float64Array(3);
const cutAt = new Float64Array(3);

/**
 * A headsail's clew rolled to `furl` (rig-sails.js furledClew, in the
 * cloth's frame): toward the luff along the line square to it.
 */
export function furledClewOf(out, cloth, furl) {
  const n = cloth.rows + 1;
  const L = cloth.luff, E = cloth.leech;
  const tx = L[0], ty = L[1], tz = L[2];
  const lx = L[3 * (n - 1)] - tx, ly = L[3 * (n - 1) + 1] - ty, lz = L[3 * (n - 1) + 2] - tz;
  const ll = lx * lx + ly * ly + lz * lz || 1;
  const s = ((E[0] - tx) * lx + (E[1] - ty) * ly + (E[2] - tz) * lz) / ll;
  const fx = tx + s * lx, fy = ty + s * ly, fz = tz + s * lz;
  out[0] = fx + (E[0] - fx) * (1 - furl);
  out[1] = fy + (E[1] - fy) * (1 - furl);
  out[2] = fz + (E[2] - fz) * (1 - furl);
  return out;
}

/**
 * The cloth's vertices for a look, into `out` (rows + 1 by cols + 1, row
 * major, xyz: Shape.grid's order). `look`:
 * - belly (−1..1): the side its air pushes it (trim.js trimOf)
 * - flog (0..1), luff (0..1), sigma (0..1): trimOf's
 * - reef (0..1, the main: 1 − raised), furl (0..1, a headsail)
 * - flat (controls.flat, ≤ 1)
 * - amp (m), freq (Hz): the flutter's (trim.js flutterOf), at the sea clock `t`
 * Rows are the luff's and the leech's at the same height; the reef takes
 * the rows above its level cut (reefCut) and lowers them by f·(head −
 * tack); the furl moves
 * the clew to furledClewOf and each row's leech point with it. The camber
 * is depth·chord·profile·flat·belly·max(FLAT, 1 − flog), the twist
 * twist·(1 − σ/2)·h·t²·belly·chord/foot (in proportion to the row's chord,
 * so a head that comes to a point stays one), the flutter flog·amp·t^1.5·sin(2π(freq·t −
 * 1.5·t) + 3h), the luff's bubble −side·BUBBLE.depth·luff·depth·chord·
 * sin(π·t/BUBBLE.width) over the front of the chord (side the belly's,
 * starboard at 0), all along the cloth's normal (x), and all scaled down to
 * nothing at a flat foot.
 */
export function clothVertices(out, cloth, look, t = 0) {
  const R = cloth.rows, C = cloth.cols, n = R + 1;
  const f = clamp(look.reef || 0, 0, 1);
  const furl = clamp(look.furl || 0, 0, 1);
  const belly = clamp(look.belly ?? 1, -1, 1);
  const flog = clamp(look.flog || 0, 0, 1);
  const sigma = clamp(look.sigma || 0, 0, 1);
  const flat = look.flat ?? 1;
  const camber = cloth.depth * flat * belly * Math.max(FLAT, 1 - flog);
  const twist = cloth.twist * (1 - 0.5 * sigma) * belly;
  const amp = flog * (look.amp || 0);
  const luffLift = clamp(look.luff || 0, 0, 1);
  const bubble = luffLift > 0 ? -(belly < 0 ? -1 : 1) * BUBBLE.depth * luffLift * cloth.depth * flat * (1 + BUBBLE.breathe * Math.sin(TAU * (look.freq || 0) * t)) : 0;
  const phase = TAU * (look.freq || 0) * t;
  const L = cloth.luff, E = cloth.leech;
  const chord0 = Math.hypot(E[0] - L[0], E[1] - L[1], E[2] - L[2]) || 1;
  // the reef: where it cuts the luff and the leech, and how far it lowers what's left: f·(head − tack)
  let pl = 0, g = 0;
  if (f > 0) {
    reefCut(cutAt, cloth, f);
    pl = cutAt[0];
    g = cutAt[1];
    const T = cloth.reef?.tack, H = cloth.reef?.head;
    for (let k = 0; k < 3; k++) shift[k] = -f * ((H ? H[k] : L[3 * R + k]) - (T ? T[k] : L[k]));
  } else shift[0] = shift[1] = shift[2] = 0;
  // the furl: how far the clew moves
  if (furl > 0) {
    furledClewOf(furlTo, cloth, furl);
    furlTo[0] -= E[0];
    furlTo[1] -= E[1];
    furlTo[2] -= E[2];
  } else furlTo[0] = furlTo[1] = furlTo[2] = 0;
  let o = 0;
  for (let r = 0; r <= R; r++) {
    const h = r / R;
    if (f > 0) {
      along(lu, 0, L, n, pl + (1 - pl) * h);
      along(le, 0, E, n, g + (1 - g) * h);
      for (let k = 0; k < 3; k++) {
        lu[k] += shift[k];
        le[k] += shift[k];
      }
    } else {
      lu[0] = L[3 * r];
      lu[1] = L[3 * r + 1];
      lu[2] = L[3 * r + 2];
      le[0] = E[3 * r];
      le[1] = E[3 * r + 1];
      le[2] = E[3 * r + 2];
    }
    if (furl > 0) {
      const w = 1 - h;
      le[0] += furlTo[0] * w;
      le[1] += furlTo[1] * w;
      le[2] += furlTo[2] * w;
    }
    const chord = Math.hypot(le[0] - lu[0], le[1] - lu[1], le[2] - lu[2]);
    const foot = cloth.foot > 0 ? smoothstep(0, cloth.foot, h) : 1;
    for (let c = 0; c <= C; c++) {
      const u = c / C;
      let x = camber * chord * profile(u, cloth.draft) * foot + ((twist * chord) / chord0) * h * u * u;
      if (amp !== 0) x += amp * Math.pow(u, FLUTTER.power) * Math.sin(phase - TAU * FLUTTER.waves * u + 3 * h) * foot;
      if (bubble !== 0 && u < BUBBLE.width) x += bubble * chord * Math.sin((Math.PI * u) / BUBBLE.width) * foot;
      out[o] = lu[0] + (le[0] - lu[0]) * u + x;
      out[o + 1] = lu[1] + (le[1] - lu[1]) * u;
      out[o + 2] = lu[2] + (le[2] - lu[2]) * u;
      o += 3;
    }
  }
  return out;
}

/**
 * Each vertex's normal, into `out` (unit; + where the grid's triangles face:
 * the column's way × the row's way, as Shape.grid winds them), by
 * differences across its neighbours. A row that has shrunk to a point (the
 * main's head) takes the row below's.
 */
export function clothNormals(out, pos, cloth) {
  const R = cloth.rows, C = cloth.cols, W = C + 1;
  for (let r = 0; r <= R; r++) {
    const r0 = r > 0 ? r - 1 : r, r1 = r < R ? r + 1 : r;
    for (let c = 0; c <= C; c++) {
      const c0 = c > 0 ? c - 1 : c, c1 = c < C ? c + 1 : c;
      const a = 3 * (r * W + c0), b = 3 * (r * W + c1), d = 3 * (r0 * W + c), e = 3 * (r1 * W + c);
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[e] - pos[d], vy = pos[e + 1] - pos[d + 1], vz = pos[e + 2] - pos[d + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      const o = 3 * (r * W + c);
      if (l > 1e-12) {
        out[o] = nx / l;
        out[o + 1] = ny / l;
        out[o + 2] = nz / l;
      } else if (r > 0) {
        const p = 3 * ((r - 1) * W + c);
        out[o] = out[p];
        out[o + 1] = out[p + 1];
        out[o + 2] = out[p + 2];
      } else {
        out[o] = 1;
        out[o + 1] = out[o + 2] = 0;
      }
    }
  }
  return out;
}

/** The cloth's point on row `r` at chord fraction `u` (0 luff, 1 leech), from its vertices, into out at o. */
export function clothPoint(out, o, pos, cloth, r, u) {
  const C = cloth.cols;
  const x = clamp(u, 0, 1) * C;
  const c = Math.min(C - 1, Math.floor(x));
  const k = x - c;
  const a = 3 * (r * (C + 1) + c);
  out[o] = pos[a] + (pos[a + 3] - pos[a]) * k;
  out[o + 1] = pos[a + 1] + (pos[a + 4] - pos[a + 1]) * k;
  out[o + 2] = pos[a + 2] + (pos[a + 5] - pos[a + 2]) * k;
  return out;
}

/** How many vertices the battens' ribbons have (two per cloth vertex they run along). */
export const battenCount = (cloth) => (cloth.battens ? cloth.battens.rows.length * (cloth.cols + 1 - cloth.battens.from) * 2 : 0);

/**
 * The battens: a ribbon along each of `battens.rows`, from column
 * `battens.from` to the leech, `width` wide up the sail and `off` to +x of
 * the cloth, from the cloth's own vertices (so they go where it goes).
 * Per batten, a 2-wide grid along the row (Shape.grid(n, 2)'s order).
 */
export function battenVertices(out, pos, cloth) {
  const B = cloth.battens;
  if (!B) return out;
  const R = cloth.rows, W = cloth.cols + 1;
  let o = 0;
  for (const r of B.rows) {
    const r0 = Math.max(0, r - 1), r1 = Math.min(R, r + 1);
    for (let c = B.from; c < W; c++) {
      const p = 3 * (r * W + c), d = 3 * (r0 * W + c), e = 3 * (r1 * W + c);
      let wx = pos[e] - pos[d], wy = pos[e + 1] - pos[d + 1], wz = pos[e + 2] - pos[d + 2];
      const l = Math.hypot(wx, wy, wz) || 1;
      const k = (0.5 * B.width) / l;
      wx *= k;
      wy *= k;
      wz *= k;
      for (let j = 0; j < 2; j++) {
        const s = j === 0 ? -1 : 1;
        out[o] = pos[p] + B.off + s * wx;
        out[o + 1] = pos[p + 1] + s * wy;
        out[o + 2] = pos[p + 2] + s * wz;
        o += 3;
      }
    }
  }
  return out;
}

/**
 * The area of the cloth's outline (its boundary: the luff up, the head row,
 * the leech down, the foot back), as a polygon in its plane (|Σ p×q|/2
 * over x = 0, i.e. in (y, z)). For checking the reef and furl against the
 * contract's figures.
 */
export function outlineArea(pos, cloth) {
  const R = cloth.rows, W = cloth.cols + 1;
  let s = 0;
  let px = NaN, pz = NaN, fx = 0, fz = 0;
  const visit = (i) => {
    const y = pos[3 * i + 1], z = pos[3 * i + 2];
    if (Number.isNaN(px)) (fx = y), (fz = z);
    else s += px * z - pz * y;
    px = y;
    pz = z;
  };
  for (let r = 0; r <= R; r++) visit(r * W); // the luff, up
  for (let c = 1; c < W; c++) visit(R * W + c); // the head row
  for (let r = R - 1; r >= 0; r--) visit(r * W + W - 1); // the leech, down
  for (let c = W - 2; c > 0; c--) visit(c); // the foot, back to the tack
  s += px * fz - pz * fx;
  return Math.abs(s) / 2;
}

/**
 * A cloth stated from its rows (ship.js: the stock main's and the jib's):
 * `rowAt(h)` gives the luff's and the leech's point at height h, [x, y, z]
 * each, in the node's frame.
 */
export function clothOf({ kind, rows, cols, rowAt, depth = 0.085, draft = 0.4, twist = 0.35, foot = 0, battens = null, reef = null }) {
  const luff = [], leech = [];
  for (let r = 0; r <= rows; r++) {
    const { lu: a, le: b } = rowAt(r / rows);
    luff.push(a[0], a[1], a[2]);
    leech.push(b[0], b[1], b[2]);
  }
  return { kind, rows, cols, luff, leech, depth, draft, twist, foot, battens, reef };
}
