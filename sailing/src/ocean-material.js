// The sea's surface: a grid that follows the camera and a ShaderMaterial
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

import { prng } from "./wind.js";

const G = 9.81;
const TAU = Math.PI * 2;
// the noise's lattice repeats every 256 cells: the grid's origin is wrapped
// by this many metres so the noise stays put in the world
const NOISE_CELL = 3;
const NOISE_PERIOD = 256 * NOISE_CELL;

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
uniform vec4 uWaves[WAVES];
uniform float uPhase[WAVES];
uniform float uCell;
uniform float uInner;
varying vec2 vRest;
varying vec3 vWorld;
varying float vHeight;
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
  vec4 world = modelMatrix * vec4(p.x + d.x, d.y, p.y + d.z, 1.0);
  vRest = p;
  vWorld = world.xyz;
  vHeight = d.y;
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
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform vec3 uFoamColor;
uniform float uFoamAt;
uniform float uRough;
uniform float uHs;
uniform vec2 uNoiseOrigin;
uniform vec2 uWind;
varying vec2 vRest;
varying vec3 vWorld;
varying float vHeight;
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
vec3 sky(vec3 d) {
  float y = max(d.y, 0.0);
  return mix(uSkyHorizon, uSkyTop, pow(y, 0.55));
}

void main() {
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

  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  // a normal facing away from the eye (a far wave's back) is seen edge on
  if (dot(N, V) < 0.0) N = normalize(N - V * dot(N, V) * 1.01);
  float NV = max(dot(N, V), 1e-3);
  vec3 L = normalize(uSunDir);
  float sunUp = clamp(L.y * 4.0, 0.0, 1.0) * uSunOn;

  // reflection: the sky, as the stage draws it, with the sun's halo
  vec3 R = reflect(-V, N);
  vec3 refl = sky(R) + uSunOn * uSunColor * pow(max(dot(normalize(vec3(R.x, max(R.y, 0.0), R.z)), L), 0.0), 16.0) * 0.3;
  float fresnel = 0.02 + 0.98 * pow(1.0 - NV, 5.0);

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
  body += uScatter * pow(crest, 1.5) * (0.15 + 1.5 * toward * sunUp) * face;

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

/**
 * The sea's surface.
 * @param {any} THREE  the stage's three.js (api.THREE)
 * @param {ReturnType<import("./ocean.js").createOcean>} sea
 * @param {{ cell?: number, size?: number, rings?: number, skirt?: number, snapLevel?: number, detail?: number,
 *           sky?: { top?, horizon? }, sun?: { direction?, color?, intensity? } | null,
 *           deep?, scatter?, foam?, foamCoverage?: number }} [opts]
 * @returns {{ object: any, update(t: number, cameraPosition: any, sun?: object | null, sky?: object | null): void, setSea(sea: object): void, dispose(): void }}
 */
export function createOceanSurface(THREE, sea, opts = {}) {
  const cell = opts.cell ?? 0.5;
  const grid = oceanGrid({ cell, size: opts.size ?? 64, rings: opts.rings ?? 10, skirt: opts.skirt ?? 60000 });
  // the grid moves in steps of this ring's spacing: it and every ring inside
  // it always land on the same world points
  const step = cell * 2 ** (opts.snapLevel ?? 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(grid.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(grid.indices, 1));
  const detailCount = opts.detail ?? 24;

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uWaves: { value: [] },
    uPhase: { value: [] },
    uDetail: { value: [] },
    uDetailPhase: { value: [] },
    uCell: { value: cell },
    uInner: { value: grid.inner },
    uSunDir: { value: new THREE.Vector3(...DEFAULTS.sun.direction).normalize() },
    uSunColor: { value: new THREE.Color(DEFAULTS.sun.color) },
    uSunIntensity: { value: DEFAULTS.sun.intensity },
    uSunOn: { value: 1 },
    uSkyTop: { value: new THREE.Color(DEFAULTS.sky.top) },
    uSkyHorizon: { value: new THREE.Color(DEFAULTS.sky.horizon) },
    uDeep: { value: new THREE.Color(DEFAULTS.deep) },
    uScatter: { value: new THREE.Color(DEFAULTS.scatter) },
    uFoamColor: { value: new THREE.Color(DEFAULTS.foam) },
    uFoamAt: { value: -1e9 },
    uRough: { value: 0 },
    uHs: { value: 0 },
    uNoiseOrigin: { value: new THREE.Vector2() },
    uWind: { value: new THREE.Vector2(0, 1) },
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
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ocean";
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
    const defines = { WAVES: n, DETAIL: Math.max(1, detail.length) };
    if (material.defines?.WAVES !== defines.WAVES || material.defines?.DETAIL !== defines.DETAIL) {
      material.defines = defines;
      material.needsUpdate = true;
    }
  }
  setSea(sea);

  const origin = [0, 0, 0];

  /**
   * Bring the surface to time t for a camera at `cameraPosition`
   * (Vector3 or [x, y, z]). `sun` and `sky` take the stage's atmosphere
   * shapes ({ direction, color, intensity }, { top, horizon }); null turns
   * the sun off, undefined keeps what was set.
   */
  function update(t, cameraPosition, sun, sky) {
    const [ox, , oz] = snapOrigin(cameraPosition, step);
    origin[0] = ox;
    origin[2] = oz;
    mesh.position.set(ox, 0, oz);
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
      if (sun.direction) uniforms.uSunDir.value.set(sun.direction[0], sun.direction[1], sun.direction[2]).normalize();
      setColour(uniforms.uSunColor.value, sun.color);
      if (Number.isFinite(sun.intensity)) uniforms.uSunIntensity.value = sun.intensity;
    }
    if (sky) {
      setColour(uniforms.uSkyTop.value, sky.top ?? sky.horizon);
      setColour(uniforms.uSkyHorizon.value, sky.horizon ?? sky.top);
    }
  }

  if (opts.sun !== undefined || opts.sky) update(0, [0, 0, 0], opts.sun, opts.sky);
  else update(0, [0, 0, 0]);

  return {
    object: mesh,
    update,
    setSea,
    get origin() {
      return [...origin];
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent?.();
    },
  };
}
