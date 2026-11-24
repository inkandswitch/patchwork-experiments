// Ink's look over the whole scene: what an ink object gives the scene it's in
// when its `ink.scene` trait says `look: true`. After the stage has drawn its
// picture (api.afterRender), the picture goes through ink's own palette
// resolve (look-pass.js: upstream's POST_FS) at art resolution, in that
// world's palette and look, and is drawn back over the canvas, enlarged with
// nearest filtering. Everything in the scene, not only ink's splats, comes
// out as ink pixel art.
//
// The stage's canvas is multisampled, so its picture is first resolved into a
// full-size target by blitFramebuffer (the only way to read it), then
// shrunk to art size by a second, linear blit.

import { createLookPass } from "./look-pass.js";

const VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tLook;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;
void main() { outColor = vec4(texture(tLook, vUv).rgb, 1.0); }`;

/**
 * @param {{ THREE: any, toolkit: object }} o
 * @returns {{ draw(renderer, size, world, { px, time }): void, inspect(): object, dispose(): void }}
 */
export function createLookLayer({ THREE, toolkit }) {
  let pass = null, gl = null;
  let full = null, art = null, out = null;
  const stats = { frames: 0, size: [0, 0], ms: 0, error: null };

  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    uniforms: { tLook: { value: null } }, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const target = (rt, w, h, filter) => {
    if (rt && rt.width === w && rt.height === h) return rt;
    rt?.dispose();
    return new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: false, minFilter: filter, magFilter: filter, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: false,
    });
  };
  /** A target's GL framebuffer and texture, made by three on first use. */
  function glOf(renderer, rt) {
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.setRenderTarget(before);
    return { framebuffer: renderer.properties.get(rt).__webglFramebuffer, texture: renderer.properties.get(rt.texture).__webglTexture };
  }

  function draw(renderer, size, world, { px = 3, time = 0 } = {}) {
    if (!world) return;
    const t0 = performance.now();
    const ctx = renderer.getContext();
    if (gl !== ctx) {
      pass?.dispose();
      gl = ctx;
      pass = createLookPass(gl, toolkit);
    }
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    const W = buffer.x, H = buffer.y;
    const w = Math.max(1, Math.round(size.w / px)), h = Math.max(1, Math.round(size.h / px));
    full = target(full, W, H, THREE.LinearFilter);
    art = target(art, w, h, THREE.NearestFilter);
    out = target(out, w, h, THREE.NearestFilter);
    const F = glOf(renderer, full), A = glOf(renderer, art), O = glOf(renderer, out);
    try {
      renderer.resetState();
      // the canvas's picture, resolved, then shrunk to art size
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, F.framebuffer);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, F.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, A.framebuffer);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      pass.apply({ world, source: A.texture, width: w, height: h, target: { framebuffer: O.framebuffer, width: w, height: h }, time });
      stats.error = null;
    } catch (err) {
      if (stats.error !== String(err?.message ?? err)) console.error("[ink-studio] look", err);
      stats.error = String(err?.message ?? err);
      renderer.resetState();
      return;
    }
    renderer.resetState();
    // back over the canvas, enlarged
    material.uniforms.tLook.value = out.texture;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCamera);
    renderer.autoClear = autoClear;
    stats.frames++;
    stats.size = [w, h];
    stats.ms = +(performance.now() - t0).toFixed(2);
  }

  return {
    draw,
    inspect: () => ({ ...stats }),
    dispose() {
      pass?.dispose();
      for (const rt of [full, art, out]) rt?.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
