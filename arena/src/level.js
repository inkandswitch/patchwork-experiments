// What a level is made of: a few kinds of block, each a GLB drawn here, and
// the sample arena as a list of where they go. Pure; the scene shows the GLBs
// as ordinary objects, so a level is edited like any other scene. The level's
// look (sky, fog, sun) is play.js's atmosphere.

// ─── painting ───────────────────────────────────────────────────────────────
//
// The blocks are flat-shaded boxes whose faces are cut into rectangles, each
// with a colour of its own (per-vertex COLOR_0, with a white material), so a
// crate reads as planks in a frame and a floor as tiles without a texture.

/** The level's colours (sRGB). One warm palette, so every block belongs to the same place. */
export const PALETTE = {
  tileA: "#cfc1a6",
  tileB: "#ad9c7f",
  floorSide: "#7a6a55",
  wall: "#9a8370",
  wallAlt: "#8f7865",
  wallBase: "#5e4d40",
  wallCap: "#ddd0b8",
  wood: "#c08a4a",
  woodAlt: "#ad7a3e",
  woodEdge: "#6b4424",
  stone: "#a59f92",
  stoneAlt: "#999386",
  stoneTop: "#bdb6a6",
  hazard: "#e8b13a",
  hazardDark: "#3b3632",
  metal: "#8b959c",
  metalAlt: "#78828a",
  metalSide: "#646d74",
  post: "#3b3f45",
  ringLight: "#f3ede0",
  ringRed: "#d23b2b",
  bull: "#f2c230",
  pad: "#2d363c",
  glow: "#47f0cf",
};

const lin = (hex) => {
  // sRGB hex → linear rgb, as COLOR_0 wants
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
};
/** A colour a little lighter or darker (k > 1 lighter), for per-tile variation. */
const shade = (rgb, k) => rgb.map((v) => Math.min(1, v * k));
/** A small stable number in [0, 1) for a cell, so the variation is the same every time. */
const hash = (i, j) => {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Collects coloured quads into one mesh. */
function painter() {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const p = {
    /** A quad, corners counter-clockwise seen from where `n` points. rgb is linear (or a hex). */
    quad(n, corners, rgb) {
      const c = typeof rgb === "string" ? lin(rgb) : rgb;
      const base = positions.length / 3;
      for (const k of corners) positions.push(...k), normals.push(...n), colors.push(...c);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    },
    /**
     * A box from min to max, each face painted by paint(side, w, h, rect):
     * side is "px", "nx", "py", "ny", "pz" or "nz"; rect(s0, t0, s1, t1, rgb)
     * fills part of it, s across (w long) and t up (h long). A hex instead of
     * a function fills every face with it.
     */
    box(min, max, paint) {
      const [x0, y0, z0] = min;
      const [x1, y1, z1] = max;
      const faces = [
        ["px", [1, 0, 0], [x1, y0, z1], [0, 0, -1], [0, 1, 0], z1 - z0, y1 - y0],
        ["nx", [-1, 0, 0], [x0, y0, z0], [0, 0, 1], [0, 1, 0], z1 - z0, y1 - y0],
        ["pz", [0, 0, 1], [x0, y0, z1], [1, 0, 0], [0, 1, 0], x1 - x0, y1 - y0],
        ["nz", [0, 0, -1], [x1, y0, z0], [-1, 0, 0], [0, 1, 0], x1 - x0, y1 - y0],
        ["py", [0, 1, 0], [x0, y1, z1], [1, 0, 0], [0, 0, -1], x1 - x0, z1 - z0],
        ["ny", [0, -1, 0], [x0, y0, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0],
      ];
      for (const [side, n, o, u, v, w, h] of faces) {
        const rect = (s0, t0, s1, t1, rgb) => p.quad(n, [at(o, u, v, s0, t0), at(o, u, v, s1, t0), at(o, u, v, s1, t1), at(o, u, v, s0, t1)], rgb);
        if (typeof paint === "function") paint(side, w, h, rect);
        else rect(0, 0, w, h, paint);
      }
    },
    mesh(name, extra = {}) {
      return { name, positions, normals, colors, indices, color: "#ffffff", ...extra };
    },
  };
  return p;
}
const at = (o, u, v, s, t) => [o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t, o[2] + u[2] * s + v[2] * t];

/** Cut [0, len] into pieces about `size` long: their ends. */
function cuts(len, size) {
  const n = Math.max(1, Math.round(len / size));
  return Array.from({ length: n + 1 }, (_, i) => (len * i) / n);
}

/** Floor tiles: a checker in two tones, each tile a shade off, the edges darker. */
function floorMeshes() {
  const p = painter();
  const A = lin(PALETTE.tileA);
  const B = lin(PALETTE.tileB);
  p.box([-20, -0.4, -20], [20, 0, 20], (side, w, h, rect) => {
    if (side !== "py") return rect(0, 0, w, h, PALETTE.floorSide);
    const s = cuts(w, 2);
    const t = cuts(h, 2);
    for (let i = 0; i < s.length - 1; i++)
      for (let j = 0; j < t.length - 1; j++) rect(s[i], t[j], s[i + 1], t[j + 1], shade((i + j) % 2 ? A : B, 0.94 + hash(i, j) * 0.1));
  });
  return [p.mesh("floor")];
}

/** A wall: panels in two tones over a dark skirting, under a pale cap that overhangs a little. */
function wallMeshes() {
  const p = painter();
  const H = 2.8;
  p.box([-20, 0, -0.3], [20, H, 0.3], (side, w, h, rect) => {
    if (side !== "pz" && side !== "nz") return rect(0, 0, w, h, PALETTE.wallAlt);
    rect(0, 0, w, 0.35, PALETTE.wallBase);
    const s = cuts(w, 4);
    for (let i = 0; i < s.length - 1; i++) rect(s[i], 0.35, s[i + 1], h, i % 2 ? PALETTE.wall : PALETTE.wallAlt);
  });
  p.box([-20.06, H, -0.38], [20.06, H + 0.22, 0.38], (side, w, h, rect) => rect(0, 0, w, h, side === "py" ? PALETTE.wallCap : shade(lin(PALETTE.wallCap), 0.8)));
  return [p.mesh("wall")];
}

/** A crate: on every face, a dark frame round planks in two tones. */
function crateMeshes() {
  const p = painter();
  const S = 1.2;
  const E = 0.12; // the frame's width
  const W = lin(PALETTE.wood);
  const W2 = lin(PALETTE.woodAlt);
  p.box([-S / 2, 0, -S / 2], [S / 2, S, S / 2], (side, w, h, rect) => {
    rect(0, 0, w, E, PALETTE.woodEdge);
    rect(0, h - E, w, h, PALETTE.woodEdge);
    rect(0, E, E, h - E, PALETTE.woodEdge);
    rect(w - E, E, w, h - E, PALETTE.woodEdge);
    const t = cuts(h - 2 * E, 0.24);
    for (let j = 0; j < t.length - 1; j++) rect(E, E + t[j], w - E, E + t[j + 1], j % 2 ? W : shade(W2, 0.97 + hash(j, side.length) * 0.06));
  });
  return [p.mesh("crate")];
}

/** The tower: courses of stone, and a top with a hazard-striped edge. */
function blockMeshes() {
  const p = painter();
  const B = 0.3; // the hazard band
  p.box([-1.5, 0, -1.5], [1.5, 2.4, 1.5], (side, w, h, rect) => {
    if (side === "py") {
      rect(B, B, w - B, h - B, PALETTE.stoneTop);
      // the band, in alternating blocks: two long edges whole, two short between them
      const s = cuts(w, 0.3);
      for (let i = 0; i < s.length - 1; i++) {
        const c = i % 2 ? PALETTE.hazard : PALETTE.hazardDark;
        rect(s[i], 0, s[i + 1], B, c);
        rect(s[i], h - B, s[i + 1], h, c);
      }
      const t = cuts(h - 2 * B, 0.3);
      for (let j = 0; j < t.length - 1; j++) {
        const c = j % 2 ? PALETTE.hazardDark : PALETTE.hazard;
        rect(0, B + t[j], B, B + t[j + 1], c);
        rect(w - B, B + t[j], w, B + t[j + 1], c);
      }
      return;
    }
    const t = cuts(h, 0.6);
    for (let j = 0; j < t.length - 1; j++) rect(0, t[j], w, t[j + 1], j % 2 ? PALETTE.stone : PALETTE.stoneAlt);
  });
  return [p.mesh("block")];
}

/** The ramp: a ridged metal slope with yellow edges, plain metal sides. */
function rampMeshes([w, h, d]) {
  const p = painter();
  const x = w / 2;
  const z = d / 2;
  const L = Math.hypot(h, d);
  const n = [0, d / L, h / L];
  const o = [-x, 0, z];
  const u = [1, 0, 0];
  const v = [0, h / L, -d / L];
  const rect = (s0, t0, s1, t1, c) => p.quad(n, [at(o, u, v, s0, t0), at(o, u, v, s1, t0), at(o, u, v, s1, t1), at(o, u, v, s0, t1)], c);
  const E = 0.14;
  const t = cuts(L, 0.25);
  for (let j = 0; j < t.length - 1; j++) rect(E, t[j], w - E, t[j + 1], j % 2 ? PALETTE.metal : PALETTE.metalAlt);
  rect(0, 0, E, L, PALETTE.hazard);
  rect(w - E, 0, w, L, PALETTE.hazard);
  p.quad([0, -1, 0], [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]], PALETTE.metalSide);
  p.quad([0, 0, -1], [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]], PALETTE.metalSide);
  p.quad([1, 0, 0], [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, -z]], PALETTE.metalSide);
  p.quad([-1, 0, 0], [[-x, 0, -z], [-x, 0, z], [-x, h, -z], [-x, h, -z]], PALETTE.metalSide);
  return [p.mesh("ramp")];
}

/**
 * A target: a round board of concentric rings (the same on both sides) on a
 * post, its centre 1.55 m up, standing on a foot so it falls about its base.
 */
function targetMeshes() {
  const p = painter();
  p.box([-0.06, 0, -0.06], [0.06, 1.15, 0.06], PALETTE.post);
  p.box([-0.28, 0, -0.18], [0.28, 0.06, 0.18], PALETTE.post);
  const C = 1.55; // the board's centre
  const T = 0.04; // half its thickness
  const N = 32; // segments round
  const rings = [
    [0.45, PALETTE.ringLight],
    [0.36, PALETTE.ringRed],
    [0.27, PALETTE.ringLight],
    [0.18, PALETTE.ringRed],
    [0.09, PALETTE.bull],
  ];
  const pt = (r, a, z) => [r * Math.cos(a), C + r * Math.sin(a), z];
  for (let k = 0; k < rings.length; k++) {
    const [ro, c] = rings[k];
    const ri = rings[k + 1]?.[0] ?? 0;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 2 * Math.PI;
      const a1 = ((i + 1) / N) * 2 * Math.PI;
      p.quad([0, 0, 1], [pt(ri, a0, T), pt(ro, a0, T), pt(ro, a1, T), pt(ri, a1, T)], c);
      p.quad([0, 0, -1], [pt(ri, a1, -T), pt(ro, a1, -T), pt(ro, a0, -T), pt(ri, a0, -T)], c);
    }
  }
  // the rim
  const R = rings[0][0];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * 2 * Math.PI;
    const a1 = ((i + 1) / N) * 2 * Math.PI;
    const am = (a0 + a1) / 2;
    p.quad([Math.cos(am), Math.sin(am), 0], [pt(R, a0, -T), pt(R, a1, -T), pt(R, a1, T), pt(R, a0, T)], PALETTE.post);
  }
  return [p.mesh("target")];
}

/** A spawn pad: a dark plate with a glowing (unlit) border and an arrow the way you'll face (-z). */
function spawnMeshes() {
  const plate = painter();
  plate.box([-0.6, 0, -0.6], [0.6, 0.05, 0.6], PALETTE.pad);
  const glow = painter();
  const y = 0.052;
  const flat = (x0, z0, x1, z1) => glow.quad([0, 1, 0], [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], PALETTE.glow);
  const a = 0.5, b = 0.42;
  flat(-a, -a, a, -b);
  flat(-a, b, a, a);
  flat(-a, -b, -b, b);
  flat(b, -b, a, b);
  // the arrow: a chevron pointing to -z
  const tri = (pts) => glow.quad([0, 1, 0], [...pts, pts[2]].map(([px, pz]) => [px, y, pz]), PALETTE.glow);
  tri([[-0.22, 0.05], [0.22, 0.05], [0, -0.28]]);
  glow.quad([0, 1, 0], [[-0.08, y, 0.28], [0.08, y, 0.28], [0.08, y, 0.05], [-0.08, y, 0.05]], PALETTE.glow);
  return [plate.mesh("spawn"), glow.mesh("spawn-glow", { unlit: true })];
}

/**
 * The kinds of block. Each is drawn once and placed many times. A target
 * stands on its base, so knocking it over is a turn about its foot.
 */
export const KINDS = {
  floor: { name: "Floor", meshes: floorMeshes },
  wall: { name: "Wall", meshes: wallMeshes },
  crate: { name: "Crate", meshes: crateMeshes },
  block: { name: "Block", meshes: blockMeshes },
  ramp: { name: "Ramp", meshes: () => rampMeshes([2.4, 2.4, 5]) },
  target: { name: "Target", meshes: targetMeshes },
  spawn: { name: "Spawn", meshes: spawnMeshes },
};

const T = (position, yaw = 0) => ({ position, rotation: [0, yaw, 0], scale: 1 });

/**
 * The sample arena: a walled floor, a raised block with a ramp up to it,
 * crates to hide behind, targets to knock down and four places to start.
 * @returns {{ kind: string, name: string, transform: object, traits?: object }[]}
 */
export function sampleArena() {
  const out = [];
  const add = (kind, name, transform, traits) => out.push({ kind, name, transform, ...(traits ? { traits } : {}) });
  add("floor", "Floor", T([0, 0, 0]));
  add("wall", "North wall", T([0, 0, -20]));
  add("wall", "South wall", T([0, 0, 20]));
  add("wall", "East wall", T([20, 0, 0], Math.PI / 2));
  add("wall", "West wall", T([-20, 0, 0], Math.PI / 2));
  add("block", "Tower", T([0, 0, 0]));
  add("ramp", "Ramp", T([0, 0, 4]));
  const crates = [[-6, -5], [-7, -3.6], [6, 6], [7.4, 6.4], [-9, 9], [10, -9], [10, -7.6], [-3, -12], [4, 12]];
  crates.forEach(([x, z], i) => add("crate", `Crate ${i + 1}`, T([x, 0, z], (i * 0.7) % 1.3)));
  add("crate", "Crate on crate", T([-6, 1.2, -5], 0.4));
  const targets = [[0, -16], [12, -14], [-14, -10], [16, 4], [-16, 12], [8, 16], [0, 2.4, -0.6], [-12, 0]];
  targets.forEach(([x, a, b], i) => {
    // [x, z] on the floor, or [x, y, z] standing on something
    const at = b === undefined ? [x, 0, a] : [x, a, b];
    // each faces the middle
    const yaw = Math.atan2(-at[0], -at[2]) + Math.PI;
    add("target", `Target ${i + 1}`, T(at, yaw), { "arena.target": {} });
  });
  for (const [i, [x, z]] of [[-15, 15], [15, 15], [15, -15], [-15, -15]].entries()) {
    add("spawn", `Spawn ${i + 1}`, T([x, 0, z], Math.atan2(x, z)), { "arena.spawn": {} });
  }
  return out;
}

/** A standing target knocked over: turned a quarter about its foot, away from whoever hit it. */
export function knockedOver(transform, fromYaw) {
  const facing = transform?.rotation?.[1] ?? 0;
  // fall away from the shot: a shooter in front (facing it) pushes it over backwards
  const tilt = (Math.cos(fromYaw - facing) <= 0 ? -1 : 1) * (Math.PI / 2 - 0.02);
  return { position: [...(transform?.position ?? [0, 0, 0])], rotation: yawThenTilt(facing, tilt), scale: transform?.scale ?? 1 };
}

/**
 * Euler XYZ (the scene's rotation order) for a turn of `yaw` about +Y and
 * then a tilt about the turned X axis: R = Ry(yaw) · Rx(tilt).
 */
export function yawThenTilt(yaw, tilt) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ca = Math.cos(tilt), sa = Math.sin(tilt);
  // M = [[cy, sy·sa, sy·ca], [0, ca, -sa], [-sy, cy·sa, cy·ca]], read back as three's XYZ
  const m13 = Math.max(-1, Math.min(1, sy * ca));
  const y = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(sa, cy * ca), y, Math.atan2(-sy * sa, cy)];
  return [Math.atan2(cy * sa, ca), y, 0];
}

/**
 * A target's trait while it's knocked over: { down: { by, at }, stand: {
 * rotation } }, written together by the shot (play.js).
 * - `stand`: it's lying down, and this is the rotation it stood at. About the
 *   object, so a copy keeps it (and is lying down too).
 * - `down`: who knocked it over and when: play state, which a copy leaves
 *   behind (index.js `runtime`), so a copied target is nobody's point.
 * Falling turns a target about its foot, its origin (knockedOver keeps the
 * position), so standing it up is its rotation alone: it stands where it is
 * now, wherever a copy or the editor has put it since.
 */
export const isDown = (o) => {
  const tr = o?.traits?.["arena.target"];
  return !!(tr?.stand || tr?.down);
};

/**
 * Stand every knocked-over target back up (inside a change). Playing and
 * editing both offer it, so it lives here with the doc's shape.
 */
export function standTargetsUp(d) {
  for (const o of Object.values(d.objects ?? {})) {
    if (!isDown(o)) continue;
    const tr = o.traits["arena.target"];
    if (Array.isArray(tr.stand?.rotation)) o.transform.rotation = [...tr.stand.rotation];
    delete tr.down;
    delete tr.stand;
  }
}

/** Whether any target in the scene is knocked over. */
export const anyDown = (objects) => Object.values(objects ?? {}).some(isDown);
