// The ground's grain at the eye (README, "The look"): a terrain's ground is
// coloured at its nodes, metres apart, so close up the yard and the
// intertidal are flat planes of colour. Its GLB carries each vertex's grain
// (build.js groundGrain: the shore's cobble and rock in full, the yard's
// apron lightly, the water none) as the custom attribute _GRAIN, and the
// place's own extension (place.js) dresses the ground's material with this:
// two octaves of luminance noise in world space, ±12% at about 1.5 m and ±18%
// at about 8 m (the most: value noise is mostly well inside it; at ±8% and ±12%
// it didn't show), scaled by the grain, fading out from 150 to 300 m from the
// eye (beyond it the noise would only shimmer); and a fine one underfoot, ±12%
// at 0.35 m, fading out from 25 to 60 m (from a standing eye the 1.5 m octave
// is only a broad shading over the nearest few metres). A mesh without the
// attribute reads 0 for it, and is drawn as before.
//
// Pure: string edits on a three.js shader (onBeforeCompile's), no three.

/** The grain's octaves: [metres, ± share] each, and where it fades out (m from the eye). */
export const GRAIN_LOOK = Object.freeze({ octaves: Object.freeze([[1.5, 0.12], [8, 0.18]]), fade: Object.freeze([150, 300]), fine: Object.freeze({ metres: 0.35, share: 0.12, fade: Object.freeze([25, 60]) }) });

/**
 * Puddles and wet patches on a worked yard (a vertex's grain over 1: its
 * share over 1 is how much it takes them): a third, coarser noise (two
 * octaves, `cells` metres, weighted `weights`) over `at` is wet, about
 * `share` of the ground (grain.test.js measures it), `darker` darker and its
 * roughness down to `rough` (it reads wet), and the grain's octaves `grain`
 * times their share (a worked yard's ground is rougher than the land's), fading out from `fade[0]` to
 * `fade[1]` m from the eye.
 */
export const PUDDLES = Object.freeze({ cells: Object.freeze([4, 1.75]), weights: Object.freeze([0.6, 0.4]), offsets: Object.freeze([31, 47]), at: 0.652, edge: 0.03, share: 0.18, darker: 0.35, rough: 0.85, grain: 1.6, fade: Object.freeze([300, 600]) });

const F = Math.fround;
const fract = (x) => F(x - Math.floor(x));
/**
 * The shader's hash, in JS, in the GPU's 32-bit floats (Math.fround at
 * every step): a hash without sine (Dave Hoskins' hash12 shape) on the
 * cell's corner wrapped to 256. A sine of a dot product in the tens of
 * thousands (the hash this replaced) is as precise as the GPU's sin there,
 * which on a laptop's GPU isn't: its values came out correlated along lines
 * (a wavy ground) and the puddles' share far from what these tests measured.
 * Only multiplies, adds and fract of numbers under a few hundred here, so
 * the GPU and this agree to float rounding. Pure.
 */
export const grainHash = (x, y) => {
  const cx = F(x - 256 * Math.floor(x / 256)), cy = F(y - 256 * Math.floor(y / 256));
  let a = fract(F(cx * F(0.1031))), b = fract(F(cy * F(0.1031))), c = a; // p3 = fract(vec3(c.xyx) * .1031)
  const d = F(F(F(a * F(b + F(33.33))) + F(b * F(c + F(33.33)))) + F(c * F(a + F(33.33)))); // dot(p3, p3.yzx + 33.33)
  a = F(a + d), b = F(b + d), c = F(c + d);
  return fract(F(F(a + b) * c));
};
/** The shader's value noise, in JS. Pure. */
export function grainNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = grainHash(ix, iy), b = grainHash(ix + 1, iy), c = grainHash(ix, iy + 1), d = grainHash(ix + 1, iy + 1);
  const lo = a + (b - a) * ux, hi = c + (d - c) * ux;
  return lo + (hi - lo) * uy;
}
/** How wet the ground is at world (x, z), 0 to 1 (PUDDLES; the shader's sum). Pure. */
export function puddleAt(x, z, o = PUDDLES) {
  let n = 0;
  o.cells.forEach((c, q) => (n += o.weights[q] * grainNoise(x / c + o.offsets[q], z / c + o.offsets[q])));
  const t = Math.max(0, Math.min(1, (n - (o.at - o.edge)) / (2 * o.edge)));
  return t * t * (3 - 2 * t);
}

const VERTEX_HEAD = /* glsl */ `attribute float _grain;
varying float vGrain;
varying vec3 vGrainPos;
`;
const VERTEX_BODY = /* glsl */ `
  vGrain = _grain;
  vGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const f1 = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const FRAGMENT_HEAD = /* glsl */ `varying float vGrain;
varying vec3 vGrainPos;
float grainHash(vec2 c) {
  c = mod(c, 256.0);
  vec3 p3 = fract(vec3(c.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float grainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainHash(i), grainHash(i + vec2(1.0, 0.0)), u.x), mix(grainHash(i + vec2(0.0, 1.0)), grainHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;
const FRAGMENT_BODY = /* glsl */ `
  float grainWet = 0.0;
  float grainLight = 1.0;
  {
    float grainAt = min(vGrain, ${f1(PUDDLES.grain)}) * (1.0 - smoothstep(${f1(GRAIN_LOOK.fade[0])}, ${f1(GRAIN_LOOK.fade[1])}, length(vViewPosition)));
    if (grainAt > 0.0) {
      float g = ${GRAIN_LOOK.octaves.map(([m, a], q) => `${f1(a)} * (2.0 * grainNoise(vGrainPos.xz / ${f1(m)} + ${f1(q * 17)}) - 1.0)`).join(" + ")};
      // the fine octave (gravel and cobble underfoot), only near the eye: farther, it would shimmer
      g += ${f1(GRAIN_LOOK.fine.share)} * (2.0 * grainNoise(vGrainPos.xz / ${f1(GRAIN_LOOK.fine.metres)} + 29.0) - 1.0) * (1.0 - smoothstep(${f1(GRAIN_LOOK.fine.fade[0])}, ${f1(GRAIN_LOOK.fine.fade[1])}, length(vViewPosition)));
      grainLight *= 1.0 + grainAt * g;
    }
    // puddles where the grain is over 1 (a worked yard)
    if (vGrain > 1.0) {
      float pn = ${PUDDLES.cells.map((c, q) => `${f1(PUDDLES.weights[q])} * grainNoise(vGrainPos.xz / ${f1(c)} + ${f1(PUDDLES.offsets[q])})`).join(" + ")};
      grainWet = clamp(vGrain - 1.0, 0.0, 1.0) * smoothstep(${f1(PUDDLES.at - PUDDLES.edge)}, ${f1(PUDDLES.at + PUDDLES.edge)}, pn) * (1.0 - smoothstep(${f1(PUDDLES.fade[0])}, ${f1(PUDDLES.fade[1])}, length(vViewPosition)));
      grainLight *= 1.0 - ${f1(PUDDLES.darker)} * grainWet;
    }
  }`;
/** Where the grain is applied: to all the light the ground sends back, its sheen as well as its colour (from a standing eye the ground is seen at a grazing angle, where the overcast's sheen on a dark ground is as bright as its colour, and a grain on the colour alone was mostly washed out). */
const LIGHT_BODY = /* glsl */ `
  outgoingLight *= grainLight;
`;
/** Where a shader has no light anchor (another material): the grain on its colour. */
const DIFFUSE_BODY = /* glsl */ `
  diffuseColor.rgb *= grainLight;`;
/** A wet patch's roughness (the standard material's, after its own). */
const ROUGHNESS_BODY = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, ${f1(PUDDLES.rough)}, grainWet);`;

/** The anchors the edits go after: three's standard material's chunks. */
export const ANCHORS = Object.freeze({ vertex: "#include <project_vertex>", fragment: "#include <color_fragment>", roughness: "#include <roughnessmap_fragment>", light: "#include <opaque_fragment>" });

/**
 * A shader ({ vertexShader, fragmentShader }, as onBeforeCompile hands it)
 * with the grain in: its attribute and varyings declared at the head, set
 * after the vertex's projection, applied to the diffuse colour after the
 * vertex colour. Unchanged where an anchor is missing (another material), or
 * where it has the grain already. Returns whether it changed.
 */
export function addGrain(shader) {
  const { vertexShader: v, fragmentShader: f } = shader;
  if (typeof v !== "string" || typeof f !== "string" || v.includes("vGrainPos") || !v.includes(ANCHORS.vertex) || !f.includes(ANCHORS.fragment)) return false;
  shader.vertexShader = VERTEX_HEAD + v.replace(ANCHORS.vertex, ANCHORS.vertex + VERTEX_BODY);
  const lit = f.includes(ANCHORS.light);
  shader.fragmentShader = FRAGMENT_HEAD + f.replace(ANCHORS.fragment, ANCHORS.fragment + FRAGMENT_BODY + (lit ? "" : DIFFUSE_BODY)).replace(ANCHORS.roughness, ANCHORS.roughness + ROUGHNESS_BODY).replace(ANCHORS.light, LIGHT_BODY + ANCHORS.light);
  return true;
}

/**
 * Dress every material under `root` used by a mesh whose geometry has the
 * grain (attribute "_grain"): its onBeforeCompile adds it (chained to any it
 * had) and its program is keyed apart. → undo(), which puts every material
 * back as it was.
 */
export function dressGrain(root) {
  const done = new Map(); // material → its own onBeforeCompile and cache key
  root?.traverse?.((o) => {
    if (!o.isMesh || !o.geometry?.attributes?._grain) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m)) continue;
      const own = { onBeforeCompile: m.onBeforeCompile, customProgramCacheKey: m.customProgramCacheKey };
      done.set(m, own);
      m.onBeforeCompile = (shader, renderer) => {
        own.onBeforeCompile?.call(m, shader, renderer);
        addGrain(shader);
      };
      m.customProgramCacheKey = () => `${own.customProgramCacheKey?.call(m) ?? ""}|terrain-grain`;
      m.needsUpdate = true;
    }
  });
  return {
    count: done.size,
    undo() {
      for (const [m, own] of done) {
        m.onBeforeCompile = own.onBeforeCompile;
        m.customProgramCacheKey = own.customProgramCacheKey;
        m.needsUpdate = true;
      }
      done.clear();
    },
  };
}
