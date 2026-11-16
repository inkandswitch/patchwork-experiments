// The ground's grain at the eye (README, "The look"): a terrain's ground is
// coloured at its nodes, metres apart, so close up the yard and the
// intertidal are flat planes of colour. Its GLB carries each vertex's grain
// (build.js groundGrain: the shore's cobble and rock in full, the yard's
// apron lightly, the water none) as the custom attribute _GRAIN, and the
// place's own extension (sky.js) dresses the ground's material with this:
// two octaves of luminance noise in world space, ±12% at about 1.5 m and ±18%
// at about 8 m (the most: value noise is mostly well inside it; at ±8% and ±12%
// it didn't show), scaled by the grain, fading out from 150 to 300 m from the
// eye (beyond it the noise would only shimmer). A mesh without the
// attribute reads 0 for it, and is drawn as before.
//
// Pure: string edits on a three.js shader (onBeforeCompile's), no three.

/** The grain's octaves: [metres, ± share] each, and where it fades out (m from the eye). */
export const GRAIN_LOOK = Object.freeze({ octaves: Object.freeze([[1.5, 0.12], [8, 0.18]]), fade: Object.freeze([150, 300]) });

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
  return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
}
float grainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainHash(i), grainHash(i + vec2(1.0, 0.0)), u.x), mix(grainHash(i + vec2(0.0, 1.0)), grainHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;
const FRAGMENT_BODY = /* glsl */ `
  {
    float grainAt = vGrain * (1.0 - smoothstep(${f1(GRAIN_LOOK.fade[0])}, ${f1(GRAIN_LOOK.fade[1])}, length(vViewPosition)));
    if (grainAt > 0.0) {
      float g = ${GRAIN_LOOK.octaves.map(([m, a], q) => `${f1(a)} * (2.0 * grainNoise(vGrainPos.xz / ${f1(m)} + ${f1(q * 17)}) - 1.0)`).join(" + ")};
      diffuseColor.rgb *= 1.0 + grainAt * g;
    }
  }`;

/** The anchors the edits go after: three's standard material's chunks. */
export const ANCHORS = Object.freeze({ vertex: "#include <project_vertex>", fragment: "#include <color_fragment>" });

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
  shader.fragmentShader = FRAGMENT_HEAD + f.replace(ANCHORS.fragment, ANCHORS.fragment + FRAGMENT_BODY);
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
