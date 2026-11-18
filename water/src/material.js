// The water's surface: a grid that follows the camera and a ShaderMaterial
// that runs the ocean's own Gerstner sum on it, so the water drawn is the
// water things float on. Takes THREE as a parameter (the stage hands
// extensions api.THREE) and never imports it.
//
// The grid is a dense square around the camera inside rings that double
// their spacing outward, stitched so no ring leaves a crack, out to a flat
// skirt that reaches past the horizon. It moves with the camera in steps of
// a coarse ring's spacing, so the near rings' vertices always sit on the
// same world points and the water doesn't swim under them.
//
// The vertex shader moves each vertex by the waves its spacing can carry
// (shorter ones would alias). The fragment shader works out the normal again
// per pixel, from every wave the pixel can resolve plus finer normal-only
// detail, and hands the slope of what it can't resolve to the sun's
// highlight as roughness, so far off the glints merge into a glitter path
// instead of shimmering. Then: Fresnel reflection of the sky, the water's
// own colour with a turquoise lift through the crests toward the sun, foam
// where the waves pinch hardest (the Gerstner Jacobian), and the scene's fog.

import { prng } from "./prng.js";

const G = 9.81;
const TAU = Math.PI * 2;
// the noise's lattice repeats every 256 cells: the grid's origin is wrapped
// by this many metres so the noise stays put in the world
const NOISE_CELL = 3;
const NOISE_PERIOD = 256 * NOISE_CELL;

/**
 * The shore in the water (WATER.md, "The shore in the water"): how calm the
 * normal the reflection is taken off is (SHORE_CALM of the way from the
 * waves' normal to straight up, fading to none as the significant wave
 * height goes from CALM_UNTIL[0] to CALM_UNTIL[1] m), how soft the band's
 * edge is (SHORE_EDGE: `foot` × the pixel's footprint of the ray's rise,
 * held to [min, max] radians), and how ragged its top (SHORE_RAG: in each
 * of `bins` azimuth bins a tooth, a tree's tip, its height by hash, the land
 * lowered up to `depth` radians toward the bin's edges; its tint ±`tint`
 * over `tintCells` cells round the compass).
 */
export const SHORE_CALM = 0.6;
export const CALM_UNTIL = Object.freeze([0.6, 2.5]);
export const SHORE_EDGE = Object.freeze({ foot: 1.5, min: 0.012, max: 0.05 });
export const SHORE_RAG = Object.freeze({ bins: 360, depth: 0.012, tint: 0.15, tintCells: 90 });

/**
 * Shelter (WATER.md, "Shelter"): where a part gives the water's exposure
 * (`water.shore`'s exposure(from): 0 to 1, how open each spot is to the wind's
 * fetch), the shading normal's tilt is scaled by mix(EXPOSURE.floor, 1,
 * exposure²) and, under `calmUnder`, the reflection's calm raised to
 * `calm`: a harbour behind its breakwater reads as glass with the shore
 * stretched into vertical streaks, the open coast keeps its chop. Shading
 * only: the waves' geometry, and everything that floats on them, are
 * untouched.
 */
export const EXPOSURE = Object.freeze({ floor: 0.25, calm: 0.85, calmUnder: Object.freeze([0.4, 0.6]) });

/** How much of the shading normal's tilt a spot of exposure `e` (0 to 1) keeps, as the shader works it out. Pure. */
export const tiltFor = (e) => EXPOSURE.floor + (1 - EXPOSURE.floor) * Math.max(0, Math.min(1, e)) ** 2;

/** The reflection's calm at a spot of exposure `e` in a sea of significant wave height `hs`, as the shader works it out. Pure. */
export function shelteredCalm(hs, e) {
  const [a, b] = EXPOSURE.calmUnder;
  const t = Math.max(0, Math.min(1, (e - a) / (b - a)));
  const open = t * t * (3 - 2 * t);
  const c = calmFor(hs);
  return c + (Math.max(c, EXPOSURE.calm) - c) * (1 - open);
}

/** The calm a sea of significant wave height `hs` gets (the shader's `calm`). Pure. */
export function calmFor(hs) {
  const t = Math.max(0, Math.min(1, (hs - CALM_UNTIL[0]) / (CALM_UNTIL[1] - CALM_UNTIL[0])));
  return SHORE_CALM * (1 - t * t * (3 - 2 * t));
}

/**
 * How much of the shore's tint a pixel's reflection takes (the shader's
 * `under`), as the fragment shader works it out: the view direction `V`
 * (unit, toward the eye) reflected off the waves' normal `N` (unit) calmed
 * by `calm`, its rise (radians, 0 for a ray level or down), against the
 * land's elevation `land` (radians) less `rag` (radians, the bin's), the
 * edge `foot` × the pixel's footprint `fw` of the rise. In [0, 1]. Pure.
 */
export function shoreWeight({ V, N, calm = SHORE_CALM, land, rag = 0, fw = 0 }) {
  const m = [N[0] * (1 - calm), N[1] * (1 - calm) + calm, N[2] * (1 - calm)];
  const l = Math.hypot(...m);
  const n = m.map((c) => c / l);
  const d = V[0] * n[0] + V[1] * n[1] + V[2] * n[2];
  const Ry = 2 * d * n[1] - V[1];
  const rise = Math.asin(Math.max(0, Math.min(1, Ry)));
  const edge = Math.max(SHORE_EDGE.min, Math.min(SHORE_EDGE.max, SHORE_EDGE.foot * fw));
  const x = Math.max(0, Math.min(1, (land - rag - rise + edge) / (2 * edge)));
  return { weight: x * x * (3 - 2 * x), rise };
}

/** a in [0, m), for negative a too */
const wrap = (a, m) => ((a % m) + m) % m;

/** Where the grid centres for a camera position: the position snapped to `step` on x and z, at sea level. */
export function snapOrigin(position, step) {
  const x = Array.isArray(position) ? position[0] : position.x;
  const z = Array.isArray(position) ? position[2] : position.z;
  // + 0: no −0, so origins compare equal
  return [Math.round(x / step) * step + 0, 0, Math.round(z / step) * step + 0];
}

/**
 * The grid, as plain arrays: a centre square of `size`×`size` cells of
 * `cell` metres, then `rings` rings each twice as coarse and reaching twice
 * as far, then a skirt out to `skirt` metres. Where a ring meets the finer
 * one inside it, its cells fan from the finer ring's middle vertex, so there
 * are no T-junctions and no cracks. Every triangle faces up (+Y).
 * @param {{ cell?: number, size?: number, rings?: number, skirt?: number }} o
 * @returns {{ positions: Float32Array, indices: Uint32Array, inner: number, outer: number, vertexCount: number, triangleCount: number }}
 */
export function oceanGrid({ cell = 0.5, size = 64, rings = 10, skirt = 60000 } = {}) {
  const m = Math.max(4, Math.round(size / 4) * 4);
  const half = m / 2;
  const q = half / 2;
  const pos = [];
  const ids = new Map();
  const tris = [];
  /** the vertex at lattice point (a, b) in centre cells */
  const at = (a, b) => {
    const key = `${a},${b}`;
    let i = ids.get(key);
    if (i == null) {
      i = pos.length / 3;
      ids.set(key, i);
      pos.push(a * cell, 0, b * cell);
    }
    return i;
  };
  /** a triangle, wound to face up whatever order it came in */
  const tri = (i, j, k) => {
    const ux = pos[j * 3] - pos[i * 3], uz = pos[j * 3 + 2] - pos[i * 3 + 2];
    const vx = pos[k * 3] - pos[i * 3], vz = pos[k * 3 + 2] - pos[i * 3 + 2];
    if (uz * vx - ux * vz >= 0) tris.push(i, j, k);
    else tris.push(i, k, j);
  };
  /** a cell from its corners in order round it, fanned from `mid` (inserted after corner `after`) when there is one */
  const cellOf = (corners, mid, after) => {
    if (mid == null) {
      tri(corners[0], corners[1], corners[2]);
      tri(corners[0], corners[2], corners[3]);
      return;
    }
    const ring = [];
    for (let c = 0; c < 4; c++) {
      ring.push(corners[(after + 1 + c) % 4]);
    }
    // ring runs from the corner after the middle vertex round to the one before it
    for (let c = 0; c < 3; c++) tri(mid, ring[c], ring[c + 1]);
  };

  for (let a = -half; a < half; a++) {
    for (let b = -half; b < half; b++) cellOf([at(a, b), at(a + 1, b), at(a + 1, b + 1), at(a, b + 1)]);
  }
  for (let r = 1; r <= rings; r++) {
    const s = 2 ** r;
    for (let i = -half; i < half; i++) {
      for (let j = -half; j < half; j++) {
        if (i >= -q && i < q && j >= -q && j < q) continue;
        const x0 = i * s, x1 = (i + 1) * s, z0 = j * s, z1 = (j + 1) * s;
        // corners round the cell: (x0,z0) (x1,z0) (x1,z1) (x0,z1); edge e runs from corner e to e+1
        const corners = [at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)];
        const along = j >= -q && j < q;
        const across = i >= -q && i < q;
        if (along && i === q) cellOf(corners, at(x0, (z0 + z1) / 2), 3); // left edge on the hole
        else if (along && i === -q - 1) cellOf(corners, at(x1, (z0 + z1) / 2), 1); // right edge
        else if (across && j === q) cellOf(corners, at((x0 + x1) / 2, z0), 0); // near edge
        else if (across && j === -q - 1) cellOf(corners, at((x0 + x1) / 2, z1), 2); // far edge
        else cellOf(corners);
      }
    }
  }
  const S = 2 ** rings;
  const outer = half * S * cell;
  if (skirt > outer * 1.01) {
    // the last ring's edge, joined point for point to a square `skirt` out
    const E = half * S;
    const k = skirt / cell / E;
    const sides = [
      (t) => [-E + t * S, -E],
      (t) => [E, -E + t * S],
      (t) => [E - t * S, E],
      (t) => [-E, E - t * S],
    ];
    const far = new Map();
    const farAt = (a, b) => {
      const key = `${a},${b}`;
      let i = far.get(key);
      if (i == null) {
        i = pos.length / 3;
        far.set(key, i);
        pos.push(a * k * cell, 0, b * k * cell);
      }
      return i;
    };
    for (const side of sides) {
      for (let t = 0; t < m; t++) {
        const [a0, b0] = side(t);
        const [a1, b1] = side(t + 1);
        const i0 = at(a0, b0), i1 = at(a1, b1), o0 = farAt(a0, b0), o1 = farAt(a1, b1);
        tri(i0, i1, o1);
        tri(i0, o1, o0);
      }
    }
  }
  const positions = new Float32Array(pos);
  const indices = new Uint32Array(tris);
  return { positions, indices, inner: half * cell, outer, vertexCount: positions.length / 3, triangleCount: indices.length / 3 };
}

/**
 * The waves as the shader takes them: per wave vec4(k·dx, k·dz, A, Q·A), and
 * its phase now at the grid's origin, worked out here in double precision
 * (k·(d·origin) + φ − ω·t, wrapped) so the shader only ever sees positions
 * near its own grid and small angles, however far out or long the sail.
 * @param {{ dir: number[], k: number, omega: number, amp: number, steep: number, phase: number }[]} components
 * @param {number[]} origin  @param {number} t  @param {{ waves: Float32Array, phases: Float32Array }} [out]
 */
export function waveUniforms(components, origin, t, out) {
  const n = Math.max(1, components.length);
  const o = out ?? { waves: new Float32Array(4 * n), phases: new Float32Array(n) };
  components.forEach((c, i) => {
    const kx = c.k * c.dir[0];
    const kz = c.k * c.dir[1];
    o.waves[i * 4] = kx;
    o.waves[i * 4 + 1] = kz;
    o.waves[i * 4 + 2] = c.amp;
    o.waves[i * 4 + 3] = c.steep * c.amp;
    o.phases[i] = wrap(kx * origin[0] + kz * origin[2] + c.phase - c.omega * t, TAU);
  });
  return o;
}

/** Cox and Munk's mean square slope of the sea surface (both axes) for a wind speed: the roughness the sun sees. */
export function surfaceSlopeVariance(speed) {
  return 0.003 + 0.00512 * Math.max(0, Number(speed) || 0);
}

/**
 * The finer, normal-only waves: shorter than the sea's shortest, in many
 * directions leaning downwind, sharing between them most of the slope the
 * sea's own waves leave unaccounted for (Cox and Munk's total, less theirs).
 * What's left over after them is `rough`, for the sun's highlight.
 * @returns {{ waves: { dir: number[], k: number, omega: number, slope: number, phase: number }[], rough: number }}
 */
export function detailWaves(sea, count = 24) {
  const rand = prng(`${sea.seed ?? 1}:detail`);
  const comps = sea.components ?? [];
  const kMax = comps.reduce((k, c) => Math.max(k, c.k), 0) || TAU / 2;
  const total = surfaceSlopeVariance(sea.wind?.speed ?? 0);
  const drawn = comps.reduce((s, c) => s + (c.k * c.amp) ** 2 / 2, 0);
  const left = Math.max(0, total - drawn);
  // most of it to the detail, so close up the sun breaks into sharp glints
  const share = 0.85 * left;
  const slope = Math.sqrt((2 * share) / count);
  const from = ((Number(sea.wind?.from) || 0) * Math.PI) / 180;
  const wx = -Math.sin(from), wz = Math.cos(from);
  // from a little shorter than the sea's shortest wave down to 12 cm
  const lo = Math.log(kMax * 1.6);
  const hi = Math.log(TAU / 0.12);
  const waves = [];
  for (let i = 0; i < count; i++) {
    const k = Math.exp(lo + ((i + rand()) / count) * (hi - lo));
    // short waves spread wide, leaning downwind: a few run across it
    const off = (rand() - 0.5) * (rand() < 0.75 ? 1.6 : 3.4);
    const c = Math.cos(off), s = Math.sin(off);
    waves.push({ dir: [wx * c - wz * s, wx * s + wz * c], k, omega: Math.sqrt(G * k), slope, phase: rand() * TAU });
  }
  return { waves, rough: left - share };
}

/**
 * The Jacobian below which the sea's crests break into foam, chosen so that
 * a share `coverage` of the surface does (sea.stats.whitecaps: Monahan's
 * coverage for the wind). Measured over seeded samples of the sea itself.
 * -Infinity (no foam) for a sea without whitecaps.
 */
export function foamThreshold(sea, coverage = sea.stats?.whitecaps ?? 0, samples = 20000) {
  if (!(coverage > 0) || !sea.components?.length || !sea.displaced) return -Infinity;
  const rand = prng(`${sea.seed ?? 1}:foam`);
  const span = 4 * (sea.stats?.peakWavelength || 100);
  const js = new Float64Array(samples);
  const out = [0, 0, 0, 1];
  for (let i = 0; i < samples; i++) js[i] = sea.displaced(rand() * span, rand() * span, rand() * 600, out)[3];
  js.sort();
  return js[Math.min(samples - 1, Math.floor(coverage * samples))];
}

// ─── shaders ────────────────────────────────────────────────────────────────

const VERTEX = /* glsl */ `
attribute float aDisp;
attribute float aFace;
uniform vec4 uWaves[WAVES];
uniform float uPhase[WAVES];
uniform float uCell;
uniform float uInner;
varying vec2 vRest;
varying vec3 vWorld;
varying float vHeight;
varying float vFace;
varying float vBelow;
#include <fog_pars_vertex>
void main() {
  vec2 p = position.xz;
  // the spacing here: continuous across the rings and never less than the
  // true one (it's the true one round the camera). A wave needs some six
  // vertices a wavelength to be drawn faithfully, and aliases under three,
  // so shorter ones fade out between the two; round the camera, every wave
  // of a fresh breeze and up is drawn in full, so what floats is what's seen
  float cell = uCell * max(1.0, 2.0 * max(abs(p.x), abs(p.y)) / uInner);
  vec3 d = vec3(0.0);
  for (int i = 0; i < WAVES; i++) {
    vec4 w = uWaves[i];
    float k = length(w.xy);
    float f = 1.0 - smoothstep(1.0, 2.0, k * cell);
    if (f <= 0.0 || k <= 0.0) continue;
    vec2 dir = w.xy / k;
    float th = dot(w.xy, p) + uPhase[i];
    d.xz -= f * w.w * dir * sin(th);
    d.y += f * w.z * cos(th);
  }
  // a block's skirt bottoms and floor stay where they are; the rim and the top move
  d *= aDisp;
  vec4 world = modelMatrix * vec4(p.x + d.x, position.y + d.y, p.y + d.z, 1.0);
  vRest = p;
  vWorld = world.xyz;
  vHeight = d.y;
  vFace = aFace;
  vBelow = -(position.y + d.y);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  // the sea reaches the horizon whatever the camera's far plane: past it, it's pinned just inside
  if (gl_Position.z > gl_Position.w) gl_Position.z = gl_Position.w * 0.99999;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform vec4 uWaves[WAVES];
uniform float uPhase[WAVES];
uniform vec4 uDetail[DETAIL];
uniform float uDetailPhase[DETAIL];
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uSunOn;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec4 uClouds;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform float uScatterGain;
uniform vec3 uFoamColor;
uniform float uFoamAt;
uniform float uRough;
uniform float uHs;
uniform vec2 uNoiseOrigin;
uniform vec2 uWind;
#ifdef SHORE
uniform sampler2D uShore;
uniform vec3 uShoreTint;
uniform vec3 uShoreEye;
uniform float uShoreNear;
uniform float uShoreReach;
#endif
#ifdef EXPOSURE
uniform sampler2D uExposure;
uniform vec4 uExpA;
uniform vec4 uExpB;
#endif
varying vec2 vRest;
varying vec3 vWorld;
varying float vHeight;
varying float vFace;
varying float vBelow;
#include <fog_pars_fragment>

float hash(vec2 c) {
  c = mod(c, 256.0);
  return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float cloudHash(vec2 c) {
  c = mod(c, 289.0);
  return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
}
float cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// the sky's cloud deck, as the stage draws it (scene's viewport.js cloudAt; cloudAt here is it in JS): the luminance's factor and how white a scattered cloud makes it
vec2 cloudAt(vec3 d) {
  if (uClouds.x <= 0.0 || d.y <= 0.0) return vec2(1.0, 0.0);
  vec2 p = d.xz * (uClouds.w / max(d.y, 0.02)) / uClouds.z;
  float n = cloudNoise(p) * 0.65 + cloudNoise(p * 2.3 + 17.0) * 0.35;
  float fade = smoothstep(0.03, 0.3, d.y);
  float w = uClouds.x >= 1.0 ? n : smoothstep(1.0 - uClouds.x - 0.12, 1.0 - uClouds.x + 0.12, n);
  float shape = uClouds.x >= 1.0 ? 2.0 * w - 1.0 : w * (2.0 * smoothstep(0.05, 0.35, d.y) - 1.0);
  return vec2(1.0 + uClouds.y * shape * fade, uClouds.x >= 1.0 ? 0.0 : w * fade * 0.6);
}
vec3 sky(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(y, 0.55));
  vec2 cl = cloudAt(d);
  return mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), cl.y) * cl.x;
}

void main() {
  if (vFace > 0.5) {
    // a block's skirt and floor: the water's own body, darker with depth
    vec3 lit = mix(uSkyHorizon, uSkyTop, 0.5);
    float sunUp = clamp(normalize(uSunDir).y * 4.0, 0.0, 1.0) * uSunOn;
    vec3 shallow = (uDeep * 1.4 + uScatter * 0.35) * (0.6 + 0.4 * sunUp) * (0.7 + 0.6 * dot(lit, vec3(0.2126, 0.7152, 0.0722)));
    vec3 deep = uDeep * 0.45;
    gl_FragColor = vec4(mix(shallow, deep, clamp(vBelow / 6.0, 0.0, 1.0)), 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }
  vec2 p = vRest;
  vec2 fw = fwidth(p);
  float foot = max(max(fw.x, fw.y), 1e-4);
  float jxx = 1.0, jzz = 1.0, jxz = 0.0, gx = 0.0, gz = 0.0, lost = 0.0;
  for (int i = 0; i < WAVES; i++) {
    vec4 w = uWaves[i];
    float k = length(w.xy);
    if (k <= 0.0) continue;
    float ka = k * w.z;
    // a wave whose phase turns more than about a radian a pixel would shimmer: let its slope go to the roughness instead
    float f = 1.0 - smoothstep(0.5, 1.4, k * foot);
    lost += (1.0 - f * f) * 0.5 * ka * ka;
    if (f <= 0.0) continue;
    vec2 dir = w.xy / k;
    float th = dot(w.xy, p) + uPhase[i];
    float s = sin(th), c = cos(th);
    float qk = f * k * w.w * c;
    jxx -= qk * dir.x * dir.x;
    jzz -= qk * dir.y * dir.y;
    jxz -= qk * dir.x * dir.y;
    gx += f * ka * dir.x * s;
    gz += f * ka * dir.y * s;
  }
  float jac = jxx * jzz - jxz * jxz;
  vec2 detail = vec2(0.0);
  for (int i = 0; i < DETAIL; i++) {
    vec4 w = uDetail[i];
    float k = length(w.xy);
    if (k <= 0.0) continue;
    float f = 1.0 - smoothstep(0.3, 1.0, k * foot);
    lost += (1.0 - f * f) * 0.5 * w.z * w.z;
    if (f <= 0.0) continue;
    detail += f * w.z * (w.xy / k) * sin(dot(w.xy, p) + uDetailPhase[i]);
  }
  gx += detail.x;
  gz += detail.y;
  vec3 N = normalize(vec3(gx * jzz - gz * jxz, jac, gz * jxx - gx * jxz));
  // shelter (EXPOSURE): how open this spot is to the wind's fetch, from the part that knows the land; the normal's tilt scaled by it
  float expo = 1.0;
#ifdef EXPOSURE
  {
    vec2 ed = vWorld.xz - uExpA.xy;
    vec2 euv = vec2(dot(ed, uExpA.zw), dot(ed, uExpB.xy)) * uExpB.z;
    if (euv.x >= 0.0 && euv.y >= 0.0 && euv.x <= 1.0 && euv.y <= 1.0) expo = texture2D(uExposure, euv).r;
  }
#endif
  float tilt = ${EXPOSURE.floor.toFixed(3)} + ${(1 - EXPOSURE.floor).toFixed(3)} * clamp(expo, 0.0, 1.0) * clamp(expo, 0.0, 1.0);
  N = normalize(vec3(N.x * tilt, N.y, N.z * tilt));

  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  // a normal facing away from the eye (a far wave's back) is seen edge on
  if (dot(N, V) < 0.0) N = normalize(N - V * dot(N, V) * 1.01);
  float NV = max(dot(N, V), 1e-3);
  vec3 L = normalize(uSunDir);
  float sunUp = clamp(L.y * 4.0, 0.0, 1.0) * uSunOn;

  // reflection: the sky, as the stage draws it, with the sun's halo. The ray is reflected off a
  // calmed normal (SHORE_CALM of the way to straight up, less in a big sea): over calm water what the
  // waves do to a reflection is stretch it into vertical streaks, not tear it into blobs
  float calm = ${SHORE_CALM.toFixed(3)} * (1.0 - smoothstep(${CALM_UNTIL[0].toFixed(2)}, ${CALM_UNTIL[1].toFixed(2)}, uHs));
  // sheltered water (exposure under EXPOSURE.calmUnder) calmer still
  calm = mix(max(calm, ${EXPOSURE.calm.toFixed(3)}), calm, smoothstep(${EXPOSURE.calmUnder[0].toFixed(2)}, ${EXPOSURE.calmUnder[1].toFixed(2)}, expo));
  vec3 R = reflect(-V, normalize(mix(N, vec3(0.0, 1.0, 0.0), calm)));
  vec3 refl = sky(R) + uSunOn * uSunColor * pow(max(dot(normalize(vec3(R.x, max(R.y, 0.0), R.z)), L), 0.0), 16.0) * 0.3;
  float fresnel = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
#ifdef SHORE
  // the shore in the water (WATER.md, "The shore in the water"): where the reflected ray is under the
  // land as the mirror eye sees it, at this water's distance or beyond, it shows the shore's tint, not the sky
  {
    float az = fract(atan(R.z, R.x) / 6.2831853 + 1.0);
    float across = max(length(vWorld.xz - uShoreEye.xz), uShoreNear);
    float bin = clamp(log(across / uShoreNear) / log(uShoreReach / uShoreNear), 0.0, 1.0);
    // r: the highest land's elevation, g: its distance (km), b: the nearest land's (km), a: the near shore's top (its elevation)
    vec4 land = texture2D(uShore, vec2(az, (bin * (SHORE_BINS - 1.0) + 0.5) / SHORE_BINS));
    // a ray reflected level or down (a wave's face seen edge on) is at the horizon: the shore's foot if
    // there's land there, else the horizon's colour (sky() at y <= 0), never a white rim inside the shore
    float rise = asin(clamp(R.y, 0.0, 1.0));
    // the band's top ragged as the forest it mirrors (shoreWeight: the land a little lower in some
    // azimuth bins, by hash), and its edge as soft as a pixel's footprint of the ray's rise, so far off
    // the ripples average to a mixed tone instead of aliasing into hard dark blobs
    // teeth: in each azimuth bin a tree's tip at the bin's middle, as tall as the bin's hash, the land falling away to its edges
    float bins = floor(az * ${SHORE_RAG.bins.toFixed(1)});
    float tooth = (1.0 - abs(2.0 * fract(az * ${SHORE_RAG.bins.toFixed(1)}) - 1.0)) * (0.5 + 0.5 * hash(vec2(mod(bins, 256.0), floor(bins / 256.0) + 11.0)));
    float rag = ${SHORE_RAG.depth.toFixed(4)} * (1.0 - tooth);
    float edge = clamp(${SHORE_EDGE.foot.toFixed(2)} * fwidth(rise), ${SHORE_EDGE.min.toFixed(4)}, ${SHORE_EDGE.max.toFixed(4)});
    float under = smoothstep(-edge, edge, land.r - rag - rise);
    // the tint varies along the shore (±SHORE_RAG.tint), as a forest's mirror isn't one flat slab
    vec3 tint = uShoreTint * (1.0 + ${SHORE_RAG.tint.toFixed(3)} * (2.0 * noise(vec2(az * ${SHORE_RAG.tintCells.toFixed(1)}, 3.5)) - 1.0));
    #if defined(USE_FOG) && !defined(FOG_EXP2)
    // the land is further off than the water it shows in: fogged so that, with the water's own fog after it, it is fogged as far as the land
    // (a ray under the near shore's top meets the near shore, one over it the far hills)
    float fl = smoothstep(fogNear, fogFar, mix(land.b, land.g, smoothstep(land.a - 0.004, land.a + 0.004, rise)) * 1000.0);
    float fw = smoothstep(fogNear, fogFar, dist);
    tint = mix(tint, fogColor, clamp(1.0 - (1.0 - fl) / max(1.0 - fw, 1e-3), 0.0, 1.0));
    #endif
    refl = mix(refl, tint, under);
  }
#endif

  // the water's own colour: light scattered back up from below, lit by the
  // sky and the sun, and a turquoise lift where a crest stands high and you
  // look through it toward the sun
  vec3 ambient = mix(uSkyHorizon, uSkyTop, 0.5);
  vec3 body = uDeep * (0.55 + 0.45 * sunUp) * (0.6 + 0.8 * dot(ambient, vec3(0.2126, 0.7152, 0.0722)));
  float crest = clamp(vHeight / max(uHs * 0.6, 0.05) + 0.25, 0.0, 1.0);
  vec3 look = normalize(vec3(-V.x, 0.0, -V.z) + 1e-5);
  vec3 sunFlat = normalize(vec3(L.x, 0.0, L.z) + 1e-5);
  float toward = pow(max(dot(look, sunFlat), 0.0), 3.0);
  // light gets through a crest's face, seen edge on, far more than its top seen from above
  float face = (0.2 + 2.5 * (1.0 - N.y)) * (0.45 + 0.55 * (1.0 - NV));
  body += uScatter * uScatterGain * pow(crest, 1.5) * (0.15 + 1.5 * toward * sunUp) * face;

  vec3 col = mix(body, refl, fresnel);

  // the sun's highlight: Beckmann, its roughness the slope of everything too
  // fine to draw here, never less than the sun's own size
  vec3 H = normalize(L + V);
  float NH = max(dot(N, H), 1e-4);
  float NL = max(dot(N, L), 0.0);
  float m2 = clamp(uRough + lost, 6e-4, 0.6);
  float NH2 = NH * NH;
  float D = exp(-(1.0 - NH2) / (NH2 * m2)) / (3.14159 * m2 * NH2 * NH2);
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  col += uSunOn * uSunColor * uSunIntensity * Fs * D * NL / (4.0 * max(NV, 0.15)) * step(0.0, L.y);

  // foam: bright where a crest is pinched past breaking, and round it a
  // thinner lace of older foam, drawn out downwind as it drifts. The noise
  // rides the water (rest positions), so the foam moves with the waves
  vec2 wp = p + uNoiseOrigin;
  vec2 np = vec2(dot(wp, uWind), dot(wp, vec2(-uWind.y, uWind.x)) * 2.2) / ${NOISE_CELL.toFixed(1)};
  float n1 = noise(np) * 0.65 + noise(np * 2.0 + 3.1) * 0.35;
  float n2 = noise(np * 6.0 + 1.7) * 0.6 + noise(np * 13.0 + 5.3) * 0.4;
  float veins = 1.0 - abs(2.0 * n2 - 1.0);
  float d = uFoamAt - jac + (n1 - 0.5) * 0.12 + (n2 - 0.5) * 0.05;
  float fresh = smoothstep(-0.03, 0.04, d);
  float trail = smoothstep(-0.09, -0.02, d) * smoothstep(0.84, 0.97, veins) * smoothstep(0.35, 0.6, n1);
  float foam = max(fresh * (0.7 + 0.3 * veins), trail * 0.3);
  vec3 foamLit = uFoamColor * (0.5 + 0.5 * sunUp * max(N.y, 0.0)) * (0.75 + 0.25 * dot(ambient, vec3(0.2126, 0.7152, 0.0722)));
  col = mix(col, foamLit, foam * 0.9);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
  // a smooth gradient to the horizon bands in 8 bits: half a level of noise either way
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}`;

/** A cloud deck as the stage's atmosphere gives it (scene CONVENTIONS.md, "Atmosphere": clouds), checked as the stage checks it: { cover, contrast, scale, base } or null. Pure. */
export function cloudsOf(c) {
  if (!c || typeof c !== "object") return null;
  const num = (v, d) => (v == null || v === "" ? d : Number.isFinite(Number(v)) ? Number(v) : null);
  const cover = num(c.cover, null), contrast = num(c.contrast, 0.1), scale = num(c.scale, 600), base = num(c.base, 800);
  if (!(cover > 0 && contrast > 0 && scale > 0 && base > 0)) return null;
  return { cover: Math.min(1, cover), contrast: Math.min(0.5, contrast), scale, base };
}

/** The cloud deck's factor on the sky's luminance in direction d, and how white it makes it: the fragment shader's cloudAt (and the stage's sky's), in JS, `noise` its value noise. Pure. */
export function cloudAt(d, { cover, contrast, scale, base }, noise) {
  if (!(d[1] > 0)) return { factor: 1, white: 0 };
  const k = base / Math.max(d[1], 0.02) / scale;
  const x = d[0] * k, z = d[2] * k;
  const n = noise(x, z) * 0.65 + noise(x * 2.3 + 17, z * 2.3 + 17) * 0.35;
  const sm = (a, b, t) => {
    const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const fade = sm(0.03, 0.3, d[1]);
  const w = cover >= 1 ? n : sm(1 - cover - 0.12, 1 - cover + 0.12, n);
  const shape = cover >= 1 ? 2 * w - 1 : w * (2 * sm(0.05, 0.35, d[1]) - 1);
  return { factor: 1 + contrast * shape * fade, white: cover >= 1 ? 0 : w * fade * 0.6 };
}

/** How much of the light scattered through a crest shows under a sun: all of it under a sun that casts shadows, a third under an overcast's (shadows: false). Pure. */
export const scatterGain = (sun) => (sun?.shadows === false ? 0.35 : 1);

/** A colour from a THREE.Color, a hex string or number, or [r, g, b] (linear). */
function setColour(target, value) {
  if (value == null) return;
  if (Array.isArray(value)) target.setRGB(value[0], value[1], value[2]);
  else target.set(value);
}

const DEFAULTS = {
  sky: { top: "#4a7fbf", horizon: "#c7d8e6" },
  sun: { direction: [0.45, 0.32, -0.83], color: "#fff1dc", intensity: 1.5 },
  deep: "#073f58",
  scatter: "#25b8a4",
  foam: "#e8eef0",
};

/** A floor as patchGrid takes it: a depth below the level (m), or [f0, fx, fz] (its height above the level at offset (dx, dz) is f0 + fx·dx + fz·dz). */
const floorPlane = (floor) => (Array.isArray(floor) ? floor : [-(Number(floor) || 0), 0, 0]);

/**
 * A bounded body's drawn block (WATER.md, "Who draws what", and Decision 99):
 * one mesh, its positions offsets from the body's origin in the stage's own
 * axes (so the shader's waves, which are in the stage's frame, need no
 * turning), in three parts:
 *   - the top: a w×l grid of cells about `cell` metres, turned by `yaw` about
 *     +Y, every triangle facing up; displaced by the waves;
 *   - the skirt: the top's rim vertices again, in order round it, each
 *     displaced exactly as the rim (`disp` 1), down to the floor (`disp` 0),
 *     so the drawn edge is the water's edge with no gap on a crest;
 *   - the floor: a quad on the floor plane under the footprint.
 * `disp` says which vertices the waves move; `face` is 0 on the top and 1
 * on the skirt and floor (drawn as the water's body, tinted by depth).
 * Without a floor (null) there is no skirt and no floor: the top alone.
 * `spacing` is the top's real vertex spacing (patchCounts), which is what the
 * shader's short-wave fade must be told.
 * @param {number | number[] | null} [floor]  a depth below the level, or the floor plane (floorPlane)
 * @returns {{ positions: Float32Array, disp: Float32Array, face: Float32Array, indices: Uint32Array, nx: number, nz: number, spacing: number, solid: boolean, top: number, topTriangles: number, rim: number[] }}
 */
export function patchGrid(w, l, yaw = 0, cell = 0.5, floor = null) {
  const { nx, nz, spacing } = patchCounts(w, l, cell);
  const top = (nx + 1) * (nz + 1);
  // the rim, in order round the top: along j = 0, up i = nx, back along j = nz, down i = 0
  const rim = [];
  for (let i = 0; i < nx; i++) rim.push(i);
  for (let j = 0; j < nz; j++) rim.push(j * (nx + 1) + nx);
  for (let i = nx; i > 0; i--) rim.push(nz * (nx + 1) + i);
  for (let j = nz; j > 0; j--) rim.push(j * (nx + 1));
  const solid = floor !== null && floor !== undefined;
  const count = top + (solid ? 2 * rim.length + 4 : 0);
  const positions = new Float32Array(count * 3);
  const disp = new Float32Array(count);
  const face = new Float32Array(count);
  disp.fill(1, 0, top);
  placePatch(positions, w, l, yaw, nx, nz, solid ? floorPlane(floor) : null, rim);
  const triangles = nx * nz * 2 + (solid ? 2 * rim.length + 2 : 0);
  const indices = new Uint32Array(triangles * 3);
  let k = 0;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      // (x right, z toward the viewer): a, c, b and b, c, d wind counter-clockwise seen from +Y
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  if (solid) {
    const n = rim.length;
    for (let r = 0; r < n; r++) {
      const up = top + 2 * r, down = up + 1;
      disp[up] = 1;
      face[up] = 1;
      face[down] = 1;
      const up2 = top + 2 * ((r + 1) % n), down2 = up2 + 1;
      indices.set([up, down, up2, up2, down, down2], k);
      k += 6;
    }
    const f = top + 2 * n;
    for (let c = 0; c < 4; c++) face[f + c] = 1;
    indices.set([f, f + 1, f + 2, f, f + 2, f + 3], k);
    k += 6;
  }
  return { positions, disp, face, indices, nx, nz, spacing, solid, top, topTriangles: nx * nz * 2, rim };
}

/** Most cells a patch's top has along a side: past 256 × `cell` metres its cells widen. */
export const PATCH_MAX_CELLS = 256;

/**
 * A patch's cell counts for a w×l top asked for at about `cell` metres, and
 * its real vertex spacing: the wider of its two cell sides, w/nx and l/nz.
 * Over PATCH_MAX_CELLS × cell on a side the count is capped and the real
 * spacing is wider than `cell` (a 100×207 m clip at 0.5 m: 207/256 ≈ 0.81 m;
 * Cadboro Bay's 8192 m: 32 m). Pure.
 */
export function patchCounts(w, l, cell = 0.5) {
  const nx = Math.max(1, Math.min(PATCH_MAX_CELLS, Math.ceil(w / cell)));
  const nz = Math.max(1, Math.min(PATCH_MAX_CELLS, Math.ceil(l / cell)));
  return { nx, nz, spacing: Math.max(w / nx, l / nz) };
}

/** The vertex shader's short-wave fade for a wave of wavenumber k at vertex spacing `cell` (GLSL smoothstep): 1 carried in full, 0 not drawn. */
export function waveFade(k, cell) {
  const x = Math.min(1, Math.max(0, k * cell - 1));
  return 1 - x * x * (3 - 2 * x);
}

/** Fill a patch's positions for a size, a yaw and a floor plane (the counts unchanged). */
function placePatch(positions, w, l, yaw, nx, nz, floor = null, rim = null) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let k = 0;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const u = -w / 2 + (w * i) / nx, v = -l / 2 + (l * j) / nz;
      positions[k++] = u * c + v * s;
      positions[k++] = 0;
      positions[k++] = -u * s + v * c;
    }
  if (!floor) return positions;
  const below = (x, z) => floor[0] + floor[1] * x + floor[2] * z;
  for (const r of rim) {
    const x = positions[r * 3], z = positions[r * 3 + 2];
    // the rim again (displaced as the rim is), then straight down to the floor
    positions[k++] = x;
    positions[k++] = 0;
    positions[k++] = z;
    positions[k++] = x;
    positions[k++] = below(x, z);
    positions[k++] = z;
  }
  for (const [u, v] of [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]]) {
    const x = u * c + v * s, z = -u * s + v * c;
    positions[k++] = x;
    positions[k++] = below(x, z);
    positions[k++] = z;
  }
  return positions;
}

/**
 * Where the shader puts vertex `i` of a patch mesh (its positions, `disp` and
 * `spacing`), its origin at `origin` in the stage's frame, at time t: the
 * vertex shader's displacement in double precision, its short-wave fade at
 * the mesh's real spacing included, so a test can hold the drawn block to the
 * read water (and, wave by wave, see which ones the drawing fades). Pure.
 */
export function drawnVertex(mesh, i, components, origin, t) {
  const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
  let dx = 0, dy = 0, dz = 0;
  if (mesh.disp[i] > 0)
    for (const c of components) {
      const f = waveFade(c.k, mesh.spacing);
      if (f <= 0) continue;
      const th = c.k * (c.dir[0] * (x + origin[0]) + c.dir[1] * (z + origin[2])) + c.phase - c.omega * t;
      dx -= f * c.steep * c.amp * c.dir[0] * Math.sin(th);
      dz -= f * c.steep * c.amp * c.dir[1] * Math.sin(th);
      dy += f * c.amp * Math.cos(th);
    }
  const m = mesh.disp[i];
  return [origin[0] + x + m * dx, origin[1] + y + m * dy, origin[2] + z + m * dz];
}

/**
 * The sea's surface.
 * @param {any} THREE  the stage's three.js (api.THREE)
 * @param {ReturnType<import("./ocean.js").createOcean>} sea
 * @param {{ cell?: number, size?: number, rings?: number, skirt?: number, snapLevel?: number, detail?: number,
 *           sky?: { top?, horizon? }, sun?: { direction?, color?, intensity? } | null,
 *           deep?, scatter?, foam?, foamCoverage?: number, patch?: { w: number, l: number, yaw?: number, floor?: number | number[] | null, cell?: number } }} [opts]
 *   With `patch`, a finite block over a bounded body's footprint (patchGrid: its top, and
 *   with a floor its skirt and floor) instead of the grid round the camera: update's second
 *   argument is then the body's origin, and setPatch turns, resizes or deepens it.
 * @returns {{ object: any, update(t: number, cameraPosition: any, sun?: object | null, sky?: object | null): void, setSea(sea: object): void, dispose(): void }}
 */
export function createOceanSurface(THREE, sea, opts = {}) {
  const patch = opts.patch ? { w: opts.patch.w, l: opts.patch.l, yaw: opts.patch.yaw ?? 0, floor: opts.patch.floor ?? null } : null;
  const cell = patch ? (opts.patch.cell ?? Math.max(0.05, Math.min(0.5, Math.max(patch.w, patch.l) / 64))) : (opts.cell ?? 0.5);
  const grid = patch ? patchGrid(patch.w, patch.l, patch.yaw, cell, patch.floor) : oceanGrid({ cell, size: opts.size ?? 64, rings: opts.rings ?? 10, skirt: opts.skirt ?? 60000 });
  // the open grid is all top: every vertex moves with the waves
  if (!patch) {
    grid.disp = new Float32Array(grid.vertexCount).fill(1);
    grid.face = new Float32Array(grid.vertexCount);
  }
  // the grid moves in steps of this ring's spacing: it and every ring inside
  // it always land on the same world points
  const step = cell * 2 ** (opts.snapLevel ?? 4);
  const geometry = new THREE.BufferGeometry();
  const setGeometry = (g) => {
    geometry.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
    geometry.setAttribute("aDisp", new THREE.BufferAttribute(g.disp, 1));
    geometry.setAttribute("aFace", new THREE.BufferAttribute(g.face, 1));
    geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
  };
  setGeometry(grid);
  const detailCount = opts.detail ?? 24;

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uWaves: { value: [] },
    uPhase: { value: [] },
    uDetail: { value: [] },
    uDetailPhase: { value: [] },
    // a patch's real spacing, which is wider than `cell` once its sides are capped (patchCounts)
    uCell: { value: patch ? grid.spacing : cell },
    // a patch's spacing is the same everywhere: no rings
    uInner: { value: patch ? 1e9 : grid.inner },
    uSunDir: { value: new THREE.Vector3(...DEFAULTS.sun.direction).normalize() },
    uSunColor: { value: new THREE.Color(DEFAULTS.sun.color) },
    uSunIntensity: { value: DEFAULTS.sun.intensity },
    uSunOn: { value: 1 },
    uSkyTop: { value: new THREE.Color(DEFAULTS.sky.top) },
    uSkyHorizon: { value: new THREE.Color(DEFAULTS.sky.horizon) },
    // the sky's cloud deck (cover, contrast, scale, base; cover 0: none), as the stage's atmosphere gives it
    uClouds: { value: new THREE.Vector4(0, 0, 1, 1) },
    uDeep: { value: new THREE.Color(DEFAULTS.deep) },
    uScatter: { value: new THREE.Color(DEFAULTS.scatter) },
    // under an overcast (a sun that casts no shadows) little light gets through a crest: the water holds the shore's darkness
    uScatterGain: { value: 1 },
    uFoamColor: { value: new THREE.Color(DEFAULTS.foam) },
    uFoamAt: { value: -1e9 },
    uRough: { value: 0 },
    uHs: { value: 0 },
    uNoiseOrigin: { value: new THREE.Vector2() },
    uWind: { value: new THREE.Vector2(0, 1) },
    // the shore in the water (setShore): its profile as a texture, its tint, the eye it was made for
    uShore: { value: null },
    uShoreTint: { value: new THREE.Color("#1a231d") },
    uShoreEye: { value: new THREE.Vector3() },
    uShoreNear: { value: 15 },
    uShoreReach: { value: 6000 },
    // shelter (setExposure): the exposure as a texture, and how a world (x, z) maps onto it
    uExposure: { value: null },
    uExpA: { value: new THREE.Vector4() },
    uExpB: { value: new THREE.Vector4() },
  };
  setColour(uniforms.uDeep.value, opts.deep);
  setColour(uniforms.uScatter.value, opts.scatter);
  setColour(uniforms.uFoamColor.value, opts.foam);

  const material = new THREE.ShaderMaterial({
    name: "ocean",
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    // a block is seen from inside it and from below too
    ...(patch ? { side: THREE.DoubleSide } : {}),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = patch ? "water-patch" : "ocean";
  mesh.frustumCulled = false;
  // the walker and physics ask the ocean for water, not the scene graph
  mesh.userData.noPick = true;
  mesh.raycast = () => {};

  let current = null;
  let packed = null;
  let detail = null;
  let detailPacked = null;

  /** Take a (new) sea: its waves, detail, roughness and foam line. Recompiles only when the number of waves changes. */
  function setSea(next) {
    current = next;
    const n = Math.max(1, next.components.length);
    packed = { waves: new Float32Array(4 * n), phases: new Float32Array(n) };
    const d = detailWaves(next, detailCount);
    detail = d.waves;
    // a shader array can't be empty: a zero wave stands in for none
    detailPacked = { waves: new Float32Array(4 * Math.max(1, detail.length)), phases: new Float32Array(Math.max(1, detail.length)) };
    detail.forEach((w, i) => {
      detailPacked.waves.set([w.k * w.dir[0], w.k * w.dir[1], w.slope, 0], i * 4);
    });
    const vec4s = (a) => Array.from({ length: a.length / 4 }, (_, i) => new THREE.Vector4(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]));
    uniforms.uWaves.value = vec4s(packed.waves);
    uniforms.uPhase.value = Array.from(packed.phases);
    uniforms.uDetail.value = vec4s(detailPacked.waves);
    uniforms.uDetailPhase.value = Array.from(detailPacked.phases);
    uniforms.uRough.value = d.rough;
    uniforms.uHs.value = next.stats?.hs ?? 0;
    const from = ((Number(next.wind?.from) || 0) * Math.PI) / 180;
    uniforms.uWind.value.set(-Math.sin(from), Math.cos(from));
    uniforms.uFoamAt.value = Math.max(-1e9, foamThreshold(next, opts.foamCoverage ?? next.stats?.whitecaps ?? 0));
    setDefines({ WAVES: n, DETAIL: Math.max(1, detail.length) });
  }
  /** Merge `more` into the material's defines (a key set to undefined is dropped), recompiling only when they change. */
  function setDefines(more) {
    const next = { ...(material.defines ?? {}), ...more };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    if (JSON.stringify(next) === JSON.stringify(material.defines ?? {})) return;
    material.defines = next;
    material.needsUpdate = true;
  }
  setSea(sea);

  /**
   * The shore in the water: a profile (`water.shore`'s, WATER.md) { key,
   * eye, data (bins × azimuths × [radians, km, km, radians]), azimuths, bins, near, reach }
   * and the shore's tint (sRGB hex), or null to draw the sky alone. The
   * texture is made again only when the profile's key or shape changes.
   */
  /**
   * Shelter: an exposure grid (`water.shore`'s exposure(from), WATER.md) {
   * key, n, data (n × n bytes, 255 the open sea, rows along v), origin
   * [x, z], u [x, z] and v [x, z] (unit: the grid's axes in the world),
   * size (m) }, or null for the open sea everywhere. Made again only when
   * its key changes.
   */
  let expKey = null;
  let expTex = null;
  function setExposure(grid) {
    const on = !!(grid?.data && grid.n > 1 && THREE.DataTexture);
    if (!on) {
      if (expKey !== null) {
        expKey = null;
        setDefines({ EXPOSURE: undefined });
      }
      return;
    }
    if (expKey === grid.key && expTex?.image.width === grid.n) return;
    const first = expKey === null;
    expKey = grid.key;
    if (!expTex || expTex.image.width !== grid.n) {
      expTex?.dispose();
      expTex = new THREE.DataTexture(Uint8Array.from(grid.data), grid.n, grid.n, THREE.RedFormat, THREE.UnsignedByteType);
      expTex.wrapS = expTex.wrapT = THREE.ClampToEdgeWrapping;
      expTex.magFilter = expTex.minFilter = THREE.LinearFilter;
      expTex.generateMipmaps = false;
    } else expTex.image.data.set(grid.data);
    expTex.needsUpdate = true;
    uniforms.uExposure.value = expTex;
    uniforms.uExpA.value.set(grid.origin[0], grid.origin[1], grid.u[0], grid.u[1]);
    uniforms.uExpB.value.set(grid.v[0], grid.v[1], 1 / grid.size, 1);
    if (first) setDefines({ EXPOSURE: "" });
  }
  let shoreKey = null;
  let shoreTex = null;
  function setShore(profile, tint) {
    const on = !!(profile?.data && tint && THREE.DataTexture);
    if (!on) {
      if (shoreKey !== null) {
        shoreKey = null;
        setDefines({ SHORE: undefined, SHORE_BINS: undefined });
      }
      return;
    }
    setColour(uniforms.uShoreTint.value, tint);
    const { azimuths: W, bins: H } = profile;
    if (shoreKey === profile.key && shoreTex?.image.width === W && shoreTex?.image.height === H) return;
    shoreKey = profile.key;
    const half = new Uint16Array(W * H * 4);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(profile.data[i]);
    if (!shoreTex || shoreTex.image.width !== W || shoreTex.image.height !== H) {
      shoreTex?.dispose();
      shoreTex = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
      shoreTex.wrapS = THREE.RepeatWrapping;
      shoreTex.wrapT = THREE.ClampToEdgeWrapping;
      shoreTex.magFilter = shoreTex.minFilter = THREE.LinearFilter;
      shoreTex.generateMipmaps = false;
    } else shoreTex.image.data.set(half);
    shoreTex.needsUpdate = true;
    uniforms.uShore.value = shoreTex;
    uniforms.uShoreEye.value.set(profile.eye[0], profile.eye[1], profile.eye[2]);
    uniforms.uShoreNear.value = profile.near;
    uniforms.uShoreReach.value = profile.reach;
    setDefines({ SHORE: 1, SHORE_BINS: H.toFixed(1) });
  }

  const origin = [0, 0, 0];

  /**
   * Bring the surface to time t for a camera at `cameraPosition`
   * (Vector3 or [x, y, z]). `sun` and `sky` take the stage's atmosphere
   * shapes ({ direction, color, intensity }, { top, horizon }); null turns
   * the sun off, undefined keeps what was set.
   */
  function update(t, cameraPosition, sun, sky) {
    let ox, oz;
    if (patch) {
      // a patch stands at its body's origin, at its level
      const p = Array.isArray(cameraPosition) ? cameraPosition : [cameraPosition.x, cameraPosition.y, cameraPosition.z];
      ox = p[0];
      oz = p[2];
      mesh.position.set(p[0], p[1], p[2]);
    } else {
      [ox, , oz] = snapOrigin(cameraPosition, step);
      mesh.position.set(ox, 0, oz);
    }
    origin[0] = ox;
    origin[2] = oz;
    waveUniforms(current.components, origin, t, packed);
    const ph = uniforms.uPhase.value;
    for (let i = 0; i < current.components.length; i++) {
      const v = uniforms.uWaves.value[i];
      v.set(packed.waves[i * 4], packed.waves[i * 4 + 1], packed.waves[i * 4 + 2], packed.waves[i * 4 + 3]);
      ph[i] = packed.phases[i];
    }
    const dph = uniforms.uDetailPhase.value;
    for (let i = 0; i < detail.length; i++) {
      const w = detail[i];
      dph[i] = wrap(w.k * (w.dir[0] * ox + w.dir[1] * oz) + w.phase - w.omega * t, TAU);
    }
    uniforms.uNoiseOrigin.value.set(wrap(ox, NOISE_PERIOD), wrap(oz, NOISE_PERIOD));
    if (sun === null) uniforms.uSunOn.value = 0;
    else if (sun) {
      uniforms.uSunOn.value = 1;
      uniforms.uScatterGain.value = scatterGain(sun);
      if (sun.direction) uniforms.uSunDir.value.set(sun.direction[0], sun.direction[1], sun.direction[2]).normalize();
      setColour(uniforms.uSunColor.value, sun.color);
      if (Number.isFinite(sun.intensity)) uniforms.uSunIntensity.value = sun.intensity;
    }
    if (sky) {
      setColour(uniforms.uSkyTop.value, sky.top ?? sky.horizon);
      setColour(uniforms.uSkyHorizon.value, sky.horizon ?? sky.top);
      const c = cloudsOf(sky.clouds);
      uniforms.uClouds.value.set(c?.cover ?? 0, c?.contrast ?? 0, c?.scale ?? 1, c?.base ?? 1);
    }
  }

  if (opts.sun !== undefined || opts.sky) update(0, [0, 0, 0], opts.sun, opts.sky);
  else update(0, [0, 0, 0]);

  /**
   * A patch turned, resized or deepened: its positions filled in place when
   * its counts are unchanged (a tank on a heeling hull turns every frame, and
   * allocates nothing), made again only when they change. The fade's spacing
   * follows the real one.
   */
  function setPatch(w, l, yaw = 0, floor = patch?.floor ?? null) {
    if (!patch) return;
    const same = patch.w === w && patch.l === l && patch.yaw === yaw && JSON.stringify(patch.floor) === JSON.stringify(floor);
    if (same) return;
    const { nx, nz, spacing } = patchCounts(w, l, cell);
    const solid = floor !== null && floor !== undefined;
    const pos = geometry.attributes.position;
    if (nx === grid.nx && nz === grid.nz && solid === grid.solid) {
      placePatch(pos.array, w, l, yaw, nx, nz, solid ? floorPlane(floor) : null, grid.rim);
      pos.needsUpdate = true;
    } else {
      const g = patchGrid(w, l, yaw, cell, floor);
      Object.assign(grid, g);
      setGeometry(g);
    }
    grid.spacing = spacing;
    uniforms.uCell.value = spacing;
    Object.assign(patch, { w, l, yaw, floor });
  }

  /** The body's own colour ({ deep?, scatter? }, colourOf), or null for the options' (else the defaults): set only when it changes. */
  let colourKey = null;
  function setBodyColour(c) {
    const key = c ? `${c.deep ?? ""}|${c.scatter ?? ""}` : "";
    if (key === colourKey) return;
    colourKey = key;
    uniforms.uDeep.value.set(DEFAULTS.deep);
    uniforms.uScatter.value.set(DEFAULTS.scatter);
    setColour(uniforms.uDeep.value, c?.deep ?? opts.deep);
    setColour(uniforms.uScatter.value, c?.scatter ?? opts.scatter);
  }

  return {
    object: mesh,
    update,
    setSea,
    setPatch,
    setColour: setBodyColour,
    setShore,
    setExposure,
    get origin() {
      return [...origin];
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      shoreTex?.dispose();
      expTex?.dispose();
      mesh.removeFromParent?.();
    },
  };
}
