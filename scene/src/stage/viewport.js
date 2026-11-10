// The stage's renderer (STAGE.md, "Inside the stage"): the WebGL renderer,
// lights and the extensions' atmosphere (sky, fog, sun), object nodes and
// their display, the camera rig (orbit, hold, limits), picking with vertex
// snap, the extensions' drawing layers (world groups, an on-top pass, DOM
// labels) and the frame loop. It draws nothing of its own beyond the objects
// and the sky: no grid, axes, gizmo, selection or dimensions
// (those are extensions now), and it listens to no input but the orbit's.
// It knows nothing about automerge; the stage drives it from the scene doc.

import {
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Matrix3,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  Triangle,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { applyMaterialRules, prepareGLB } from "../gltf-content.js";
import { rulesKey, sanitizeRules } from "../material-rules.js";
import { buildBVH, ensureBVH, installLazyBVH, triangleCount, wantsBVH } from "../pick-accel.js";
import { defaultSnapRadius } from "../hand.js";
import { onThemeChange, resolveCssColor } from "../theme.js";
import { createRides } from "./ride.js";

const DEFAULT_THEME = {
  bg: [0.96, 0.96, 0.96],
  fg: [0.1, 0.1, 0.1],
  gridMajor: [0.6, 0.6, 0.6],
  gridMinor: [0.82, 0.82, 0.82],
  accent: [0.2, 0.9, 0.75],
  remote: [0.6, 0.4, 0.9],
  muted: [0.5, 0.5, 0.5],
  object: [0.7, 0.72, 0.78],
  axisX: [0.85, 0.2, 0.2],
  axisY: [0.2, 0.7, 0.25],
  axisZ: [0.2, 0.4, 0.9],
  dim: [0.9, 0.5, 0.1],
};
const THEME_VARS = {
  bg: "--scene-viewport-bg",
  fg: "--scene-fg",
  gridMajor: "--scene-grid-major",
  gridMinor: "--scene-grid-minor",
  accent: "--scene-accent",
  remote: "--scene-remote",
  muted: "--scene-muted",
  object: "--scene-object",
  axisX: "--scene-axis-x",
  axisY: "--scene-axis-y",
  axisZ: "--scene-axis-z",
  dim: "--scene-dimension",
};

const color = (rgb) => new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
const v3 = (a) => (Array.isArray(a) ? new Vector3(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0) : new Vector3().copy(a));

/** Does this matrix rotate (or shear) anything, beyond per-axis scale and translation? */
function hasRotation(m) {
  const e = m.elements;
  const scale = Math.abs(e[0]) + Math.abs(e[5]) + Math.abs(e[10]) || 1;
  const eps = 1e-9 * scale;
  return Math.abs(e[1]) > eps || Math.abs(e[2]) > eps || Math.abs(e[4]) > eps || Math.abs(e[6]) > eps || Math.abs(e[8]) > eps || Math.abs(e[9]) > eps;
}

/** Dispose everything under root: geometry, materials and their textures (not shared placeholders). */
export function disposeObject(root) {
  root?.traverse?.((o) => {
    if (o.userData?.shared) return; // placeholders share one geometry and material
    if (o.isInstancedMesh) o.dispose?.();
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose();
      m.dispose?.();
    }
  });
}

const UNIT_BOX_EDGES = (() => {
  const c = [-0.5, 0.5];
  const pts = [];
  for (const a of c) for (const b of c) {
    pts.push([-0.5, a, b], [0.5, a, b]);
    pts.push([a, -0.5, b], [a, 0.5, b]);
    pts.push([a, b, -0.5], [a, b, 0.5]);
  }
  return pts;
})();

const clamp01 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
};

function lineGeometry(points) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
  return g;
}

/** Set a node's local transform from a doc-shaped { position, rotation (Euler XYZ), scale }. */
function placeLocal(g, t) {
  g.position.fromArray(t?.position ?? [0, 0, 0]);
  const rot = t?.rotation ?? [0, 0, 0];
  g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, "XYZ");
  const s = Number(t?.scale) || 1;
  g.scale.set(s, s, s);
}

/** A Box3 from a Box3 or a { min, max } of arrays (or vectors); null if it isn't one. */
export function toBox3(box) {
  if (!box) return null;
  if (box.isBox3) return box;
  if (!box.min || !box.max) return null;
  const b = new Box3(v3(box.min), v3(box.max));
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite) ? b : null;
}

/** Light intensities (see the constructor). keyFrom: the key light's direction, from the origin. */
export const LIGHTS = Object.freeze({ key: 1.5, keyFrom: [0.45, 1, 0.6], headlight: 0.45, hemisphere: 0.35, environment: 0.35 });

// ─── atmosphere ─────────────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** An sRGB hex colour as given ("#rgb", "#rrggbb" or a number), or null. */
function hexColour(v) {
  if (typeof v === "string" && HEX.test(v.trim())) return v.trim().toLowerCase();
  if (Number.isInteger(v) && v >= 0 && v <= 0xffffff) return `#${v.toString(16).padStart(6, "0")}`;
  return null;
}
const finite = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * An atmosphere (STAGE.md, "Atmosphere") made safe to draw: colours checked,
 * numbers finite, the sun's direction a unit vector; whatever can't be used
 * is left out, and nothing usable at all is null. A sky missing a colour takes
 * a neighbour's; fog without a colour takes the sky's horizon; a sun without
 * a direction stands where the key light does.
 * @returns {{ sky?: { top, horizon, bottom }, fog?: { color, near, far }, sun?: { direction, color, intensity, shadows }, exposure?: number } | null}
 */
export function cleanAtmosphere(a) {
  if (!a || typeof a !== "object") return null;
  const out = {};
  if (a.sky && typeof a.sky === "object") {
    const t = hexColour(a.sky.top), h = hexColour(a.sky.horizon), b = hexColour(a.sky.bottom);
    const horizon = h ?? t ?? b;
    if (horizon) out.sky = { top: t ?? horizon, horizon, bottom: b ?? horizon };
  }
  if (a.fog && typeof a.fog === "object") {
    const color = hexColour(a.fog.color) ?? out.sky?.horizon ?? null;
    const near = Math.max(0, finite(a.fog.near) ?? 0);
    const far = finite(a.fog.far);
    if (color && far != null && far > near) out.fog = { color, near, far };
  }
  if (a.sun && typeof a.sun === "object") {
    const d = Array.isArray(a.sun.direction) ? a.sun.direction.slice(0, 3).map(finite) : [];
    const len = d.length === 3 && d.every((v) => v != null) ? Math.hypot(d[0], d[1], d[2]) : 0;
    const from = len > 1e-9 ? d : LIGHTS.keyFrom;
    const n = Math.hypot(from[0], from[1], from[2]);
    const intensity = finite(a.sun.intensity);
    out.sun = {
      direction: from.map((v) => v / n),
      color: hexColour(a.sun.color) ?? "#ffffff",
      intensity: intensity != null && intensity >= 0 ? intensity : LIGHTS.key,
      shadows: a.sun.shadows === true,
    };
  }
  const exposure = finite(a.exposure);
  if (exposure != null && exposure > 0) out.exposure = exposure;
  return Object.keys(out).length ? out : null;
}

/**
 * The lights an atmosphere (cleanAtmosphere's) asks for. No atmosphere is
 * exactly the stage's own rig (LIGHTS): a white key light high to one side,
 * a headlight, a grey sky/ground and the environment. A sun replaces the key
 * light (its direction, colour, strength, shadows), and the headlight
 * dims to a third, as there's no lamp on the camera outdoors and a full one
 * would fill the sun's shadows in; a sky tints the sky/ground light with its
 * top and bottom; exposure scales every light.
 */
export function lighting(atm) {
  const x = atm?.exposure ?? 1;
  return {
    hemisphere: { intensity: LIGHTS.hemisphere * x, sky: atm?.sky?.top ?? "#ffffff", ground: atm?.sky?.bottom ?? "#3a3a3a" },
    key: {
      intensity: (atm?.sun?.intensity ?? LIGHTS.key) * x,
      color: atm?.sun?.color ?? "#ffffff",
      from: atm?.sun ? [...atm.sun.direction] : [...LIGHTS.keyFrom],
      shadows: !!atm?.sun?.shadows,
    },
    headlight: (atm?.sun ? LIGHTS.headlight / 3 : LIGHTS.headlight) * x,
    environment: LIGHTS.environment * x,
  };
}

// ─── the sun's shadow frame (pure) ───────────────────────────────────────────

/**
 * How far from what's looked at an object may be and still set the shadow
 * frame, and the frame's largest radius (m: a step of ladderRadius, so a
 * capped frame's texel is 2 · 16 / 2048, 1.6 cm; a 12 m sloop alone, mast
 * and keel and all, is about 11 m round, 1.1 cm). At 32 m the sloop and the
 * buoys near her shared 3 cm texels.
 */
export const SHADOW_REACH = 50;
export const SHADOW_CAP = 16;

/**
 * The sun's shadow camera's right and up axes, exactly as three builds them
 * (Matrix4.lookAt from the light toward its target, world up +y), for a unit
 * `direction` toward the sun. The texel grid lies along these.
 * @returns {{ x: number[], y: number[] }}
 */
export function lightBasis(direction) {
  let [zx, zy, zz] = direction;
  // three's lookAt nudges a direction parallel to up the same way
  let xx = zz, xz = -zx; // up (0,1,0) × z
  if (Math.hypot(xx, xz) === 0) {
    zz += 0.0001;
    const n = Math.hypot(zx, zy, zz);
    zx /= n;
    zy /= n;
    zz /= n;
    xx = zz;
    xz = -zx;
  }
  const xl = Math.hypot(xx, xz);
  const x = [xx / xl, 0, xz / xl];
  // y = z × x
  const y = [zy * x[2] - zz * x[1], zz * x[0] - zx * x[2], zx * x[1] - zy * x[0]];
  return { x, y };
}

/**
 * The sphere the sun's shadow map covers: what's within `reach` of `focus`
 * (what the orbit looks at, or the held camera), nearest first, as long as
 * the union stays within `cap` (so a ship's own shadows get the texels, and
 * a buoy across the water joins only if it fits). A box bigger than `cap`
 * on its own (terrain, a sea, an islet) is a backdrop: it takes shadows
 * inside the frame but doesn't size it. Nothing that fits: the `cap` sphere
 * about the focus. No boxes at all: null.
 * @param {{ min: number[], max: number[] }[]} boxes  world boxes
 * @param {number[]} focus
 * @returns {{ center: number[], radius: number } | null}
 */
export function shadowFocus(boxes, focus, { reach = SHADOW_REACH, cap = SHADOW_CAP } = {}) {
  if (!boxes?.length) return null;
  const near = [];
  for (const b of boxes) {
    let d2 = 0;
    for (let i = 0; i < 3; i++) {
      const v = focus[i] < b.min[i] ? b.min[i] - focus[i] : focus[i] > b.max[i] ? focus[i] - b.max[i] : 0;
      d2 += v * v;
    }
    if (d2 <= reach * reach) near.push([d2, b]);
  }
  near.sort((p, q) => p[0] - q[0]);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const nlo = [0, 0, 0];
  const nhi = [0, 0, 0];
  for (const [, b] of near) {
    for (let i = 0; i < 3; i++) {
      nlo[i] = Math.min(lo[i], b.min[i]);
      nhi[i] = Math.max(hi[i], b.max[i]);
    }
    if (0.5 * Math.hypot(nhi[0] - nlo[0], nhi[1] - nlo[1], nhi[2] - nlo[2]) > cap) continue;
    for (let i = 0; i < 3; i++) {
      lo[i] = nlo[i];
      hi[i] = nhi[i];
    }
  }
  if (lo[0] > hi[0]) return { center: [...focus], radius: cap };
  const radius = Math.max(0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 0.05);
  return { center: [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2), radius };
}

/** A radius rounded up onto a ladder of quarter octaves (19% apart), so the texel size holds still while what's covered changes a little. */
export function ladderRadius(r) {
  return 2 ** (Math.ceil(Math.log2(Math.max(r, 0.05)) * 4 - 1e-9) / 4);
}

/**
 * Where a shadow-casting sun stands to cover `sphere`: its centre moved to
 * whole texels along the light's right and up axes (and depth), so a frame
 * that moves only ever moves by whole texels and the shadows' edges don't
 * crawl; the light `direction` (unit, toward the sun) twice the radius out;
 * an orthographic frustum the sphere's size; a depth bias of one texel and a
 * normal bias of a texel and a half, both in world units turned into three's.
 * @param {{ center: number[], radius: number }} sphere  @param {number[]} direction  @param {number} mapSize
 */
export function shadowFrame(sphere, direction, mapSize = 2048) {
  const r = sphere.radius;
  const texel = (2 * r) / mapSize;
  const { x, y } = lightBasis(direction);
  const c = sphere.center;
  // the centre in whole texels along each axis, and back: the same texels, the same point
  const k = [x, y, direction].map((a) => Math.round((a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / texel));
  const target = [0, 1, 2].map((i) => texel * (k[0] * x[i] + k[1] * y[i] + k[2] * direction[i]));
  const near = r * 0.5;
  const far = r * 3.5;
  return {
    target,
    position: target.map((v, i) => v + direction[i] * 2 * r),
    radius: r,
    texel,
    near,
    far,
    // three's depth for an orthographic shadow is (z - near) / (far - near)
    bias: -texel / (far - near),
    normalBias: texel * 1.5,
  };
}

// The sky: one triangle over the whole screen, drawn first, that turns each
// pixel back into the direction it looks along and shades that by height:
// horizon to top above, horizon to bottom below, and a soft sun where there
// is one. It writes no depth and is never picked or boxed.
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 view = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = (inverse(viewMatrix) * vec4(view.xyz / view.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 bottom;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunOn;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = d.y > 0.0 ? mix(horizon, top, pow(d.y, 0.55)) : mix(horizon, bottom, pow(-d.y, 0.4));
  float s = max(dot(d, sunDir), 0.0);
  c += sunOn * sunColor * (smoothstep(0.9993, 0.9997, s) * 1.5 + pow(s, 16.0) * 0.3);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  // a gradient over a whole screen bands in 8 bits: half a level of noise either way
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}`;

// ─── pure helpers (tested without WebGL) ────────────────────────────────────

/**
 * What a GLB says about itself, for contentOf(id).extras: the scene's own
 * extras, plus its connectors (findSnapPoints, in body space), their snap
 * radius (the GLB's, or the spacing of its connectors when it gives none) and
 * its raw legend. The stage's fields win over same-named scene extras.
 * @param {{ extras?: object, snap?: { points: object[], radius: number | null }, legend?: object | null }} prepared  prepareGLB's result
 */
export function contentExtras(prepared) {
  const points = prepared?.snap?.points ?? [];
  const radius = prepared?.snap?.radius ?? (points.length ? defaultSnapRadius(points) : null);
  return Object.freeze({ ...(prepared?.extras ?? {}), connectors: points, snapRadius: radius ?? null, legend: prepared?.legend ?? null });
}

/**
 * Every live camera limit intersected into one, in OrbitControls' terms.
 * Missing fields don't limit. When two limits can't both hold (one's minimum
 * past another's maximum), the larger minimum wins: the range collapses onto
 * it rather than going empty.
 * @param {Iterable<{ minPolar?, maxPolar?, minDistance?, maxDistance? }>} specs
 * @returns {{ minPolar: number, maxPolar: number, minDistance: number, maxDistance: number }}
 */
export function intersectLimits(specs) {
  const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  let minPolar = 0;
  let maxPolar = Math.PI;
  let minDistance = 0;
  let maxDistance = Infinity;
  for (const s of specs ?? []) {
    if (!s) continue;
    const a = num(s.minPolar), b = num(s.maxPolar), c = num(s.minDistance), d = num(s.maxDistance);
    if (a != null) minPolar = Math.max(minPolar, a);
    if (b != null) maxPolar = Math.min(maxPolar, b);
    if (c != null) minDistance = Math.max(minDistance, c);
    if (d != null) maxDistance = Math.min(maxDistance, d);
  }
  minPolar = Math.min(Math.max(minPolar, 0), Math.PI);
  maxPolar = Math.max(Math.min(maxPolar, Math.PI), minPolar);
  minDistance = Math.max(minDistance, 0);
  maxDistance = Math.max(maxDistance, minDistance);
  return { minPolar, maxPolar, minDistance, maxDistance };
}

/**
 * Where the orbit target goes when the camera is let go: straight ahead of
 * it, as far as the orbit was looking before it was held (1 if that's
 * unknown), so the first orbit after a release turns about what's in front.
 * @param {number[]} position  [x, y, z]
 * @param {number[]} forward   the camera's view direction (need not be unit)
 * @returns {[number, number, number]}
 */
export function reseatTarget(position, forward, distance) {
  const len = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  const d = Number.isFinite(distance) && distance > 1e-6 ? distance : 1;
  return [position[0] + (forward[0] / len) * d, position[1] + (forward[1] / len) * d, position[2] + (forward[2] / len) * d];
}

/**
 * Drop whatever motion OrbitControls still has queued (the damped tail of a
 * fling, a half-applied pan or zoom), so a camera that was just set or let go
 * stays where it was put. These are OrbitControls' private fields (three
 * 0.186); anything missing is left alone.
 */
export function resetOrbitMotion(controls) {
  controls?._sphericalDelta?.set?.(0, 0, 0);
  controls?._panOffset?.set?.(0, 0, 0);
  if (controls && "_scale" in controls) controls._scale = 1;
}

/**
 * The near and far planes. Depth precision goes with near / distance (a
 * 24-bit buffer resolves about z² / (near · 2²⁴)), and a card's layers are
 * 0.2 mm apart, so near sits halfway to the nearest geometry (`clear`: a
 * lower bound on the camera's distance to any object, see nearestClear).
 * When that couldn't be told (the camera inside something it can't measure)
 * near is dist / 200. Far reaches well past the scene. A camera holder's own
 * planes, where it gave them, win.
 * @param {{ dist: number, radius: number, clear: number, known?: boolean, held?: { near?: number, far?: number } | null }} o
 */
export function depthRange({ dist, radius, clear, known = true, held = null }) {
  const near = known ? Math.max(clear / 2, 1e-4) : Math.max(dist / 200, 1e-4);
  const far = Math.max(dist * 100, dist + radius * 20, 10);
  return { near: held?.near ?? near, far: held?.far ?? far };
}

// ─── labels ─────────────────────────────────────────────────────────────────

// Which labels give way when they overlap: a label is hidden if it would cover
// one of higher (or equal, earlier) rank, and rank NEVER_HIDE and up never
// hide. Each item says its own `rank` (1 if it doesn't).
const NEVER_HIDE = 2;

const labelRank = (entry) => (Number.isFinite(entry.rank) ? entry.rank : 1);

/** Hide labels that overlap one of higher rank. entries: { el, p: { x, y }, rank? }; caches each el's size. */
export function declutter(entries) {
  const sized = entries.map((e) => {
    const text = e.el.textContent;
    if (e.sizeFor !== text || !e.w) {
      e.w = e.el.offsetWidth;
      e.h = e.el.offsetHeight;
      e.sizeFor = text;
    }
    return { e, rank: labelRank(e) };
  });
  sized.sort((a, b) => b.rank - a.rank);
  const kept = [];
  const gap = 2;
  for (const { e, rank } of sized) {
    const r = { x0: e.p.x - e.w / 2 - gap, x1: e.p.x + e.w / 2 + gap, y0: e.p.y - e.h / 2 - gap, y1: e.p.y + e.h / 2 + gap };
    const hit = rank < NEVER_HIDE && kept.some((k) => r.x0 < k.x1 && r.x1 > k.x0 && r.y0 < k.y1 && r.y1 > k.y0);
    e.el.style.visibility = hit ? "hidden" : "";
    if (!hit) kept.push(r);
  }
}

/**
 * Where a dimension's label goes. At its midpoint, unless the dimension is
 * short on screen — under 2½ label widths — in which case the label would sit
 * on top of the very thing it measures (a cleat's length is about one label
 * wide at any sensible zoom, and even a close-up of it leaves the label over
 * its middle). Then it moves off the line, perpendicular to it and
 * upward where it can, far enough for its box to clear the line by `gap`, and
 * gets a leader back to the midpoint. Pure; screen pixels.
 * @returns {{ x: number, y: number, leader: null | { x0: number, y0: number, x1: number, y1: number } }}
 */
export function placeDimensionLabel(pa, pb, w, h, gap = 14) {
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy);
  if (len >= 2.5 * w) return { x: mx, y: my, leader: null };
  // perpendicular, pointing up the screen (or right, for a vertical line)
  let nx = len > 1e-6 ? -dy / len : 0;
  let ny = len > 1e-6 ? dx / len : -1;
  if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) (nx = -nx), (ny = -ny);
  const d = gap + Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
  const x = mx + nx * d;
  const y = my + ny * d;
  return { x, y, leader: { x0: mx, y0: my, x1: x, y1: y } };
}

/**
 * DOM labels that track 3D points, one set per owner (an extension id), so
 * each replaces its own and every owner's are decluttered together.
 * An item: { key (required), text, position? (world [x,y,z]), ends?: [p, p]
 * (a segment: placed off it when it's short),
 * screen?: { x, y } (port px), className?, data? (data-* attributes), rank?,
 * onPointerDown? }.
 */
export class LabelLayer {
  /** @param {HTMLElement} parent  @param {() => void} [onChange]  a set changed (the viewport redraws) */
  constructor(parent, onChange = null) {
    this.el = document.createElement("div");
    this.el.className = "labels";
    parent.append(this.el);
    this.onChange = onChange;
    this.groups = new Map(); // owner → Map(key → { el, world, ends, screen, rank, item })
  }
  sync(owner, items) {
    const prev = this.groups.get(owner) ?? new Map();
    const next = new Map();
    for (const item of items ?? []) {
      if (item?.key == null || next.has(item.key)) continue;
      let entry = prev.get(item.key);
      if (!entry) {
        const el = document.createElement("div");
        entry = { el, dataKeys: [] };
        this.el.append(el);
      }
      prev.delete(item.key);
      const at = item.position ?? null;
      entry.ends = Array.isArray(item.ends) && item.ends.length === 2 ? item.ends.map(v3) : null;
      entry.world = at ? v3(at) : entry.ends ? entry.ends[0].clone().add(entry.ends[1]).multiplyScalar(0.5) : null;
      entry.screen = item.screen ?? null;
      entry.rank = Number.isFinite(item.rank) ? item.rank : undefined;
      entry.item = item;
      const el = entry.el;
      el.className = `label ${item.className ?? ""}`.trim();
      const text = item.text == null ? "" : String(item.text);
      if (el.textContent !== text) el.textContent = text;
      const data = item.data ?? {};
      for (const k of entry.dataKeys) if (!(k in data)) el.removeAttribute(`data-${k}`);
      for (const [k, v] of Object.entries(data)) {
        if (v == null || v === false) el.removeAttribute(`data-${k}`);
        else el.setAttribute(`data-${k}`, v === true ? "" : String(v));
      }
      entry.dataKeys = Object.keys(data);
      el.onpointerdown = item.onPointerDown
        ? (e) => {
            e.stopPropagation();
            item.onPointerDown(e);
          }
        : null;
      next.set(item.key, entry);
    }
    for (const { el, leader } of prev.values()) {
      el.remove();
      leader?.remove();
    }
    if (next.size) this.groups.set(owner, next);
    else this.groups.delete(owner);
    this.onChange?.();
  }
  /** Remove an owner's labels. */
  clear(owner) {
    if (this.groups.has(owner)) this.sync(owner, []);
  }
  /** Place every label; project(Vector3) → { x, y } port px, or null when it can't be seen. */
  update(project) {
    const placed = [];
    for (const entries of this.groups.values()) {
      for (const entry of entries.values()) {
        const p = entry.screen ?? (entry.world ? project(entry.world) : null);
        if (!p) {
          entry.el.style.display = "none";
          if (entry.leader) entry.leader.style.display = "none";
          entry.p = null;
          continue;
        }
        entry.el.style.display = "";
        let at = p;
        let leader = null;
        if (entry.ends) {
          const pa = project(entry.ends[0]);
          const pb = project(entry.ends[1]);
          if (pa && pb) {
            if (entry.sizeFor !== entry.el.textContent || !entry.w) {
              entry.w = entry.el.offsetWidth;
              entry.h = entry.el.offsetHeight;
              entry.sizeFor = entry.el.textContent;
            }
            const placedAt = placeDimensionLabel(pa, pb, entry.w || 0, entry.h || 0);
            at = { x: placedAt.x, y: placedAt.y };
            leader = placedAt.leader;
          }
        }
        this.drawLeader(entry, leader);
        entry.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
        entry.p = at;
        placed.push(entry);
      }
    }
    declutter(placed);
  }
  drawLeader(entry, l) {
    if (!l) {
      if (entry.leader) entry.leader.style.display = "none";
      return;
    }
    if (!entry.leader) {
      entry.leader = document.createElement("div");
      entry.leader.className = "label-leader";
      this.el.prepend(entry.leader);
    }
    const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
    const ang = Math.atan2(l.y1 - l.y0, l.x1 - l.x0);
    entry.leader.style.display = "";
    entry.leader.style.width = `${len.toFixed(1)}px`;
    entry.leader.style.transform = `translate(${l.x0.toFixed(1)}px, ${l.y0.toFixed(1)}px) rotate(${ang.toFixed(4)}rad)`;
  }
  dispose() {
    this.el.remove();
    this.groups.clear();
  }
}

// ─── vertex snap ────────────────────────────────────────────────────────────

/**
 * The vertex nearest a screen point, in screen space, among `count` vertices
 * of one geometry. Pure, so it can be tested without WebGL.
 *
 * Measuring wants the extreme points of a part (a stem head, a horn tip), and
 * those sit on its silhouette, where a click either misses the mesh by a pixel
 * or lands on a face that doesn't contain them. So the snap looks at every
 * vertex near the cursor, not only the three of the face under it. A vertex
 * further from the eye than `maxDepth` (behind the surface the ray hit) is
 * skipped, so it doesn't snap through a hull to its far side.
 *
 * @param {ArrayLike<number>} array  positions, `stride` floats apart, starting at `offset`
 * @param {ArrayLike<number>} mvp    column-major model → clip matrix
 * @param {ArrayLike<number>} model  column-major model → world matrix
 * @returns {{ index: number, d: number, world: [number, number, number] } | null}
 */
export function nearestScreenVertex(array, { count, stride = 3, offset = 0 }, mvp, model, { width, height, x, y, maxPx, eye, maxDepth = Infinity }) {
  const m = mvp;
  let best = null;
  let bestD = maxPx;
  const maxDepth2 = maxDepth * maxDepth;
  for (let i = 0; i < count; i++) {
    const k = offset + i * stride;
    const px = array[k], py = array[k + 1], pz = array[k + 2];
    const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (!(w > 0)) continue; // behind the camera
    const sx = (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w + 1) / 2) * width;
    const sy = ((1 - (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) / 2) * height;
    const d = Math.hypot(sx - x, sy - y);
    if (!(d <= bestD)) continue;
    const wx = model[0] * px + model[4] * py + model[8] * pz + model[12];
    const wy = model[1] * px + model[5] * py + model[9] * pz + model[13];
    const wz = model[2] * px + model[6] * py + model[10] * pz + model[14];
    if ((wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2 > maxDepth2) continue;
    bestD = d;
    best = { index: i, d, world: [wx, wy, wz] };
  }
  return best;
}

const SHADOW_MAP = 2048;

/**
 * Let every mesh under root cast and receive the sun's shadows (or not). A
 * mesh whose userData (a GLB node's extras) says receiveShadow: false only
 * casts: a one-sided sheet (a sail) can't be biased right from both sides.
 */
function castShadows(root, on) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = on;
    o.receiveShadow = on && o.userData?.receiveShadow !== false;
  });
}

// ─── how near the nearest geometry is ───────────────────────────────────────

/** Meshes up to this many triangles are measured triangle by triangle when they move their own vertices. */
const BRUTE_MAX = 4_000;
const _inv = new Matrix4();
const _inst = new Matrix4();
const _mw = new Matrix4();
const _lp = new Vector3();
const _wb = new Box3();
const _tri = new Triangle();
const _ta = new Vector3();
const _tb = new Vector3();
const _tc = new Vector3();
const _cp = new Vector3();
const _hit = {};
const _walk = [];

/** The smallest stretch a matrix gives any direction (its columns' shortest, for a TRS matrix). */
function minScale(m) {
  const e = m.elements;
  return Math.min(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
}

/** The nearest of a geometry's triangles to local point p, one by one. */
function bruteClosest(g, p) {
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  let best = Infinity;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
    _tri.set(_ta.fromBufferAttribute(pos, a), _tb.fromBufferAttribute(pos, b), _tc.fromBufferAttribute(pos, c));
    _tri.closestPointToPoint(p, _cp);
    const d = _cp.distanceToSquared(p);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * A lower bound on how far world point p is from a geometry drawn with world
 * matrix m: its box's distance when p is outside it, else its nearest
 * triangle's (by BVH, or one by one for a mesh that moves its own vertices,
 * whose box and BVH are stale). null: it can't tell (skinned, morphing, or
 * too big to measure by hand).
 */
function geometryClear(g, m, p, mesh, best = Infinity) {
  if (!g?.attributes?.position) return Infinity;
  const moving = mesh.frustumCulled === false;
  if (mesh.isSkinnedMesh || g.morphAttributes?.position?.length) {
    if (!g.boundingBox) g.computeBoundingBox();
    _wb.copy(g.boundingBox).applyMatrix4(m);
    const d = _wb.expandByVector(_wb.getSize(_ta).multiplyScalar(0.5)).distanceToPoint(p);
    return d > 0 ? d : null;
  }
  if (!moving) {
    if (!g.boundingBox) g.computeBoundingBox();
    const d = _wb.copy(g.boundingBox).applyMatrix4(m).distanceToPoint(p);
    if (d > 0) return d;
  }
  const s = minScale(m);
  if (!(s > 0)) return null;
  _lp.copy(p).applyMatrix4(_inv.copy(m).invert());
  if (!moving && ensureBVH(g)) {
    // nothing within `best` (scaled into its frame) is as good as Infinity
    const hit = g.boundsTree.closestPointToPoint(_lp, _hit, 0, Number.isFinite(best) ? best / s : Infinity);
    return hit ? hit.distance * s : Infinity;
  }
  if (triangleCount(g) <= BRUTE_MAX) return bruteClosest(g, _lp) * s;
  return null;
}

/** A lower bound on how far p is from what's drawn under root, or `best` if that's nearer (null: it can't tell). */
function contentClear(root, p, best) {
  root.updateWorldMatrix(true, true);
  _walk.length = 0;
  _walk.push(root);
  let clear = best;
  while (_walk.length) {
    const o = _walk.pop();
    if (!o.visible) continue;
    if (o.isMesh && o.geometry) {
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, _inst);
          const d = geometryClear(o.geometry, _mw.multiplyMatrices(o.matrixWorld, _inst), p, o, clear);
          if (d == null) return null;
          if (d < clear) clear = d;
        }
      } else {
        const d = geometryClear(o.geometry, o.matrixWorld, p, o, clear);
        if (d == null) return null;
        if (d < clear) clear = d;
      }
    }
    for (const c of o.children) _walk.push(c);
  }
  return clear;
}

/** The object id a node belongs to: the nearest ancestor (or itself) that carries one. */
function objectIdOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData?.objectId) return p.userData.objectId;
  return null;
}

/** Is every node from o up drawn? (Raycasting doesn't look at visibility.) */
function drawn(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export class Viewport {
  /**
   * @param {object} o
   * @param {HTMLElement} o.port       the element the canvas and labels fill (position: relative); port-local px are its
   * @param {HTMLElement} o.themeRoot  element whose CSS variables define colours
   */
  constructor({ port, themeRoot }) {
    this.port = port;
    this.themeRoot = themeRoot;
    this.initState();

    const tc0 = performance.now();
    try {
      // no logarithmic depth: it writes depth from the shader, which turns off
      // the GPU's hidden-surface removal (a close look at a 60-card deck went
      // from 20 to 250 ms a frame on an M4). Precision comes from the near plane (depthRange()).
      this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    } catch (err) {
      this.error = err;
      // no renderer, but still a scene and a camera: extensions that only
      // need the camera's maths (the gizmo) still work, and tests run
      this.initScene();
      return;
    }
    this.ok = true;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = SRGBColorSpace;
    // reset per frame by render(), so the stats are the main pass only
    r.info.autoReset = false;
    this.canvas = r.domElement;
    this.canvas.className = "canvas";
    // under the labels: a positioned element later in the DOM paints over earlier ones
    port.insertBefore(this.canvas, this.labels.el);

    this.initScene();
    this.pmrem = new PMREMGenerator(r);
    // The room is only needed to render the environment map once. Disposed
    // at once: left alive, its materials' programs stay registered with the
    // renderer, and three's shared DFG LUT texture keeps a dispose listener
    // that reaches them, so a closed viewport's renderer (and, through its
    // last render state, the whole scene graph) could never be collected.
    const tc1 = performance.now();
    const room = new RoomEnvironment();
    this.envTexture = this.pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    const tc2 = performance.now();
    this.scene.environment = this.envTexture;
    this.initControls(this.canvas);

    this.readTheme();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(port);
    this.disposers.push(() => ro.disconnect());
    this.disposers.push(onThemeChange(() => this.applyTheme()));
    this.resize();

    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      // dt from the last frame, whatever ran in it; clamped so a backgrounded
      // tab (or a debugger pause) doesn't come back as one enormous step
      const dt = this.lastTick == null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
      this.lastTick = now;
      for (const fn of [...this.loops]) {
        try {
          fn(dt, now);
        } catch (err) {
          console.error("scene: a frame loop failed", err);
        }
      }
      // a ride carries the camera with what it's on, now that the loops have moved it
      this.stepRide();
      // while held, the orbit neither moves the camera nor re-aims it
      const moved = this.holds > 0 ? false : this.controls.update();
      if (moved || this.needsRender || this.loops.size) {
        this.needsRender = false;
        this.render();
      }
    };
    this.raf = requestAnimationFrame(tick);
    /** what building the viewport cost (ms), for probes */
    this.perf.construct = { renderer: +(tc1 - tc0).toFixed(1), environment: +(tc2 - tc1).toFixed(1), total: +(performance.now() - tc0).toFixed(1) };
  }

  /** Everything that doesn't need WebGL or a scene graph. The labels exist even when WebGL doesn't, so syncing them is always safe. */
  initState() {
    /** group id → the ids of the objects in it (at any depth): a group has no node of its own */
    this.groupMembers = new Map();
    this.objects = new Map(); // id → { group, body, content, gen, display, parentId, … } (ensureObject)
    /** objectId → a held local transform, shown instead of the doc's (setPose) */
    this.poses = new Map();
    /** owner → Set of its world-layer groups */
    this.layers = new Map();
    /** owner → Box3 the near plane must not cut (setExtent) */
    this.extents = new Map();
    this.loops = new Set();
    /** the camera's rides (ride(): carried by a moving object) */
    this.rides = createRides();
    this.afterHooks = new Set();
    this.themeListeners = new Set();
    this.cameraWatchers = new Set();
    this.cameraEndListeners = new Set();
    /** live camera limits (limit()) */
    this.limits = new Set();
    /** how many hold() calls are outstanding */
    this.holds = 0;
    /** how far ahead the orbit target was when the camera was taken (or set while held) */
    this.holdDistance = 1;
    /** a holder's own { near, far }, given through setCamera while held */
    this.heldDepth = null;
    this.wasTouched = false;
    this.theme = Object.freeze({ ...DEFAULT_THEME });
    this.disposers = [];
    this.needsRender = true;
    this.depthDirty = true;
    this.depthBox = null;
    this.sceneRadius = 1;
    this.materialRules = [];
    this.materialRulesKey = "[]";
    /** the extensions' atmosphere, cleaned (setAtmosphere); null: the stage's own look */
    this.atmosphere = null;
    this.atmosphereKey = "null";
    /** the sky's mesh, made the first time a sky is asked for */
    this.sky = null;
    /** does the sun cast shadows (objects cast and receive them)? */
    this.shadows = false;
    /** GLB contents prepared but not attached yet (their shaders are compiling) */
    this.compiling = new Set();
    /** the last frame's main pass, from renderer.info */
    this.stats = { calls: 0, triangles: 0, lines: 0, points: 0, geometries: 0, textures: 0, frames: 0 };
    /** slow work, for probes: GLB loads (ms per step) and frames over 16 ms */
    this.perf = { loads: [], slowFrames: [] };
    this.size = { w: 1, h: 1 };
    this.ok = false;
    this.labels = new LabelLayer(this.port, () => this.invalidate());
  }

  /** The scene graph, lights, layers and picking; no renderer needed. */
  initScene() {
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, this.size.w / this.size.h, 0.01, 1000);
    this.camera.position.set(2.5, 2, 3.5);
    this.scene.add(this.camera);
    // Lighting. A key light fixed in the world, high and to one side, is what
    // gives a hull's panels (or any faceted part) different shades as the
    // view turns; a weak headlight fills whatever faces the camera so nothing
    // goes black; a dim sky/ground and environment add a little modelling and
    // something for metals to reflect. The total stays near 1 on a face lit by
    // everything, so light albedos — the baked colourmaps especially — keep
    // their colour instead of clipping to pastel.
    this.hemi = new HemisphereLight(0xffffff, 0x3a3a3a, LIGHTS.hemisphere);
    this.scene.add(this.hemi);
    this.keyLight = new DirectionalLight(0xffffff, LIGHTS.key);
    this.keyLight.position.set(...LIGHTS.keyFrom);
    this.scene.add(this.keyLight);
    this.headlight = new DirectionalLight(0xffffff, LIGHTS.headlight);
    this.headlight.position.set(0.5, 1, 0.8);
    this.camera.add(this.headlight);
    // how much the environment map (made with the renderer) adds
    this.scene.environmentIntensity = LIGHTS.environment;

    this.content = new Group();
    this.content.name = "objects";
    // extensions' world groups, drawn with (and depth-tested against) the objects
    this.widgets = new Group();
    this.widgets.name = "widgets";
    this.scene.add(this.content, this.widgets);

    // The on-top pass: extensions' onTop groups, drawn after the main pass
    // over a cleared depth buffer, so they're depth-tested among themselves
    // but never hidden by an object. Its own light rig, so a lit widget isn't
    // black (the main scene's lights don't reach another scene).
    this.topScene = new Scene();
    this.topScene.name = "on-top";
    this.topScene.add(new HemisphereLight(0xffffff, 0x555555, 1.2));
    const topKey = new DirectionalLight(0xffffff, 1.2);
    topKey.position.set(...LIGHTS.keyFrom);
    this.topScene.add(topKey);

    installLazyBVH();
    this.raycaster = new Raycaster();
    // with a BVH, each mesh reports only its nearest hit; picking wants just that
    this.raycaster.firstHitOnly = true;
    this.bvhQueue = new Set();
    this.bvhTimer = null;
  }

  /** The orbit, on `dom` (the canvas). */
  initControls(dom) {
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.addEventListener("change", () => this.invalidate());
    this.controls.addEventListener("start", () => {
      this.wasTouched = true;
    });
    this.controls.addEventListener("end", () => {
      if (this.holds > 0) return;
      const cam = this.getCamera();
      for (const fn of [...this.cameraEndListeners]) fn(cam);
    });
  }

  invalidate() {
    this.needsRender = true;
  }

  /** Something that changes the scene's extent did: the depth box is recomputed before the next frame. */
  contentChanged() {
    this.depthDirty = true;
    this.invalidate();
  }

  // ─── theme ────────────────────────────────────────────────────────────────

  readTheme() {
    const next = {};
    for (const [k, v] of Object.entries(THEME_VARS)) next[k] = resolveCssColor(this.themeRoot, v, DEFAULT_THEME[k]);
    // a new object per read, so whoever keeps it can tell that it changed
    this.theme = Object.freeze(next);
    this.renderer?.setClearColor(this.clearColor(), 1);
  }

  /** What shows where nothing is drawn: the theme's background, or fog's colour when there's fog and no sky. */
  clearColor() {
    const a = this.atmosphere;
    return a?.fog && !a.sky ? new Color(a.fog.color) : color(this.theme.bg);
  }

  applyTheme() {
    if (!this.ok) return;
    this.readTheme();
    if (this.placeholderMaterial) this.placeholderMaterial.color.copy(color(this.theme.muted));
    for (const [id, entry] of this.objects) if (entry.display) this.applyDisplay(id, entry.display, entry.parentId, entry.inherited);
    this.invalidate();
    for (const fn of [...this.themeListeners]) fn(this.theme);
  }

  /** Call fn(theme) whenever the colour tokens change. @returns {() => void} off */
  onTheme(fn) {
    this.themeListeners.add(fn);
    return () => this.themeListeners.delete(fn);
  }

  // ─── layout and drawing ───────────────────────────────────────────────────

  resize() {
    if (!this.ok) return;
    const w = Math.max(1, this.port.clientWidth);
    const h = Math.max(1, this.port.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
    // Resizing clears the drawing buffer; draw now, before the browser paints,
    // rather than show a blank (or stretched) frame until the next tick.
    this.needsRender = false;
    this.render();
  }

  /** How far ahead of the camera the orbit is looking (while held: how far it was). */
  focusDistance() {
    if (this.holds > 0) return this.holdDistance;
    return this.camera.position.distanceTo(this.controls.target);
  }

  /**
   * The depth box: what the near plane must not cut. Recomputed only when
   * content, display or an extent changed, with each object's own world box
   * (nearestClear measures from those) and, with shadows, a redraw of the map.
   */
  updateDepth() {
    this.depthDirty = false;
    const box = new Box3();
    /** [entry, its world box with room for a piece lifted off it] per shown object */
    this.nearList = [];
    /** the objects' world boxes, as { min, max }, for the shadow frame */
    this.fitBoxes = [];
    for (const [id, e] of this.objects) {
      if (e.kind === "group") continue;
      const b = this.objectBox(id);
      if (!b) continue;
      box.union(b);
      this.fitBoxes.push({ min: b.min.toArray(), max: b.max.toArray() });
      const r = b.getBoundingSphere(new Sphere()).radius;
      this.nearList.push([e, b.expandByScalar(Math.max(0.05, r * 0.05))]);
    }
    // room around the objects for a piece lifted off them (a carried card floats)
    const radius = box.isEmpty() ? 0 : box.getBoundingSphere(new Sphere()).radius;
    const depth = box.isEmpty() ? new Box3() : box.clone().expandByScalar(Math.max(0.05, radius * 0.05));
    const all = box.clone();
    for (const b of this.extents.values()) {
      depth.union(b);
      all.union(b);
    }
    this.depthBox = depth.isEmpty() ? null : depth;
    this.sceneRadius = all.isEmpty() ? 1 : Math.max(all.getBoundingSphere(new Sphere()).radius, 1e-4);
    if (this.shadows && this.renderer) this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * How near the nearest geometry is to world point p: { clear, known }.
   * clear is a lower bound: the nearest object box's distance, and for a box
   * p is inside, the distance to that object's triangles (its BVH, built on
   * the way). known is false when p is inside something that can't be
   * measured (a skinned mesh, a box still loading, an extent).
   */
  nearestClear(p) {
    if (this.depthDirty) this.updateDepth();
    let clear = Infinity;
    for (const b of this.extents.values()) {
      const d = b.distanceToPoint(p);
      if (d === 0) return { clear: 0, known: false };
      if (d < clear) clear = d;
    }
    const inside = [];
    for (const [entry, b] of this.nearList ?? []) {
      const d = b.distanceToPoint(p);
      if (d > 0) clear = Math.min(clear, d);
      else inside.push(entry);
    }
    for (const entry of inside) {
      if (!entry.content) return { clear: 0, known: false };
      const d = contentClear(entry.content, p, clear);
      if (d == null) return { clear: 0, known: false };
      clear = d;
    }
    return Number.isFinite(clear) ? { clear, known: true } : { clear: 0, known: false };
  }

  render() {
    if (!this.ok) return;
    const tStart = performance.now();
    const r = this.renderer;
    if (this.depthDirty) this.updateDepth();
    const held = this.holds > 0 ? this.heldDepth : null;
    const { clear, known } = held?.near != null ? { clear: 0, known: false } : this.nearestClear(this.camera.position);
    const { near, far } = depthRange({ dist: this.focusDistance(), radius: this.sceneRadius, clear, known, held });
    if (this.shadows) this.fitSun();
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }

    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.w, this.size.h);
    r.autoClear = true;
    r.info.reset();
    r.render(this.scene, this.camera);
    const info = r.info;
    this.stats = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      frames: this.stats.frames + 1,
    };

    if (this.topScene.children.some((c) => c.userData?.owner !== undefined && c.visible)) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.topScene, this.camera);
      r.autoClear = true;
    }
    const size = { ...this.size };
    for (const fn of [...this.afterHooks]) {
      try {
        fn(r, size);
      } catch (err) {
        console.error("scene: an afterRender hook failed", err);
      }
      // whatever it did to the renderer's state, the next one (and the next frame) starts clean
      r.setScissorTest(false);
      r.setViewport(0, 0, this.size.w, this.size.h);
      r.autoClear = true;
    }
    this.labels.update((w) => this.screenOf(w));
    const ms = performance.now() - tStart;
    if (ms > 16 && this.perf.slowFrames.length < 500) this.perf.slowFrames.push({ at: +tStart.toFixed(1), ms: +ms.toFixed(1), calls: this.stats.calls });
  }

  // ─── atmosphere ───────────────────────────────────────────────────────────

  /**
   * The extensions' atmosphere, merged by the stage (STAGE.md, "Atmosphere"):
   * a sky, fog, a sun and exposure. null (or nothing usable) is the stage's
   * own look, exactly: no sky, no fog, the key light, no shadows. Only a
   * change does anything.
   */
  setAtmosphere(atm) {
    const next = cleanAtmosphere(atm);
    const key = JSON.stringify(next);
    if (key === this.atmosphereKey) return;
    this.atmosphereKey = key;
    this.atmosphere = next;
    if (!this.scene) return;
    const l = lighting(next);
    this.hemi.intensity = l.hemisphere.intensity;
    this.hemi.color.set(l.hemisphere.sky);
    this.hemi.groundColor.set(l.hemisphere.ground);
    this.keyLight.intensity = l.key.intensity;
    this.keyLight.color.set(l.key.color);
    this.keyLight.position.set(...l.key.from);
    this.keyLight.target.position.set(0, 0, 0);
    this.keyLight.target.updateMatrixWorld();
    this.headlight.intensity = l.headlight;
    this.scene.environmentIntensity = l.environment;
    // one Fog, kept while there is fog: replacing it would recompile every material
    if (!next?.fog) this.scene.fog = null;
    else if (this.scene.fog) {
      this.scene.fog.color.set(next.fog.color);
      this.scene.fog.near = next.fog.near;
      this.scene.fog.far = next.fog.far;
    } else this.scene.fog = new Fog(next.fog.color, next.fog.near, next.fog.far);
    this.setSky(next?.sky ?? null, next?.sun ?? null);
    this.setShadows(l.key.shadows);
    // a new sun direction needs a new frame
    this.sunKey = null;
    this.renderer?.setClearColor(this.clearColor(), 1);
    // the sun's shadow frame is fitted with the depth box
    this.contentChanged();
  }

  setSky(sky, sun) {
    if (!sky) {
      if (this.sky) this.sky.visible = false;
      return;
    }
    if (!this.sky) {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      const material = new ShaderMaterial({
        name: "sky",
        uniforms: {
          top: { value: new Color() },
          horizon: { value: new Color() },
          bottom: { value: new Color() },
          sunDir: { value: new Vector3(0, 1, 0) },
          sunColor: { value: new Color() },
          sunOn: { value: 0 },
        },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      this.sky = new Mesh(g, material);
      this.sky.name = "sky";
      this.sky.frustumCulled = false;
      this.sky.renderOrder = -1e9; // before everything
      this.sky.userData.noPick = true;
      this.sky.raycast = () => {};
      this.scene.add(this.sky);
    }
    const u = this.sky.material.uniforms;
    u.top.value.set(sky.top);
    u.horizon.value.set(sky.horizon);
    u.bottom.value.set(sky.bottom);
    u.sunOn.value = sun ? 1 : 0;
    if (sun) {
      u.sunDir.value.set(...sun.direction);
      u.sunColor.value.set(sun.color);
    }
    this.sky.visible = true;
  }

  /** Turn the sun's shadows on or off: the light, the renderer's shadow map, and every object casting and receiving. */
  setShadows(on) {
    if (this.shadows === on) return;
    this.shadows = on;
    this.keyLight.castShadow = on;
    this.sunKey = null;
    if (on) this.keyLight.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    if (this.renderer) {
      this.renderer.shadowMap.enabled = on;
      // drawn again only when something moves or the frame does, not every frame
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
    }
    for (const e of this.objects.values()) if (e.content) castShadows(e.content, on);
  }

  /** What the shadow frame is fitted about: the orbit's target, or the held camera. */
  shadowFocusPoint() {
    return this.holds > 0 || !this.controls ? this.camera.position.toArray() : this.controls.target.toArray();
  }

  /**
   * Stand the sun where its shadow map covers what's being looked at
   * (shadowFocus about shadowFocusPoint, its radius on the ladder, its
   * centre on whole texels: shadowFrame). The frame changes, and the map is
   * redrawn for it, only when that lands somewhere new; a radius is kept
   * until what's needed outgrows it or shrinks under 60% of it.
   */
  fitSun() {
    if (!this.atmosphere?.sun) return;
    if (this.depthDirty) this.updateDepth();
    const need = shadowFocus(this.fitBoxes ?? [], this.shadowFocusPoint());
    if (!need) return;
    const kept = this.sunFrame?.radius;
    const radius = kept && need.radius <= kept && need.radius > kept * 0.6 ? kept : Math.min(ladderRadius(need.radius), Math.max(SHADOW_CAP, need.radius));
    const f = shadowFrame({ center: need.center, radius }, this.atmosphere.sun.direction, SHADOW_MAP);
    const key = `${f.radius}|${f.target.map((v) => Math.round(v / f.texel)).join(",")}`;
    if (key === this.sunKey) return;
    this.sunKey = key;
    this.sunFrame = f;
    this.keyLight.position.set(...f.position);
    this.keyLight.target.position.set(...f.target);
    this.keyLight.target.updateMatrixWorld();
    const cam = this.keyLight.shadow.camera;
    cam.left = cam.bottom = -f.radius;
    cam.right = cam.top = f.radius;
    cam.near = f.near;
    cam.far = f.far;
    cam.updateProjectionMatrix();
    this.keyLight.shadow.bias = f.bias;
    this.keyLight.shadow.normalBias = f.normalBias;
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Run fn(dt, now) before every frame; while any loop is live every frame
   * renders. `first` runs it before every other loop (the stage's own, which
   * moves what's drawn before anything reads it that frame).
   * @returns {() => void} off
   */
  addLoop(fn, { first = false } = {}) {
    if (first) this.loops = new Set([fn, ...this.loops]);
    else this.loops.add(fn);
    this.invalidate();
    return () => this.loops.delete(fn);
  }

  /** Call fn(renderer, size) after the main and on-top passes of every frame drawn. @returns {() => void} off */
  afterRender(fn) {
    this.afterHooks.add(fn);
    this.invalidate();
    return () => {
      if (this.afterHooks.delete(fn)) this.invalidate();
    };
  }

  /** A box (world { min, max } or Box3) the near plane must not cut, for this owner; null removes it. */
  setExtent(owner, box) {
    const b = toBox3(box);
    if (b && !b.isEmpty()) this.extents.set(owner, b.clone());
    else if (!this.extents.delete(owner)) return;
    this.contentChanged();
  }

  // ─── widget layers ────────────────────────────────────────────────────────

  /**
   * A new world-space group for `owner` to draw in. Its meshes are widgets:
   * pickWidget finds them (not subtrees with userData.noPick, not hidden
   * ones). onTop groups are drawn in a second pass over everything.
   * @returns {Group}
   */
  worldLayer(owner, { onTop = false } = {}) {
    const g = new Group();
    g.name = `layer:${owner}`;
    g.userData.owner = owner;
    g.userData.onTop = !!onTop;
    if (this.ok) (onTop ? this.topScene : this.widgets).add(g);
    let set = this.layers.get(owner);
    if (!set) this.layers.set(owner, (set = new Set()));
    set.add(g);
    this.invalidate();
    return g;
  }

  /** Remove and dispose every world group this owner made (geometry, materials, textures). */
  removeLayers(owner) {
    const set = this.layers.get(owner);
    if (!set) return;
    this.layers.delete(owner);
    for (const g of set) {
      g.removeFromParent();
      disposeObject(g);
    }
    this.invalidate();
  }

  /**
   * The widget under a port-local point: the nearest mesh in any world group
   * whose ray hit counts. An onTop widget beats any other, whatever the
   * distances. `userData` merges the hit mesh's and its ancestors' up to the
   * layer (nearer wins), so data can sit on the mesh or on a group above it.
   * @returns {{ owner, onTop: boolean, distance: number, point: number[], object, userData: object } | null}
   */
  pickWidget(x, y) {
    if (!this.ok) return null;
    const meshes = [];
    const collect = (o) => {
      if (!o.visible || o.userData?.noPick) return;
      if (o.isMesh) meshes.push(o);
      for (const c of o.children) collect(c);
    };
    for (const set of this.layers.values()) for (const g of set) collect(g);
    if (!meshes.length) return null;
    // a widget moved since the last frame is picked where it is now
    this.widgets.updateMatrixWorld();
    this.topScene.updateMatrixWorld();
    this.rayFrom(x, y);
    let best = null;
    for (const h of this.raycaster.intersectObjects(meshes, false)) {
      let layer = h.object;
      const chain = [];
      while (layer && layer.userData?.owner === undefined) {
        chain.push(layer);
        layer = layer.parent;
      }
      if (!layer || !drawn(layer)) continue;
      const onTop = !!layer.userData.onTop;
      if (best && (best.onTop || !onTop)) continue; // hits come nearest first
      const userData = {};
      for (let i = chain.length - 1; i >= 0; i--) Object.assign(userData, chain[i].userData);
      best = { owner: layer.userData.owner, onTop, distance: h.distance, point: h.point.toArray(), object: h.object, userData };
      if (onTop) break;
    }
    return best;
  }

  // ─── objects ──────────────────────────────────────────────────────────────

  // Each object is two nodes. `group` carries its transform, relative to its
  // parent's group, so attached objects follow their parent. It holds `body`
  // — the GLB, and the object's visibility — and the groups of any objects
  // attached to it. Hiding an object hides its body only, so its attachments
  // stay visible; hiding a GROUP object (kind "group", no geometry) hides its
  // whole `group` node, so everything below it goes too. Boxes, picking and
  // snapping look at bodies, so they never count a child's geometry as the
  // parent's.
  ensureObject(id) {
    let entry = this.objects.get(id);
    if (!entry) {
      const group = new Group();
      group.userData.objectId = id;
      group.name = id;
      const body = new Group();
      body.userData.objectId = id;
      body.name = `${id}:body`;
      group.add(body);
      this.content.add(group);
      entry = {
        group,
        body,
        content: null,
        gen: 0,
        display: null,
        parentId: null,
        kind: "object",
        inherited: { visible: true, opacity: 1 },
        materials: [],
        extras: null, // contentExtras() of its GLB
        box: null, // content's box in body space, cached per GLB
        parts: [], // its pieces' boxes, for a rotated body (see objectBox)
        hint: null, // a Box3 from hint.bounds, shown (and framed) until the GLB arrives
        placeholder: null,
        stats: null,
      };
      this.objects.set(id, entry);
      const pose = this.poses.get(id);
      if (pose) placeLocal(group, pose);
    }
    return entry;
  }

  /** Put an object's group under its parent's (null = the scene root). */
  setParent(id, parentId) {
    const entry = this.objects.get(id);
    if (!entry) return;
    let target = this.content;
    if (parentId && parentId !== id) {
      const p = this.ensureObject(parentId).group;
      // never make a loop in the scene graph, whatever the caller says
      let loops = false;
      for (let o = p; o; o = o.parent) if (o === entry.group) loops = true;
      if (!loops) target = p;
    }
    if (entry.group.parent !== target) target.add(entry.group);
  }

  removeObject(id) {
    const entry = this.objects.get(id);
    if (!entry) return;
    this.poses.delete(id);
    entry.gen++;
    // Attached objects outlive their parent: move them to the root (the scene
    // doc gives them their new transforms).
    for (const child of [...entry.group.children]) if (child !== entry.body) this.content.add(child);
    this.removePlaceholder(entry);
    disposeObject(entry.body);
    entry.group.removeFromParent();
    this.objects.delete(id);
    this.contentChanged();
  }

  hasContent(id) {
    return !!this.objects.get(id)?.content;
  }

  /**
   * What the stage knows of an object's content. box is in body space (the
   * GLB's own frame): the content's, or its hint's until the GLB arrives.
   * extras (contentExtras) and stats are null until then. root is the
   * three.js content node, for geometry queries in this package: read it,
   * never change it.
   * @returns {{ loaded: boolean, box: { min: number[], max: number[] } | null, extras: object | null, stats: object | null, root: object | null } | null}
   */
  contentOf(id) {
    const e = this.objects.get(id);
    if (!e) return null;
    const b = e.content ? e.box : e.hint;
    return {
      loaded: !!e.content,
      box: b && !b.isEmpty() ? { min: b.min.toArray(), max: b.max.toArray() } : null,
      extras: e.content ? e.extras : null,
      stats: e.content ? e.stats : null,
      root: e.content ?? null,
    };
  }

  /**
   * Where an object will be, before its GLB arrives: hint.bounds in its own
   * frame (min/max arrays), drawn as a faint box and used by frame. null clears.
   */
  setHint(id, bounds) {
    if (!this.ok) return;
    const entry = this.ensureObject(id);
    const ok = bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max) && [...bounds.min, ...bounds.max].every((v) => Number.isFinite(Number(v)));
    const box = ok ? new Box3(v3(bounds.min.map(Number)), v3(bounds.max.map(Number))) : null;
    if (box && box.isEmpty()) {
      entry.hint = null;
    } else if (!!box !== !!entry.hint || (box && !box.equals(entry.hint))) {
      entry.hint = box;
    } else return;
    if (entry.content || !entry.hint) this.removePlaceholder(entry);
    else this.showPlaceholder(entry);
    this.contentChanged();
  }

  showPlaceholder(entry) {
    if (!this.placeholderGeometry) {
      this.placeholderGeometry = lineGeometry(UNIT_BOX_EDGES);
      this.placeholderMaterial = new LineBasicMaterial({ color: color(this.theme.muted), transparent: true, opacity: 0.35, depthWrite: false });
    }
    let ph = entry.placeholder;
    if (!ph) {
      ph = new LineSegments(this.placeholderGeometry, this.placeholderMaterial);
      ph.name = "placeholder";
      ph.userData.shared = true;
      ph.raycast = () => {};
      entry.placeholder = ph;
      entry.body.add(ph);
    }
    const c = entry.hint.getCenter(new Vector3());
    const size = entry.hint.getSize(new Vector3()).max(new Vector3(1e-4, 1e-4, 1e-4));
    ph.position.copy(c);
    ph.scale.copy(size);
    this.invalidate();
  }

  removePlaceholder(entry) {
    if (!entry.placeholder) return;
    entry.placeholder.removeFromParent();
    entry.placeholder = null;
    this.invalidate();
  }

  /** Swap in a new GLB. The old mesh stays until the new one has parsed. */
  async setGLB(id, bytes) {
    if (!this.ok) return;
    const entry = this.ensureObject(id);
    const gen = ++entry.gen;
    const stale = () => entry.gen !== gen || this.objects.get(id) !== entry || !this.ok;
    const t0 = performance.now();
    const prepared = await prepareGLB(bytes);
    const t1 = performance.now();
    if (stale()) {
      disposeObject(prepared.content);
      return;
    }
    applyMaterialRules(prepared.materials, this.materialRules);
    // Compile its shaders before it's drawn, off the main thread where the
    // browser can (KHR_parallel_shader_compile), so a new material doesn't
    // stall the first frame it appears in. While it waits it's in
    // `compiling`: if the viewport is disposed meanwhile, dispose() releases
    // it while the renderer can still let go of its programs (after
    // renderer.dispose() nothing can, and they'd keep the renderer and the
    // whole scene graph alive).
    this.compiling.add(prepared.content);
    try {
      await this.renderer.compileAsync?.(prepared.content, this.camera, this.scene);
    } catch {
      // it compiles on first draw instead
    }
    const t2 = performance.now();
    const mine = this.compiling.delete(prepared.content);
    if (stale()) {
      if (mine) disposeObject(prepared.content);
      return;
    }
    if (entry.content) {
      entry.content.removeFromParent();
      disposeObject(entry.content);
    }
    entry.content = prepared.content;
    entry.materials = prepared.materials;
    entry.extras = contentExtras(prepared);
    entry.box = prepared.box;
    entry.parts = prepared.parts ?? [];
    entry.stats = prepared.stats;
    this.removePlaceholder(entry);
    entry.body.add(prepared.content);
    if (this.shadows) castShadows(prepared.content, true);
    this.queueBVH(prepared.content);
    this.applyMaterials(entry);
    this.contentChanged();
    if (this.perf.loads.length < 1000) this.perf.loads.push({ id, prepareMs: +(t1 - t0).toFixed(1), compileMs: +(t2 - t1).toFixed(1), attachMs: +(performance.now() - t2).toFixed(1), triangles: prepared.stats.triangles });
  }

  /** Build the pick BVHs of a new GLB's big meshes in idle time (a pick builds any it still lacks). */
  queueBVH(root) {
    root.traverse((o) => {
      if (o.isMesh && wantsBVH(o.geometry)) this.bvhQueue.add(o.geometry);
    });
    this.scheduleBVH();
  }

  scheduleBVH() {
    if (this.bvhTimer != null || !this.bvhQueue.size || !this.ok) return;
    const idle = globalThis.requestIdleCallback
      ? (f) => ({ cancel: globalThis.cancelIdleCallback.bind(globalThis), id: globalThis.requestIdleCallback(f, { timeout: 3000 }) })
      : (f) => ({ cancel: clearTimeout, id: setTimeout(() => f({ timeRemaining: () => 10 }), 100) });
    this.bvhTimer = idle((deadline) => {
      this.bvhTimer = null;
      if (!this.ok) return;
      for (const g of this.bvhQueue) {
        this.bvhQueue.delete(g);
        buildBVH(g);
        if (deadline.timeRemaining() < 12) break;
      }
      this.scheduleBVH();
    });
  }

  /**
   * The scene's material rules (SCENE-CONTRACT v3 §9), applied to every
   * loaded material now and to every GLB that loads later.
   */
  setMaterialRules(rules) {
    const clean = sanitizeRules(rules);
    const key = rulesKey(clean);
    if (key === this.materialRulesKey) return;
    this.materialRules = clean;
    this.materialRulesKey = key;
    if (!this.ok) return;
    for (const entry of this.objects.values()) {
      if (!entry.materials.length) continue;
      applyMaterialRules(entry.materials, clean);
      this.applyMaterials(entry);
    }
    this.invalidate();
  }

  /**
   * Display state from the scene doc: visible, colour, opacity, wireframe,
   * transform (relative to `parentId`'s, which the caller has already checked
   * for cycles — see hierarchy.js). `inherited` is what its group ancestors
   * contribute (groups.js inheritedDisplay): their opacity multiplies in.
   * A held pose (setPose) wins over the doc's transform until it's let go.
   */
  applyDisplay(id, obj, parentId = null, inherited = null) {
    if (!this.ok) return;
    const entry = this.ensureObject(id);
    entry.display = obj;
    entry.parentId = parentId ?? null;
    entry.inherited = inherited ?? { visible: true, opacity: 1 };
    entry.kind = obj?.kind === "group" ? "group" : "object";
    this.setParent(id, parentId);
    const g = entry.group;
    if (entry.kind === "group") {
      g.visible = obj.visible !== false;
      entry.body.visible = true;
    } else {
      g.visible = true;
      // a group hides what's filed in it (it has no node above it to do so)
      entry.body.visible = obj?.visible !== false && entry.inherited.visible !== false;
    }
    placeLocal(g, this.poses.get(id) ?? obj?.transform ?? {});
    this.applyMaterials(entry);
    this.contentChanged();
  }

  /** Colour / opacity / wireframe onto an object's materials, over their (rule-adjusted) base values. */
  applyMaterials(entry) {
    const obj = entry.display;
    if (!obj || entry.kind === "group" || !entry.materials.length) return;
    const opacity = clamp01(obj.opacity ?? 1) * clamp01(entry.inherited?.opacity ?? 1);
    const override = obj.color ? new Color(obj.color) : null;
    const themeColor = color(this.theme.object);
    for (const m of entry.materials) {
      if (m.color) {
        if (override) m.color.copy(override);
        else if (m.userData.useThemeColor) m.color.copy(themeColor);
        else if (m.userData.baseColor) m.color.copy(m.userData.baseColor);
      }
      const base = m.userData.baseOpacity ?? 1;
      const transparent = !!m.userData.baseTransparent || base * opacity < 1;
      const wireframe = "wireframe" in m && m.userData.onMesh ? !!obj.wireframe : m.wireframe;
      if (m.transparent !== transparent || m.wireframe !== wireframe) m.needsUpdate = true;
      m.opacity = base * opacity;
      m.transparent = transparent;
      m.depthWrite = m.opacity >= 1;
      if (wireframe !== undefined) m.wireframe = wireframe;
    }
  }

  // ─── poses ────────────────────────────────────────────────────────────────

  /**
   * Show an object at a local transform ({ position, rotation, scale }, as
   * the doc stores it, under its current parent) instead of the doc's, until
   * it's set to null, which puts the doc's back.
   */
  setPose(id, transform) {
    if (transform) this.poses.set(id, transform);
    else if (!this.poses.delete(id)) return;
    const entry = this.objects.get(id);
    if (!this.ok || !entry) return;
    placeLocal(entry.group, transform ?? entry.display?.transform ?? {});
    this.contentChanged();
  }

  /** An object's displayed world matrix (held poses included): 16 numbers, column-major; null if it isn't here. */
  worldOf(id) {
    const entry = this.objects.get(id);
    if (!this.ok || !entry) return null;
    entry.group.updateWorldMatrix(true, false);
    return Array.from(entry.group.matrixWorld.elements);
  }

  // ─── visibility and boxes ─────────────────────────────────────────────────

  /** Is this object drawn: its body and every node above it visible (groups hide their subtree)? Takes an id or an entry. */
  isShown(entry) {
    if (typeof entry === "string") entry = this.objects.get(entry);
    if (!entry || !entry.body.visible) return false;
    for (let o = entry.group; o && o !== this.content; o = o.parent) if (!o.visible) return false;
    return true;
  }

  /**
   * An object's own geometry (not its attachments'), boxed in world space; its
   * hint box while the GLB is still on its way (unless hints: false). For a
   * group, the union of its shown descendants' boxes.
   */
  objectBox(id, { hints = true } = {}) {
    if (this.groupMembers.has(id)) return this.groupBox(id, { hints });
    const entry = this.objects.get(id);
    if (!entry) return null;
    if (entry.kind === "group") return null;
    if (!this.isShown(entry)) return null;
    const local = entry.content ? entry.box : hints ? entry.hint : null;
    if (!local) return null;
    entry.body.updateWorldMatrix(true, false);
    const world = entry.body.matrixWorld;
    // Only an axis-aligned (unrotated) world matrix maps the cached box
    // exactly; under a rotation, box each piece under its own matrix, as
    // three's setFromObject does, so the bounds don't grow with the angle.
    if (entry.content && entry.parts?.length && hasRotation(world)) {
      const box = new Box3();
      const m = new Matrix4();
      const b = new Box3();
      for (const p of entry.parts) box.union(b.copy(p.box).applyMatrix4(m.multiplyMatrices(world, p.matrix)));
      return box.isEmpty() ? null : box;
    }
    const box = local.clone().applyMatrix4(world);
    return box.isEmpty() ? null : box;
  }

  /** A group's box: the union of what's shown of what's in it. */
  groupBox(gid, { hints = true } = {}) {
    const box = new Box3();
    for (const id of this.groupMembers.get(gid) ?? []) {
      const b = this.objectBox(id, { hints });
      if (b) box.union(b);
    }
    return box.isEmpty() ? null : box;
  }

  /** Who is in each group (group id → object ids, at any depth). */
  setGroups(members) {
    const next = new Map([...members].map(([g, ids]) => [g, [...ids]]));
    const same = next.size === this.groupMembers.size && [...next].every(([g, ids]) => {
      const was = this.groupMembers.get(g);
      return was && was.length === ids.length && was.every((x, i) => x === ids[i]);
    });
    if (same) return;
    this.groupMembers = next;
    this.invalidate();
  }

  /** The union of every shown object's box (an empty Box3 when nothing is shown). */
  sceneBox({ hints = true } = {}) {
    const box = new Box3();
    for (const [id, e] of this.objects) {
      if (e.kind === "group") continue;
      const b = this.objectBox(id, { hints });
      if (b) box.union(b);
    }
    return box;
  }

  // ─── camera ───────────────────────────────────────────────────────────────

  /** The camera's forward direction, unit, world. */
  forward() {
    return this.camera.getWorldDirection(new Vector3());
  }

  /** @returns {{ position: number[], target: number[], fov: number } | null} (while held, target is straight ahead) */
  getCamera() {
    if (!this.ok) return null;
    const position = this.camera.position.toArray();
    const target = this.holds > 0 ? reseatTarget(position, this.forward().toArray(), this.holdDistance) : this.controls.target.toArray();
    return { position, target, fov: this.camera.fov };
  }

  /**
   * Move the camera. Every field is optional. While the orbit has it, the
   * camera always looks at its target: a quaternion without a target moves
   * the target in front of it. While held, it goes exactly where it's put
   * (quaternion, else looking at target), and near / far given here replace
   * the automatic ones until the last release.
   * @param {{ position?, target?, quaternion?: number[] | Quaternion, fov?: number, near?: number, far?: number }} cam
   */
  setCamera(cam) {
    if (!this.ok || !cam) return;
    const camera = this.camera;
    if (cam.position) camera.position.copy(v3(cam.position));
    const fov = Number(cam.fov);
    let fovChanged = false;
    if (cam.fov != null && Number.isFinite(fov) && fov !== camera.fov) {
      camera.fov = Math.min(179, Math.max(1, fov));
      camera.updateProjectionMatrix();
      fovChanged = true;
    }
    const q = cam.quaternion ? (Array.isArray(cam.quaternion) ? cam.quaternion.map(Number) : [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w]) : null;
    const quat = q && q.length === 4 && q.every(Number.isFinite) ? q : null;
    const target = cam.target ? v3(cam.target) : null;
    if (this.holds > 0) {
      const near = Number(cam.near);
      const far = Number(cam.far);
      if (cam.near != null && near > 0) this.heldDepth = { ...this.heldDepth, near };
      if (cam.far != null && far > 0) this.heldDepth = { ...this.heldDepth, far };
      if (quat) camera.quaternion.fromArray(quat).normalize();
      else if (target) camera.lookAt(target);
      if (target) this.holdDistance = Math.max(camera.position.distanceTo(target), 1e-6);
      camera.updateMatrixWorld();
    } else {
      if (target) this.controls.target.copy(target);
      else if (quat) {
        const dist = Math.max(camera.position.distanceTo(this.controls.target), 1e-6);
        camera.quaternion.fromArray(quat).normalize();
        this.controls.target.fromArray(reseatTarget(camera.position.toArray(), this.forward().toArray(), dist));
      }
      resetOrbitMotion(this.controls);
      this.controls.update();
    }
    this.invalidate();
    if (fovChanged) for (const fn of [...this.cameraWatchers]) fn(this.getCamera());
  }

  /** Look at a box ({ min, max } or Box3; a 1 m cube on the ground if it's empty) from the current direction. */
  frame(box) {
    if (!this.ok) return;
    let b = toBox3(box);
    if (!b || b.isEmpty()) b = new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
    const sphere = b.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 1e-4);
    const fov = (this.camera.fov * Math.PI) / 180;
    const fit = radius / Math.sin(Math.min(fov, fov * this.camera.aspect) / 2);
    let dir = this.holds > 0 ? this.forward().negate() : this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) dir = new Vector3(1, 0.8, 1.4);
    dir.normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, fit * 1.1);
    if (this.holds > 0) {
      this.camera.lookAt(sphere.center);
      this.camera.updateMatrixWorld();
      this.holdDistance = fit * 1.1;
    } else {
      this.controls.target.copy(sphere.center);
      resetOrbitMotion(this.controls);
      this.controls.update();
    }
    this.invalidate();
  }

  /**
   * Take the camera from the orbit. While anything holds it the orbit is off
   * and not updated, and onCameraEnd doesn't fire. The last release puts the
   * orbit target straight ahead, as far as it was, so orbiting resumes about
   * what's in front of the camera, without any motion left over from before.
   * @returns {() => void} release (calling it again does nothing)
   */
  hold() {
    if (!this.ok) return () => {};
    if (this.holds++ === 0) {
      this.holdDistance = Math.max(this.camera.position.distanceTo(this.controls.target), 1e-6);
      this.heldDepth = null;
      resetOrbitMotion(this.controls);
      this.controls.enabled = false;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  release() {
    if (this.holds <= 0 || --this.holds > 0 || !this.ok) return;
    this.heldDepth = null;
    this.controls.target.fromArray(reseatTarget(this.camera.position.toArray(), this.forward().toArray(), this.holdDistance));
    resetOrbitMotion(this.controls);
    this.controls.enabled = true;
    this.controls.update();
    this.invalidate();
  }

  /**
   * Carry the orbit camera with object `id` as it moves (./ride.js): each
   * frame, after the loops, the camera and its target move by the shift of
   * its point `at` (its frame; its origin), its turn about the vertical
   * (`turn`) and its rise (`rise`). The latest
   * ride that isn't a `fallback` applies, else the latest fallback; while
   * the camera is held, none moves it.
   * @param {string} id  @param {{ turn?: boolean, rise?: boolean, fallback?: boolean, at?: number[] }} [opts]
   * @returns {() => void} off
   */
  ride(id, opts) {
    // from where it's drawn now: a view set from it this frame is followed from this frame
    const off = this.rides.add(id, opts, this.ok ? this.worldOf(id) : null);
    this.invalidate();
    return off;
  }

  /** The ride that applies now: { id, fallback }, or null. */
  riding() {
    const r = this.rides.current();
    return r ? { id: r.id, fallback: r.fallback } : null;
  }

  /** One frame of the ride that applies (the frame loop's, after the loops). */
  stepRide() {
    if (!this.ok || !this.controls) return;
    const out = this.rides.step({
      worldOf: (id) => this.worldOf(id),
      held: this.holds > 0,
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
    });
    if (!out) return;
    this.camera.position.fromArray(out.position);
    this.controls.target.fromArray(out.target);
    this.needsRender = true;
  }

  /** Is the camera held? */
  get held() {
    return this.holds > 0;
  }

  /**
   * Limit the orbit ({ minPolar, maxPolar } radians from +Y, { minDistance,
   * maxDistance } from the target). Every live limit applies at once.
   * @returns {() => void} off
   */
  limit(spec) {
    const s = { ...spec };
    this.limits.add(s);
    this.applyLimits();
    return () => {
      if (this.limits.delete(s)) this.applyLimits();
    };
  }

  applyLimits() {
    if (!this.controls) return;
    const l = intersectLimits(this.limits);
    const c = this.controls;
    c.minPolarAngle = l.minPolar;
    c.maxPolarAngle = l.maxPolar;
    c.minDistance = l.minDistance;
    c.maxDistance = l.maxDistance;
    // into the new limits now (the orbit clamps on update), unless someone else has the camera
    if (this.holds === 0 && this.ok) c.update();
    this.invalidate();
  }

  /** Call fn(camera) when setCamera changes the projection (its fov). @returns {() => void} off */
  watchCamera(fn) {
    this.cameraWatchers.add(fn);
    return () => this.cameraWatchers.delete(fn);
  }

  /** Call fn(camera) when someone stops orbiting or zooming (never while the camera is held). @returns {() => void} off */
  onCameraEnd(fn) {
    this.cameraEndListeners.add(fn);
    return () => this.cameraEndListeners.delete(fn);
  }

  /** Has the person orbited, panned or zoomed since this viewport opened? */
  touched() {
    return this.wasTouched;
  }

  // ─── picking ──────────────────────────────────────────────────────────────

  /** Aim the raycaster through a port-local point; returns it. */
  rayFrom(x, y) {
    this.camera.updateMatrixWorld();
    const ndc = new Vector2((x / this.size.w) * 2 - 1, -(y / this.size.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = Infinity;
    return this.raycaster;
  }

  /** The ray through a port-local point, in world. @returns {{ origin: number[], dir: number[] } | null} */
  ray(x, y) {
    if (!this.ok) return null;
    const { ray } = this.rayFrom(x, y);
    return { origin: ray.origin.toArray(), dir: ray.direction.toArray() };
  }

  /** The ray through the middle of the port (pointer lock aims along it). */
  centerRay() {
    return this.ray(this.size.w / 2, this.size.h / 2);
  }

  /** Where a world point lands in the port, or null behind the camera or past far. */
  screenOf(world) {
    const p = v3(world).project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    return { x: ((p.x + 1) / 2) * this.size.w, y: ((1 - p.y) / 2) * this.size.h };
  }

  /**
   * A world point ([x, y, z] or a vector) in port-local px. visible: in front
   * of the camera, inside its depth range and inside the port.
   * @returns {{ x: number, y: number, visible: boolean } | null}
   */
  project(p) {
    if (!this.ok) return null;
    this.camera.updateMatrixWorld();
    const q = v3(p).project(this.camera);
    const x = ((q.x + 1) / 2) * this.size.w;
    const y = ((1 - q.y) / 2) * this.size.h;
    const visible = q.z >= -1 && q.z <= 1 && x >= 0 && x <= this.size.w && y >= 0 && y <= this.size.h;
    return { x, y, visible };
  }

  /** The bodies picking looks at: shown objects with content, less any `skip(id)` says to. */
  pickTargets(skip = null) {
    // where they are now, not where the last frame drew them (a doc change or a pose may have moved them since)
    this.content.updateMatrixWorld();
    const out = [];
    for (const [id, e] of this.objects) {
      if (e.kind === "group" || !e.content || !this.isShown(e)) continue;
      if (skip?.(id)) continue;
      out.push(e.body);
    }
    return out;
  }

  /**
   * A raycaster hit as the stage hands it out. The normal is the hit face's,
   * in world, turned toward where the ray came from (meshes are double
   * sided); null for lines and points. `back`: the ray met the face from
   * behind (from inside a closed solid), as its own normal has it.
   */
  hitOf(h, ray) {
    let normal = null;
    let back = false;
    if (h.face?.normal) {
      const m = h.object.matrixWorld.clone();
      if (h.object.isInstancedMesh && h.instanceId != null) {
        const inst = new Matrix4();
        h.object.getMatrixAt(h.instanceId, inst);
        m.multiply(inst);
      }
      const n = h.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(m)).normalize();
      if (n.dot(ray.direction) > 0) {
        n.negate();
        back = true;
      }
      normal = n.toArray();
    }
    return { id: objectIdOf(h.object), point: h.point.toArray(), normal, distance: h.distance, back };
  }

  /** The nearest drawn hit among `targets` for the raycaster as it's aimed (that `accept` takes, if given). */
  nearestHit(targets, accept = null) {
    for (const h of this.raycaster.intersectObjects(targets, true)) if (drawn(h.object) && (!accept || accept(h))) return h;
    return null;
  }

  /** The nearest vertex of any visible object within `maxPx` of (sx, sy), in front of `maxDepth`. rect: { width, height } of the port. */
  nearestVertex(targets, sx, sy, maxPx, rect, maxDepth) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const viewProj = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const mvp = new Matrix4();
    const eye = cam.position.toArray();
    let best = null;
    const model = new Matrix4();
    const inst = new Matrix4();
    // Cull before scanning vertices: skip any piece whose bounding sphere
    // can't come within maxPx of the cursor (or lies past maxDepth). Scanning
    // every vertex of every shown object costs tens of ms at Solander scale.
    const fPx = rect.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const view = cam.matrixWorldInverse;
    const centre = new Vector3();
    const far = (o, m, px) => {
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      if (!bs || !Number.isFinite(bs.radius)) return false;
      const r = bs.radius * m.getMaxScaleOnAxis();
      centre.copy(bs.center).applyMatrix4(m);
      if (Math.hypot(centre.x - eye[0], centre.y - eye[1], centre.z - eye[2]) - r > maxDepth) return true;
      centre.applyMatrix4(view);
      const cz = -centre.z;
      if (cz + r < 0) return true; // all behind the camera
      if (cz - r <= 1e-6) return false; // around the camera: can't tell
      const bx = (fPx * r * (1 + Math.abs(centre.x) / cz)) / (cz - r);
      const by = (fPx * r * (1 + Math.abs(centre.y) / cz)) / (cz - r);
      const px0 = rect.width / 2 + (centre.x / cz) * fPx;
      const py0 = rect.height / 2 - (centre.y / cz) * fPx;
      return Math.abs(px0 - sx) > bx + px || Math.abs(py0 - sy) > by + px;
    };
    // For a mesh that has its pick BVH (built in idle time after it loads),
    // visit only the triangles in BVH nodes that come within the snap
    // distance of the pick ray, not every vertex.
    const dir = new Vector3((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    const c = new Vector3();
    const size = new Vector3();
    const viaBVH = (bvh, m, mw, limit) => {
      const scaleMax = model.getMaxScaleOnAxis();
      let found = null;
      const test = (v) => {
        const px = v.x, py = v.y, pz = v.z;
        const w = m[3] * px + m[7] * py + m[11] * pz + m[15];
        if (!(w > 0)) return;
        const qx = (((m[0] * px + m[4] * py + m[8] * pz + m[12]) / w + 1) / 2) * rect.width;
        const qy = ((1 - (m[1] * px + m[5] * py + m[9] * pz + m[13]) / w) / 2) * rect.height;
        const d = Math.hypot(qx - sx, qy - sy);
        if (!(d <= limit)) return;
        const wx = mw[0] * px + mw[4] * py + mw[8] * pz + mw[12];
        const wy = mw[1] * px + mw[5] * py + mw[9] * pz + mw[13];
        const wz = mw[2] * px + mw[6] * py + mw[10] * pz + mw[14];
        if ((wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2 > maxDepth * maxDepth) return;
        limit = d;
        found = { d, world: [wx, wy, wz] };
      };
      bvh.shapecast({
        intersectsBounds: (box) => {
          box.getCenter(c).applyMatrix4(model);
          const r = (box.getSize(size).length() / 2) * scaleMax;
          const vx = c.x - eye[0], vy = c.y - eye[1], vz = c.z - eye[2];
          const dist = Math.hypot(vx, vy, vz);
          if (dist - r > maxDepth) return false;
          const t = vx * dir.x + vy * dir.y + vz * dir.z;
          if (t + r < 0) return false;
          const perp = Math.sqrt(Math.max(0, dist * dist - t * t));
          // a pixel off the ray at distance D is at least D / fPx away from it
          return perp <= r + ((dist + r) * limit * 1.1) / fPx;
        },
        intersectsTriangle: (tri) => {
          test(tri.a);
          test(tri.b);
          test(tri.c);
          return false;
        },
      });
      return found;
    };
    for (const group of targets) {
      group.traverseVisible((o) => {
        const attr = o.geometry?.getAttribute?.("position");
        if (!attr || attr.itemSize !== 3 || attr.normalized) return;
        const interleaved = !!attr.isInterleavedBufferAttribute;
        const layout = { count: attr.count, stride: interleaved ? attr.data.stride : 3, offset: interleaved ? attr.offset : 0 };
        const copies = o.isInstancedMesh ? o.count : 1;
        for (let c = 0; c < copies; c++) {
          model.copy(o.matrixWorld);
          if (o.isInstancedMesh) model.multiply((o.getMatrixAt(c, inst), inst));
          if (far(o, model, best ? best.d : maxPx)) continue;
          mvp.multiplyMatrices(viewProj, model);
          const bvh = o.isMesh ? o.geometry.boundsTree : null;
          if (bvh) {
            const r = viaBVH(bvh, mvp.elements, model.elements, best ? best.d : maxPx);
            if (r) best = { ...r, objectId: objectIdOf(o) };
            continue;
          }
          const r = nearestScreenVertex(interleaved ? attr.data.array : attr.array, layout, mvp.elements, model.elements, {
            width: rect.width,
            height: rect.height,
            x: sx,
            y: sy,
            maxPx: best ? best.d : maxPx,
            eye,
            maxDepth,
          });
          if (!r) continue;
          best = { ...r, objectId: objectIdOf(o) };
        }
      });
    }
    return best;
  }

  /**
   * What's under a port-local point: the nearest shown object's surface, or,
   * with snapPx, the nearest vertex within that many px (one on the
   * silhouette beside the hit face counts too), or, with ground, the y = 0
   * plane. Line and point objects are hit within 5 px.
   * @returns {{ id: string | null, point: number[], normal: number[] | null, distance: number, snapped: boolean, ground?: true } | null}
   */
  pick(x, y, { ground = false, snapPx = 0 } = {}) {
    if (!this.ok) return null;
    const rect = { width: this.size.w, height: this.size.h };
    const rc = this.rayFrom(x, y);
    const worldPerPx = (2 * this.focusDistance() * Math.tan((this.camera.fov * Math.PI) / 360)) / rect.height;
    rc.params.Line.threshold = worldPerPx * 5;
    rc.params.Points.threshold = worldPerPx * 5;
    const eye = this.camera.position;
    const atVertex = (near) => ({ id: near.objectId, point: near.world, normal: null, distance: eye.distanceTo(v3(near.world)), snapped: true });

    const targets = this.pickTargets();
    const hit = this.nearestHit(targets);
    if (hit) {
      const out = this.hitOf(hit, rc.ray);
      if (!(snapPx > 0)) return { ...out, snapped: false };
      let point = null;
      let best = snapPx;
      const pos = hit.object.geometry?.getAttribute?.("position");
      const candidates = hit.face ? [hit.face.a, hit.face.b, hit.face.c] : hit.index != null ? [hit.index, hit.index + 1] : [];
      const v = new Vector3();
      const instM = hit.object.isInstancedMesh && hit.instanceId != null ? new Matrix4() : null;
      if (instM) hit.object.getMatrixAt(hit.instanceId, instM);
      for (const i of candidates) {
        if (!pos || i >= pos.count) continue;
        v.fromBufferAttribute(pos, i);
        if (instM) v.applyMatrix4(instM);
        v.applyMatrix4(hit.object.matrixWorld);
        const p = this.screenOf(v);
        if (!p) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= best) {
          best = d;
          point = v.clone();
        }
      }
      // a nearer vertex that isn't on the hit face (a tip on the silhouette)
      const near = this.nearestVertex(targets, x, y, point ? best : snapPx, rect, hit.distance + Math.max(worldPerPx * snapPx * 3, 1e-4));
      if (near && (!point || near.d < best)) return { ...atVertex(near), id: near.objectId ?? out.id };
      if (point) return { ...out, point: point.toArray(), distance: eye.distanceTo(point), snapped: true };
      return { ...out, snapped: false };
    }
    // missed every object by a hair: still snap to a vertex under the cursor
    const near = snapPx > 0 ? this.nearestVertex(targets, x, y, snapPx, rect, Infinity) : null;
    if (near) return atVertex(near);
    if (ground) {
      const p = new Vector3();
      if (rc.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), p)) {
        return { id: null, point: p.toArray(), normal: [0, 1, 0], distance: rc.ray.origin.distanceTo(p), snapped: false, ground: true };
      }
    }
    return null;
  }

  /**
   * The nearest shown object along a world ray (walking into walls, shooting,
   * standing on things). Lines and points are never hit. skip(id) → true
   * leaves an object out (yourself, what you carry).
   * @param {number[]} origin  @param {number[]} dir  (need not be unit)
   * @returns {{ id: string, point: number[], normal: number[] | null, distance: number } | null}
   */
  raycast(origin, dir, { far = Infinity, skip = null } = {}) {
    if (!this.ok) return null;
    const d = v3(dir);
    if (d.lengthSq() < 1e-24) return null;
    const rc = this.raycaster;
    rc.set(v3(origin), d.normalize());
    rc.far = Number(far) > 0 ? Number(far) : Infinity;
    rc.params.Line.threshold = 0;
    rc.params.Points.threshold = 0;
    try {
      const hit = this.nearestHit(this.pickTargets(skip), (h) => !h.object.isLine && !h.object.isPoints);
      return hit ? this.hitOf(hit, rc.ray) : null;
    } finally {
      rc.far = Infinity;
    }
  }

  dispose() {
    if (!this.ok) {
      this.labels?.dispose();
      return;
    }
    this.ok = false;
    cancelAnimationFrame(this.raf);
    if (this.bvhTimer) this.bvhTimer.cancel(this.bvhTimer.id);
    this.bvhQueue.clear();
    for (const d of this.disposers) d();
    this.controls.dispose();
    disposeObject(this.scene);
    disposeObject(this.topScene);
    for (const c of this.compiling) disposeObject(c);
    this.compiling.clear();
    // Whatever might still hold the renderer (three keeps its last render
    // state, which holds the camera, which is in the scene) then reaches an
    // empty scene, not every object's geometry.
    this.scene.clear();
    this.topScene.clear();
    this.placeholderGeometry?.dispose();
    this.placeholderMaterial?.dispose();
    this.envTexture?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
    this.labels.dispose();
    this.objects.clear();
    this.poses.clear();
    this.layers.clear();
    this.extents.clear();
    this.loops.clear();
    this.afterHooks.clear();
    this.themeListeners.clear();
    this.cameraWatchers.clear();
    this.cameraEndListeners.clear();
    this.limits.clear();
  }
}
