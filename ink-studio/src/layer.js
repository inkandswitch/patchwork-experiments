// One ink world drawn into the stage, by ink's own renderer, with depth.
//
// The layer is a full-screen triangle in the stage's world group. Just before
// three draws it (onBeforeRender, with the very camera of this pass), ink
// draws the world in the stage's own WebGL context into a two-attachment
// target at art resolution (canvas size / px), in its `transparent` mode
// (vendor/PATCHES.md): attachment 0 its colour, alpha = its pixel or not;
// attachment 1 that pixel's depth, packed. The triangle then samples both
// with nearest filtering, discards what isn't ink's, and writes gl_FragDepth,
// so splats and the scene's other objects hide each other per pixel.
//
// Ink and three share the context: three's state is reset before and after
// ink draws, and its render target put back. Each layer has its own ink
// renderer: ink keeps one world's buffers per renderer, so two worlds through
// one would upload in full every frame.

import { createRenderer } from "../vendor/ink-studio/src/webgl/renderer.mjs";
import { inkCamera } from "./layer-camera.js";
import { worldBounds } from "./proxy.js";

const VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRange;      // ink's depth window, ink units
uniform float uScale;     // the object's scale: ink units → stage units
uniform mat4 uProjection; // the stage camera's projection
uniform float uOn;
in vec2 vUv;
layout(location = 0) out highp vec4 inkColor;
void main() {
  if (uOn < 0.5) discard;
  vec4 c = texture(tColor, vUv);
  if (c.a < 0.5) discard;
  vec4 d = texture(tDepth, vUv);
  // where ink gave no depth (ground and soft splats write none: vendor/PATCHES.md), the back of its window
  float n = d.a > 0.5 ? dot(floor(d.rgb * 255.0 + 0.5), vec3(1.0, 256.0, 65536.0)) / 16777215.0 : 1.0;
  float z = -(uRange.x + n * (uRange.y - uRange.x)) * uScale;
  vec4 clip = uProjection * vec4(0.0, 0.0, z, 1.0);
  gl_FragDepth = clamp(0.5 * clip.z / clip.w + 0.5, 0.0, 1.0);
  inkColor = vec4(c.rgb, 1.0);
}`;

/**
 * @param {{ THREE: any, toolkit: object, root: () => any }} o
 *   root(): the object's three node now (its matrixWorld places the world), or null
 */
export function createLayer({ THREE, toolkit, root }) {
  let world = null, bounds = null, fresh = true, time = 0;
  let px = 3;
  let canvas = null, ink = null;
  let target = null;
  const stats = { frames: 0, skipped: 0, size: [0, 0], ms: 0, error: null };
  const size = new THREE.Vector2();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uRange: { value: new THREE.Vector2(1, 2) },
      uScale: { value: 1 },
      uProjection: { value: new THREE.Matrix4() },
      uOn: { value: 0 },
    },
    depthTest: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.noPick = true;
  mesh.raycast = () => {};
  mesh.name = "ink-layer";

  function targetOf(w, h) {
    if (target && target.width === w && target.height === h) return target;
    target?.dispose();
    target = new THREE.WebGLRenderTarget(w, h, {
      count: 2,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
    });
    material.uniforms.tColor.value = target.textures[0];
    material.uniforms.tDepth.value = target.textures[1];
    return target;
  }

  mesh.onBeforeRender = (renderer, _scene, camera) => {
    material.uniforms.uOn.value = 0;
    const node = root();
    if (!world || !bounds || !node || !camera.isPerspectiveCamera) return void stats.skipped++;
    const cam = inkCamera({
      view: camera.matrixWorldInverse.elements,
      projection: camera.projectionMatrix.elements,
      object: node.matrixWorld.elements,
      bounds,
    });
    if (!cam) return void stats.skipped++;
    if (canvas !== renderer.domElement) {
      ink?.dispose();
      canvas = renderer.domElement;
      // the canvas already has three's webgl2 context: getContext gives ink that same one
      ink = createRenderer(canvas, { toolkit });
    }
    renderer.getSize(size);
    const w = Math.max(1, Math.round(size.x / px)), h = Math.max(1, Math.round(size.y / px));
    const rt = targetOf(w, h);
    const before = renderer.getRenderTarget();
    const t0 = performance.now();
    try {
      renderer.setRenderTarget(rt); // makes its framebuffer and sets both draw buffers
      const framebuffer = renderer.properties.get(rt).__webglFramebuffer;
      renderer.resetState();
      const frame = {
        target: { framebuffer, width: w, height: h },
        width: w,
        height: h,
        time,
        transparent: true,
        viewMatrix: cam.viewMatrix,
        projectionMatrix: cam.projectionMatrix,
        depthRange: cam.depthRange,
      };
      if (!fresh) {
        const rows = world.anim?.rows, changed = [];
        if (rows) for (let i = 0; i < rows.length; i++) if (rows[i]) changed.push(i);
        frame.changedRows = changed;
      }
      ink.render(world, frame);
      world.anim?.rows?.fill(0);
      fresh = false;
      stats.error = null;
      material.uniforms.uOn.value = 1;
    } catch (err) {
      if (stats.error !== String(err?.message ?? err)) console.error("[ink-studio] layer", err);
      stats.error = String(err?.message ?? err);
    } finally {
      renderer.resetState();
      renderer.setRenderTarget(before);
    }
    material.uniforms.uRange.value.set(cam.depthRange[0], cam.depthRange[1]);
    material.uniforms.uScale.value = cam.scale;
    material.uniforms.uProjection.value.copy(camera.projectionMatrix);
    stats.frames++;
    stats.size = [w, h];
    stats.ms = +(performance.now() - t0).toFixed(2);
  };

  return {
    mesh,
    setWorld(next) {
      world = next;
      bounds = next ? worldBounds(next) : null;
      fresh = true;
    },
    setTime(t) {
      time = t;
    },
    setOptions(o) {
      if (o?.px) px = o.px;
    },
    inspect: () => ({ ...stats, px }),
    dispose() {
      geometry.dispose();
      material.dispose();
      target?.dispose();
      ink?.dispose();
      ink = null;
      canvas = null;
    },
  };
}
