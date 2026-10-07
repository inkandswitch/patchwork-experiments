// The whitelist: every function the language knows, and how it lowers to IR.
//
// A "shape" in this language is just a number-valued expression of the sample
// point (x, y, z): its signed distance. Primitives read the current point;
// transforms lower their shape argument at a *moved* point; combinators mix
// distances. So `translate(0, 1, 0, sphere(0.5))` is the sphere evaluated at
// (x, y - 1, z). Arguments are lowered lazily at whatever point the callee
// chooses, which is what makes user functions like `let post(h) = …` compose
// with transforms.
//
// Conventions: Y is up, lengths are metres, angles are radians (write 30deg).
// Sizes are full sizes (box(0.2, 0.1, 0.1) is 20 × 10 × 10 cm), centred on
// the origin; round things with an axis use the Y axis.

/**
 * @typedef {object} Builtin
 * @property {string} group     "primitive" | "combine" | "transform" | "field" | "math"
 * @property {string[]} params  parameter names, for signatures and completion
 * @property {[number, number]} arity  [min, max] argument count (max may be Infinity)
 * @property {string} doc       one line of help
 * @property {(B: import("./ir.js").Builder, P: {x:number,y:number,z:number}, arg: (i: number, at?: object) => number, n: number) => number} lower
 */

const TAU = Math.PI * 2;
const TINY = 1e-12;

const fixed = (params) => [params.length, params.length];

function smin(B, a, b, k) {
  // polynomial smooth minimum (Quilez); k is the blend radius in metres
  const kk = B.max(k, B.const(1e-9));
  const h = B.div(B.max(B.sub(kk, B.abs(B.sub(a, b))), B.const(0)), kk);
  return B.sub(B.min(a, b), B.mul(B.mul(B.sq(h), kk), B.const(0.25)));
}
const smax = (B, a, b, k) => B.neg(smin(B, B.neg(a), B.neg(b), k));

function rotate(B, P, angle, axis) {
  const c = B.emit("cos", angle);
  const s = B.emit("sin", angle);
  // rotate the shape by +angle, i.e. move the point by -angle
  if (axis === "x") return { x: P.x, y: B.add(B.mul(c, P.y), B.mul(s, P.z)), z: B.sub(B.mul(c, P.z), B.mul(s, P.y)) };
  if (axis === "y") return { x: B.sub(B.mul(c, P.x), B.mul(s, P.z)), y: P.y, z: B.add(B.mul(s, P.x), B.mul(c, P.z)) };
  return { x: B.add(B.mul(c, P.x), B.mul(s, P.y)), y: B.sub(B.mul(c, P.y), B.mul(s, P.x)), z: P.z };
}

function boxDist(B, qx, qy, qz) {
  // q = |p| - halfSize
  const zero = B.const(0);
  const outside = B.len3(B.max(qx, zero), B.max(qy, zero), B.max(qz, zero));
  const inside = B.min(B.max(qx, B.max(qy, qz)), zero);
  return B.add(outside, inside);
}

function fold(B, n, arg, first, f) {
  let acc = arg(first);
  for (let i = first + 1; i < n; i++) acc = f(acc, arg(i));
  return acc;
}

/** @type {Record<string, Builtin>} */
export const BUILTINS = {
  // ── primitives ────────────────────────────────────────────────────────────
  sphere: {
    group: "primitive",
    params: ["r"],
    arity: fixed(["r"]),
    doc: "Sphere of radius r, centred on the origin.",
    lower: (B, P, arg) => B.sub(B.len3(P.x, P.y, P.z), arg(0)),
  },
  box: {
    group: "primitive",
    params: ["sx", "sy", "sz"],
    arity: [3, 3],
    doc: "Box with full sizes sx × sy × sz, centred on the origin.",
    lower: (B, P, arg) => {
      const h = B.const(0.5);
      return boxDist(
        B,
        B.sub(B.abs(P.x), B.mul(arg(0), h)),
        B.sub(B.abs(P.y), B.mul(arg(1), h)),
        B.sub(B.abs(P.z), B.mul(arg(2), h)),
      );
    },
  },
  roundBox: {
    group: "primitive",
    params: ["sx", "sy", "sz", "r"],
    arity: [4, 4],
    doc: "Box of full sizes sx × sy × sz with its edges rounded by radius r.",
    lower: (B, P, arg) => {
      const h = B.const(0.5);
      const r = arg(3);
      const q = (p, s) => B.add(B.sub(B.abs(p), B.mul(s, h)), r);
      return B.sub(boxDist(B, q(P.x, arg(0)), q(P.y, arg(1)), q(P.z, arg(2))), r);
    },
  },
  torus: {
    group: "primitive",
    params: ["R", "r"],
    arity: [2, 2],
    doc: "Torus lying in the XZ plane: ring radius R, tube radius r.",
    lower: (B, P, arg) => B.sub(B.len2(B.sub(B.len2(P.x, P.z), arg(0)), P.y), arg(1)),
  },
  cylinder: {
    group: "primitive",
    params: ["r", "h"],
    arity: [2, 2],
    doc: "Capped cylinder along Y: radius r, full height h, centred.",
    lower: (B, P, arg) => {
      const zero = B.const(0);
      const dx = B.sub(B.len2(P.x, P.z), arg(0));
      const dy = B.sub(B.abs(P.y), B.mul(arg(1), B.const(0.5)));
      return B.add(B.min(B.max(dx, dy), zero), B.len2(B.max(dx, zero), B.max(dy, zero)));
    },
  },
  capsule: {
    group: "primitive",
    params: ["r", "h"],
    arity: [2, 2],
    doc: "Capsule along Y: radius r, straight length h between the two hemispheres, centred.",
    lower: (B, P, arg) => {
      const half = B.mul(arg(1), B.const(0.5));
      const py = B.sub(P.y, B.clamp(P.y, B.neg(half), half));
      return B.sub(B.len3(P.x, py, P.z), arg(0));
    },
  },
  segment: {
    group: "primitive",
    params: ["ax", "ay", "az", "bx", "by", "bz", "r"],
    arity: [7, 7],
    doc: "Rounded rod of radius r from point (ax, ay, az) to (bx, by, bz).",
    lower: (B, P, arg) => {
      const ax = arg(0), ay = arg(1), az = arg(2);
      const bax = B.sub(arg(3), ax), bay = B.sub(arg(4), ay), baz = B.sub(arg(5), az);
      const pax = B.sub(P.x, ax), pay = B.sub(P.y, ay), paz = B.sub(P.z, az);
      const dot = (a1, a2, a3, b1, b2, b3) => B.add(B.add(B.mul(a1, b1), B.mul(a2, b2)), B.mul(a3, b3));
      const t = B.clamp(
        B.div(dot(pax, pay, paz, bax, bay, baz), B.max(dot(bax, bay, baz, bax, bay, baz), B.const(TINY))),
        B.const(0),
        B.const(1),
      );
      return B.sub(B.len3(B.sub(pax, B.mul(bax, t)), B.sub(pay, B.mul(bay, t)), B.sub(paz, B.mul(baz, t))), arg(6));
    },
  },
  ellipsoid: {
    group: "primitive",
    params: ["rx", "ry", "rz"],
    arity: [3, 3],
    doc: "Ellipsoid with semi-axes rx, ry, rz (a close, slightly conservative distance).",
    lower: (B, P, arg) => {
      const rx = arg(0), ry = arg(1), rz = arg(2);
      const k0 = B.len3(B.div(P.x, rx), B.div(P.y, ry), B.div(P.z, rz));
      const k1 = B.len3(B.div(P.x, B.sq(rx)), B.div(P.y, B.sq(ry)), B.div(P.z, B.sq(rz)));
      return B.div(B.mul(k0, B.sub(k0, B.const(1))), B.max(k1, B.const(TINY)));
    },
  },
  plane: {
    group: "primitive",
    params: ["nx", "ny", "nz", "d"],
    arity: [4, 4],
    doc: "Half-space below the plane with normal (nx, ny, nz) at distance d from the origin.",
    lower: (B, P, arg) => {
      const nx = arg(0), ny = arg(1), nz = arg(2);
      const len = B.max(B.len3(nx, ny, nz), B.const(TINY));
      const dot = B.add(B.add(B.mul(P.x, nx), B.mul(P.y, ny)), B.mul(P.z, nz));
      return B.sub(B.div(dot, len), arg(3));
    },
  },
  gyroid: {
    group: "field",
    params: ["period", "thickness"],
    arity: [2, 2],
    doc: "Gyroid lattice filling space: cell size `period`, wall thickness `thickness`. Clip it with intersect().",
    lower: (B, P, arg) => {
      const k = B.div(B.const(TAU), arg(0));
      const X = B.mul(P.x, k), Y = B.mul(P.y, k), Z = B.mul(P.z, k);
      const s = (v) => B.emit("sin", v);
      const c = (v) => B.emit("cos", v);
      const g = B.add(B.add(B.mul(s(X), c(Y)), B.mul(s(Y), c(Z))), B.mul(s(Z), c(X)));
      // |grad g| is at most ~1.5k near the surface, so this stays a safe distance bound
      return B.sub(B.div(B.abs(g), B.mul(k, B.const(1.5))), B.mul(arg(1), B.const(0.5)));
    },
  },
  schwarzP: {
    group: "field",
    params: ["period", "thickness"],
    arity: [2, 2],
    doc: "Schwarz P lattice filling space: cell size `period`, wall thickness `thickness`.",
    lower: (B, P, arg) => {
      const k = B.div(B.const(TAU), arg(0));
      const c = (v) => B.emit("cos", B.mul(v, k));
      const g = B.add(B.add(c(P.x), c(P.y)), c(P.z));
      return B.sub(B.div(B.abs(g), B.mul(k, B.const(1.75))), B.mul(arg(1), B.const(0.5)));
    },
  },

  // ── combinators ───────────────────────────────────────────────────────────
  union: {
    group: "combine",
    params: ["a", "b", "…"],
    arity: [1, Infinity],
    doc: "Everything inside any of the shapes.",
    lower: (B, P, arg, n) => fold(B, n, arg, 0, (a, b) => B.min(a, b)),
  },
  intersect: {
    group: "combine",
    params: ["a", "b", "…"],
    arity: [1, Infinity],
    doc: "Only what is inside all of the shapes.",
    lower: (B, P, arg, n) => fold(B, n, arg, 0, (a, b) => B.max(a, b)),
  },
  subtract: {
    group: "combine",
    params: ["a", "b", "…"],
    arity: [2, Infinity],
    doc: "Shape a with every later shape cut away.",
    lower: (B, P, arg, n) => fold(B, n, arg, 0, (a, b) => B.max(a, B.neg(b))),
  },
  smoothUnion: {
    group: "combine",
    params: ["k", "a", "b", "…"],
    arity: [2, Infinity],
    doc: "Union with fillets: k is the blend radius.",
    lower: (B, P, arg, n) => {
      const k = arg(0);
      return fold(B, n, arg, 1, (a, b) => smin(B, a, b, k));
    },
  },
  smoothIntersect: {
    group: "combine",
    params: ["k", "a", "b", "…"],
    arity: [2, Infinity],
    doc: "Intersection with rounded creases of radius k.",
    lower: (B, P, arg, n) => {
      const k = arg(0);
      return fold(B, n, arg, 1, (a, b) => smax(B, a, b, k));
    },
  },
  smoothSubtract: {
    group: "combine",
    params: ["k", "a", "b", "…"],
    arity: [3, Infinity],
    doc: "Cut the later shapes out of a, rounding the cut edge by k.",
    lower: (B, P, arg, n) => {
      const k = arg(0);
      return fold(B, n, arg, 1, (a, b) => smax(B, a, B.neg(b), k));
    },
  },
  shell: {
    group: "combine",
    params: ["thickness", "shape"],
    arity: [2, 2],
    doc: "Hollow out a shape, leaving a wall `thickness` thick centred on its surface.",
    lower: (B, P, arg) => B.sub(B.abs(arg(1)), B.mul(arg(0), B.const(0.5))),
  },
  offset: {
    group: "combine",
    params: ["d", "shape"],
    arity: [2, 2],
    doc: "Grow the shape outwards by d (negative d shrinks it).",
    lower: (B, P, arg) => B.sub(arg(1), arg(0)),
  },

  // ── transforms ────────────────────────────────────────────────────────────
  translate: {
    group: "transform",
    params: ["dx", "dy", "dz", "shape"],
    arity: [4, 4],
    doc: "Move the shape by (dx, dy, dz).",
    lower: (B, P, arg) => arg(3, { x: B.sub(P.x, arg(0)), y: B.sub(P.y, arg(1)), z: B.sub(P.z, arg(2)) }),
  },
  rotateX: {
    group: "transform",
    params: ["angle", "shape"],
    arity: [2, 2],
    doc: "Rotate about the X axis (radians; write 30deg for degrees).",
    lower: (B, P, arg) => arg(1, rotate(B, P, arg(0), "x")),
  },
  rotateY: {
    group: "transform",
    params: ["angle", "shape"],
    arity: [2, 2],
    doc: "Rotate about the Y (up) axis.",
    lower: (B, P, arg) => arg(1, rotate(B, P, arg(0), "y")),
  },
  rotateZ: {
    group: "transform",
    params: ["angle", "shape"],
    arity: [2, 2],
    doc: "Rotate about the Z axis.",
    lower: (B, P, arg) => arg(1, rotate(B, P, arg(0), "z")),
  },
  scale: {
    group: "transform",
    params: ["f", "shape"],
    arity: [2, 4],
    arityHelp: "2 arguments (f, shape) or 4 (sx, sy, sz, shape)",
    doc: "Scale uniformly by f — or scale(sx, sy, sz, shape) for a non-uniform (approximate) stretch.",
    lower: (B, P, arg, n) => {
      if (n === 2) {
        const f = arg(0);
        return B.mul(arg(1, { x: B.div(P.x, f), y: B.div(P.y, f), z: B.div(P.z, f) }), f);
      }
      if (n !== 4) return null; // arity error, reported by the checker
      const sx = arg(0), sy = arg(1), sz = arg(2);
      return B.mul(arg(3, { x: B.div(P.x, sx), y: B.div(P.y, sy), z: B.div(P.z, sz) }), B.min(sx, B.min(sy, sz)));
    },
  },
  mirrorX: {
    group: "transform",
    params: ["shape"],
    arity: [1, 1],
    doc: "Mirror the +X half of the shape onto −X (symmetric about the YZ plane).",
    lower: (B, P, arg) => arg(0, { ...P, x: B.abs(P.x) }),
  },
  mirrorY: {
    group: "transform",
    params: ["shape"],
    arity: [1, 1],
    doc: "Mirror the +Y half onto −Y.",
    lower: (B, P, arg) => arg(0, { ...P, y: B.abs(P.y) }),
  },
  mirrorZ: {
    group: "transform",
    params: ["shape"],
    arity: [1, 1],
    doc: "Mirror the +Z half onto −Z.",
    lower: (B, P, arg) => arg(0, { ...P, z: B.abs(P.z) }),
  },
  repeat: {
    group: "transform",
    params: ["cx", "cy", "cz", "shape"],
    arity: [4, 4],
    doc: "Repeat the shape forever on a grid with spacing (cx, cy, cz); 0 leaves that axis alone.",
    lower: (B, P, arg) => {
      const rep = (p, c) => {
        if (B.constValue(c) === 0) return p;
        const safe = B.max(B.abs(c), B.const(TINY));
        return B.sub(p, B.mul(safe, B.emit("floor", B.add(B.div(p, safe), B.const(0.5)))));
      };
      return arg(3, { x: rep(P.x, arg(0)), y: rep(P.y, arg(1)), z: rep(P.z, arg(2)) });
    },
  },
  at: {
    group: "transform",
    params: ["px", "py", "pz", "shape"],
    arity: [4, 4],
    doc: "Evaluate the shape at the point (px, py, pz), each written in terms of x, y, z — any domain warp you like.",
    lower: (B, P, arg) => arg(3, { x: arg(0), y: arg(1), z: arg(2) }),
  },
  twist: {
    group: "transform",
    params: ["rate", "shape"],
    arity: [2, 2],
    doc: "Twist about the Y axis by `rate` radians per metre of height (distance becomes approximate).",
    lower: (B, P, arg) => arg(1, rotate(B, P, B.mul(arg(0), P.y), "y")),
  },

  // ── math ──────────────────────────────────────────────────────────────────
  abs: { group: "math", params: ["v"], arity: [1, 1], doc: "Absolute value.", lower: (B, P, arg) => B.abs(arg(0)) },
  min: {
    group: "math",
    params: ["a", "b", "…"],
    arity: [1, Infinity],
    doc: "Smallest value.",
    lower: (B, P, arg, n) => fold(B, n, arg, 0, (a, b) => B.min(a, b)),
  },
  max: {
    group: "math",
    params: ["a", "b", "…"],
    arity: [1, Infinity],
    doc: "Largest value.",
    lower: (B, P, arg, n) => fold(B, n, arg, 0, (a, b) => B.max(a, b)),
  },
  clamp: {
    group: "math",
    params: ["v", "lo", "hi"],
    arity: [3, 3],
    doc: "v limited to the range lo…hi.",
    lower: (B, P, arg) => B.clamp(arg(0), arg(1), arg(2)),
  },
  mix: {
    group: "math",
    params: ["a", "b", "t"],
    arity: [3, 3],
    doc: "Linear blend: a when t = 0, b when t = 1.",
    lower: (B, P, arg) => {
      const a = arg(0);
      return B.add(a, B.mul(B.sub(arg(1), a), arg(2)));
    },
  },
  smoothstep: {
    group: "math",
    params: ["e0", "e1", "v"],
    arity: [3, 3],
    doc: "Smooth 0→1 ramp as v goes from e0 to e1.",
    lower: (B, P, arg) => {
      const e0 = arg(0);
      const t = B.clamp(B.div(B.sub(arg(2), e0), B.sub(arg(1), e0)), B.const(0), B.const(1));
      return B.mul(B.sq(t), B.sub(B.const(3), B.mul(B.const(2), t)));
    },
  },
  length: {
    group: "math",
    params: ["a", "b", "c?"],
    arity: [2, 3],
    doc: "√(a² + b²) or √(a² + b² + c²).",
    lower: (B, P, arg, n) => (n === 2 ? B.len2(arg(0), arg(1)) : B.len3(arg(0), arg(1), arg(2))),
  },
  sqrt: { group: "math", params: ["v"], arity: [1, 1], doc: "Square root.", lower: (B, P, arg) => B.sqrt(arg(0)) },
  pow: {
    group: "math",
    params: ["a", "b"],
    arity: [2, 2],
    doc: "a to the power b (also written a ^ b).",
    lower: (B, P, arg) => B.emit("pow", arg(0), arg(1)),
  },
  exp: { group: "math", params: ["v"], arity: [1, 1], doc: "e to the power v.", lower: (B, P, arg) => B.emit("exp", arg(0)) },
  log: { group: "math", params: ["v"], arity: [1, 1], doc: "Natural logarithm.", lower: (B, P, arg) => B.emit("log", arg(0)) },
  sin: { group: "math", params: ["a"], arity: [1, 1], doc: "Sine (radians).", lower: (B, P, arg) => B.emit("sin", arg(0)) },
  cos: { group: "math", params: ["a"], arity: [1, 1], doc: "Cosine (radians).", lower: (B, P, arg) => B.emit("cos", arg(0)) },
  tan: { group: "math", params: ["a"], arity: [1, 1], doc: "Tangent (radians).", lower: (B, P, arg) => B.emit("tan", arg(0)) },
  asin: { group: "math", params: ["v"], arity: [1, 1], doc: "Arc sine.", lower: (B, P, arg) => B.emit("asin", arg(0)) },
  acos: { group: "math", params: ["v"], arity: [1, 1], doc: "Arc cosine.", lower: (B, P, arg) => B.emit("acos", arg(0)) },
  atan: {
    group: "math",
    params: ["y", "x?"],
    arity: [1, 2],
    doc: "Arc tangent; atan(y, x) gives the full-circle angle.",
    lower: (B, P, arg, n) => (n === 1 ? B.emit("atan", arg(0)) : B.emit("atan2", arg(0), arg(1))),
  },
  floor: { group: "math", params: ["v"], arity: [1, 1], doc: "Round down.", lower: (B, P, arg) => B.emit("floor", arg(0)) },
  ceil: { group: "math", params: ["v"], arity: [1, 1], doc: "Round up.", lower: (B, P, arg) => B.emit("ceil", arg(0)) },
  round: {
    group: "math",
    params: ["v"],
    arity: [1, 1],
    doc: "Round to the nearest whole number.",
    lower: (B, P, arg) => B.emit("floor", B.add(arg(0), B.const(0.5))),
  },
  fract: { group: "math", params: ["v"], arity: [1, 1], doc: "Fractional part, v − floor(v).", lower: (B, P, arg) => B.emit("fract", arg(0)) },
  mod: {
    group: "math",
    params: ["a", "b"],
    arity: [2, 2],
    doc: "Remainder of a / b, with the sign of b.",
    lower: (B, P, arg) => B.emit("mod", arg(0), arg(1)),
  },
  sign: { group: "math", params: ["v"], arity: [1, 1], doc: "−1, 0 or 1.", lower: (B, P, arg) => B.emit("sign", arg(0)) },
  step: {
    group: "math",
    params: ["edge", "v"],
    arity: [2, 2],
    doc: "0 when v < edge, else 1.",
    lower: (B, P, arg) => B.emit("step", arg(0), arg(1)),
  },
};

/** Named constants. `x`, `y`, `z` are the sample point and are handled by the lowering. */
export const CONSTANTS = Object.freeze({ pi: Math.PI, tau: TAU });

export const POINT_NAMES = Object.freeze(["x", "y", "z"]);

export const GROUP_LABELS = {
  primitive: "Primitives",
  field: "Lattices",
  combine: "Combine",
  transform: "Transform",
  math: "Math",
};

/** "translate(dx, dy, dz, shape)" */
export function signature(name) {
  const b = BUILTINS[name];
  return b ? `${name}(${b.params.join(", ")})` : name;
}

export function arityText(b) {
  if (b.arityHelp) return b.arityHelp;
  const [lo, hi] = b.arity;
  if (lo === hi) return `${lo} argument${lo === 1 ? "" : "s"}`;
  if (hi === Infinity) return `at least ${lo} argument${lo === 1 ? "" : "s"}`;
  if (hi === lo + 1) return `${lo} or ${hi} arguments`;
  return `${lo} to ${hi} arguments`;
}

export function acceptsArity(b, n) {
  if (n < b.arity[0] || n > b.arity[1]) return false;
  if (b === BUILTINS.scale) return n === 2 || n === 4;
  return true;
}
