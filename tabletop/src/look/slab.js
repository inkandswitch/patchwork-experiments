// A slab: a flat outline extruded, the face of a card, a tile, a token or a
// board, with an image on its top and on its bottom. Pure, no three.js.
// (The geometry moved here from tts-import's shapes.js; the frame is the
// format's now, GAME-FORMAT.md §4.)
//
// The frame is the piece's: metres, Y up, the slab standing on y = 0 (its
// bottom face) with its top at y = thickness, centred on the origin in x and
// z. `size` is [w, d]: across (x) and along (z).
//
// Images, as GAME-FORMAT.md §4 says: the top's image reads from +Z (its top
// edge toward −Z, its left edge toward −X, seen from above); the bottom's
// reads the same way once the slab is turned over about its length (Z), as
// a card is turned over. `turn` turns an image clockwise on its face, in
// quarter turns: the uv a face point shows is worked out from the point's
// place in that reading frame.
//
// A part is { slot, positions, normals, uvs, indices }: `slot` is "top",
// "bottom" or "side", the material it gets.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A growable part whose triangles are wound to face the way they're told. */
function part(slot) {
  const p = { slot, positions: [], normals: [], uvs: [], indices: [] };
  p.vertex = (pos, normal, uv) => {
    p.positions.push(...pos);
    p.normals.push(...normal);
    p.uvs.push(...(uv ?? [0, 0]));
    return p.positions.length / 3 - 1;
  };
  p.tri = (a, b, c, out) => {
    const P = (i) => p.positions.slice(i * 3, i * 3 + 3);
    const n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    if (dot(n, out) >= 0) p.indices.push(a, b, c);
    else p.indices.push(a, c, b);
  };
  return p;
}
const done = (p) => ({ slot: p.slot, positions: p.positions, normals: p.normals, uvs: p.uvs, indices: p.indices });

// ─── outlines in the xz plane, filling ±hx × ±hz ────────────────────────────

export const rectOutline = (hx, hz) => [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]];

/** A rectangle with its corners rounded by r. */
export function roundedOutline(hx, hz, r, seg = 6) {
  const rr = Math.min(r, hx, hz);
  const pts = [];
  const corners = [[hx - rr, hz - rr, 0], [-hx + rr, hz - rr, 90], [-hx + rr, -hz + rr, 180], [hx - rr, -hz + rr, 270]];
  for (const [cx, cz, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      pts.push([cx + rr * Math.cos(a), cz + rr * Math.sin(a)]);
    }
  return pts;
}

export function ellipseOutline(hx, hz, seg = 48) {
  return Array.from({ length: seg }, (_, i) => {
    const a = (2 * Math.PI * i) / seg;
    return [hx * Math.cos(a), hz * Math.sin(a)];
  });
}

/** A hexagon with corners at ±x. */
export const hexOutline = (hx, hz) => [[hx, 0], [hx / 2, hz], [-hx / 2, hz], [-hx, 0], [-hx / 2, -hz], [hx / 2, -hz]];

/** The outline a slab's `outline` names, and whether its sides are shaded smooth. */
export function outlineOf(kind, hx, hz) {
  switch (kind) {
    case "hex":
      return { outline: hexOutline(hx, hz), smooth: false };
    case "circle":
      return { outline: ellipseOutline(hx, hz), smooth: true };
    case "rounded":
      return { outline: roundedOutline(hx, hz, Math.min(hx, hz) * 0.12), smooth: false };
    default:
      return { outline: rectOutline(hx, hz), smooth: false };
  }
}

/**
 * The uv a face point shows: (u0, v0) is its place in the face's reading
 * frame (0..1, u0 rightward, v0 downward); `turn` the image's quarter turns
 * clockwise. A turned image's pixel (a, b) lies at face place (1 − b, a) for
 * 90°, so the point at (u0, v0) shows (v0, 1 − u0); and so on.
 */
export function turned(u0, v0, turn = 0) {
  switch (((Number(turn) % 360) + 360) % 360) {
    case 90:
      return [v0, 1 - u0];
    case 180:
      return [1 - u0, 1 - v0];
    case 270:
      return [1 - v0, u0];
    default:
      return [u0, v0];
  }
}

/**
 * A slab: `outline` (in xz) extruded from y = 0 to y = thickness. Top and
 * bottom carry uvs over the box ±hx × ±hz in their reading frames (above),
 * turned by `turns.top` / `turns.bottom`; sides are flat-shaded, or smooth
 * (`smoothSides`, a circle). `sides: false` leaves them out (a cut-out).
 */
export function slab(outline, thickness, { hx, hz, sides = true, smoothSides = false, turns = {} } = {}) {
  const t = Math.max(0, thickness);
  if (hx == null) hx = Math.max(...outline.map((p) => Math.abs(p[0])));
  if (hz == null) hz = Math.max(...outline.map((p) => Math.abs(p[1])));
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  // the reading frames: the top from above; the bottom turned over about z (x → −x)
  const reading = {
    top: (x, z) => turned((x + hx) / (2 * hx), (z + hz) / (2 * hz), turns.top),
    bottom: (x, z) => turned((hx - x) / (2 * hx), (z + hz) / (2 * hz), turns.bottom),
  };
  const parts = [];
  for (const [slot, y, up] of [["top", t, 1], ["bottom", 0, -1]]) {
    const p = part(slot);
    const uv = reading[slot];
    const c = p.vertex([cx, y, cz], [0, up, 0], uv(cx, cz));
    const ring = outline.map(([x, z]) => p.vertex([x, y, z], [0, up, 0], uv(x, z)));
    for (let i = 0; i < ring.length; i++) p.tri(c, ring[i], ring[(i + 1) % ring.length], [0, up, 0]);
    parts.push(done(p));
  }
  if (sides && t > 0) {
    const p = part("side");
    const total = outline.reduce((s, a, i) => s + Math.hypot(...[0, 1].map((k) => outline[(i + 1) % outline.length][k] - a[k])), 0);
    let run = 0;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const flat = norm([b[1] - a[1], 0, -(b[0] - a[0])]);
      const mid = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz];
      const out = dot(flat, mid) >= 0 ? flat : flat.map((v) => -v);
      const na = smoothSides ? norm([a[0] - cx, 0, a[1] - cz]) : out;
      const nb = smoothSides ? norm([b[0] - cx, 0, b[1] - cz]) : out;
      const u0 = run / total;
      const u1 = (run + len) / total;
      run += len;
      const i0 = p.vertex([a[0], 0, a[1]], na, [u0, 1]);
      const i1 = p.vertex([b[0], 0, b[1]], nb, [u1, 1]);
      const i2 = p.vertex([b[0], t, b[1]], nb, [u1, 0]);
      const i3 = p.vertex([a[0], t, a[1]], na, [u0, 0]);
      p.tri(i0, i1, i2, out);
      p.tri(i0, i2, i3, out);
    }
    parts.push(done(p));
  }
  return parts;
}
