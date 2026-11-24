// Drawing the atmosphere (./atmosphere.js decides what): the stage's lights,
// fog, and the sky, on the scene graph it is given.

import { BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Fog, HemisphereLight, Mesh, ShaderMaterial, Vector3, Vector4 } from "three";
import { LIGHTS, lighting } from "./atmosphere.js";

/**
 * The stage's own lights (LIGHTS), added to `scene` and, the headlight, to
 * `camera`. @returns {{ hemi: HemisphereLight, key: DirectionalLight, headlight: DirectionalLight }}
 */
export function createLights(scene, camera) {
  const hemi = new HemisphereLight(0xffffff, 0x3a3a3a, LIGHTS.hemisphere);
  const key = new DirectionalLight(0xffffff, LIGHTS.key);
  key.position.set(...LIGHTS.keyFrom);
  const headlight = new DirectionalLight(0xffffff, LIGHTS.headlight);
  headlight.position.set(0.5, 1, 0.8);
  scene.add(hemi, key);
  camera.add(headlight);
  // how much the environment map (made with the renderer) adds
  scene.environmentIntensity = LIGHTS.environment;
  return { hemi, key, headlight };
}

/**
 * Draw a clean atmosphere (or null: the stage's own look) on `scene`: its
 * lights (lighting()), its fog, and its sky, made the first time one is
 * asked for. @returns {Mesh | null} the sky mesh, `sky` or the one made
 */
export function drawAtmosphere(scene, lights, sky, atm) {
  const l = lighting(atm);
  lights.hemi.intensity = l.hemisphere.intensity;
  lights.hemi.color.set(l.hemisphere.sky);
  lights.hemi.groundColor.set(l.hemisphere.ground);
  lights.key.intensity = l.key.intensity;
  lights.key.color.set(l.key.color);
  lights.key.position.set(...l.key.from);
  lights.key.target.position.set(0, 0, 0);
  lights.key.target.updateMatrixWorld();
  lights.headlight.intensity = l.headlight;
  scene.environmentIntensity = l.environment;
  // one Fog, kept while there is fog: replacing it would recompile every material
  if (!atm?.fog) scene.fog = null;
  else if (scene.fog) {
    scene.fog.color.set(atm.fog.color);
    scene.fog.near = atm.fog.near;
    scene.fog.far = atm.fog.far;
  } else scene.fog = new Fog(atm.fog.color, atm.fog.near, atm.fog.far);
  if (!atm?.sky) {
    if (sky) sky.visible = false;
    return sky;
  }
  if (!sky) {
    sky = createSky();
    scene.add(sky);
  }
  const u = sky.material.uniforms;
  u.top.value.set(atm.sky.top);
  u.horizon.value.set(atm.sky.horizon);
  u.bottom.value.set(atm.sky.bottom);
  u.sunOn.value = atm.sun ? 1 : 0;
  if (atm.clouds) u.clouds.value.set(atm.clouds.cover, atm.clouds.contrast, atm.clouds.scale, atm.clouds.base);
  else u.clouds.value.set(0, 0, 1, 1);
  if (atm.sun) {
    u.sunDir.value.set(...atm.sun.direction);
    u.sunColor.value.set(atm.sun.color);
  }
  sky.visible = true;
  return sky;
}

/** The sky: one triangle over the whole screen, drawn first, never depth-written, picked or boxed. */
function createSky() {
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
      clouds: { value: new Vector4(0, 0, 1, 1) },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const sky = new Mesh(g, material);
  sky.name = "sky";
  sky.frustumCulled = false;
  sky.renderOrder = -1e9; // before everything
  sky.userData.noPick = true;
  sky.raycast = () => {};
  return sky;
}

// Each pixel turned back into the direction it looks along, shaded by
// height: horizon to top above, horizon to bottom below, and a soft sun
// where there is one. The direction is read on the near plane, never the
// far: the far plane's w is 1 + c where c is about −(1 + 2·near/far), so
// with near tiny against far it cancels to nothing in float, the direction
// comes out NaN and the whole sky black. A perspective camera looks from
// the origin through its near-plane point; an orthographic one straight
// along −z.
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 near = inverse(projectionMatrix) * vec4(position.xy, -1.0, 1.0);
  vec3 view = projectionMatrix[2][3] == -1.0 ? near.xyz / near.w : vec3(0.0, 0.0, -1.0);
  vDir = (inverse(viewMatrix) * vec4(view, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 bottom;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunOn;
uniform vec4 clouds; // cover, contrast, scale, base (cover 0: none)
varying vec3 vDir;
float cloudHash(vec2 c) {
  c = mod(c, 289.0);
  return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
}
float cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// a cloud deck over the sky (cloudAt in atmosphere.js is this, in JS): the luminance's factor and how white a scattered cloud makes it
vec2 cloudAt(vec3 d) {
  if (clouds.x <= 0.0 || d.y <= 0.0) return vec2(1.0, 0.0);
  vec2 p = d.xz * (clouds.w / max(d.y, 0.02)) / clouds.z;
  float n = cloudNoise(p) * 0.65 + cloudNoise(p * 2.3 + 17.0) * 0.35;
  float fade = smoothstep(0.03, 0.3, d.y);
  float w = clouds.x >= 1.0 ? n : smoothstep(1.0 - clouds.x - 0.12, 1.0 - clouds.x + 0.12, n);
  float shape = clouds.x >= 1.0 ? 2.0 * w - 1.0 : w * (2.0 * smoothstep(0.05, 0.35, d.y) - 1.0);
  return vec2(1.0 + clouds.y * shape * fade, clouds.x >= 1.0 ? 0.0 : w * fade * 0.6);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 c = d.y > 0.0 ? mix(horizon, top, pow(d.y, 0.55)) : mix(horizon, bottom, pow(-d.y, 0.4));
  vec2 cl = cloudAt(d);
  c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), cl.y) * cl.x;
  float s = max(dot(d, sunDir), 0.0);
  c += sunOn * sunColor * (smoothstep(0.9993, 0.9997, s) * 1.5 + pow(s, 16.0) * 0.3);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  // a gradient over a whole screen bands in 8 bits: half a level of noise either way
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}`;
