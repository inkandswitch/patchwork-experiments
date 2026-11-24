export const frameCamera = Symbol('rendered camera');

export function captureFrameCamera(frame, receive) {
  return { [frameCamera](camera) {
    receive(camera);
    frame[frameCamera]?.(camera);
  } };
}

export const layerSamplingGLSL = `
vec4 layerTexel(sampler2D image, ivec2 pos, ivec2 size, bool topDown) {
  if (!topDown) pos.y = size.y - 1 - pos.y;
  return texelFetch(image, pos, 0);
}

vec4 layerRegionAt(sampler2D image, vec2 pixel, vec2 outputSize, ivec4 region, bool topDown, bool linear) {
  ivec2 size = region.zw, origin = region.xy, full = textureSize(image, 0);
  vec2 uv = pixel * vec2(size) / outputSize;
  if (!linear) return layerTexel(image, origin + clamp(ivec2(uv), ivec2(0), size - 1), full, topDown);
  vec2 pos = clamp(uv - 0.5, vec2(0.0), vec2(size) - 1.0);
  ivec2 p = ivec2(pos), q = min(p + 1, size - 1);
  vec2 f = fract(pos);
  return mix(mix(layerTexel(image, origin + p, full, topDown), layerTexel(image, origin + ivec2(q.x, p.y), full, topDown), f.x),
    mix(layerTexel(image, origin + ivec2(p.x, q.y), full, topDown), layerTexel(image, origin + q, full, topDown), f.x), f.y);
}

vec4 layerAt(sampler2D image, vec2 pixel, vec2 outputSize, bool topDown, bool linear) {
  return layerRegionAt(image, pixel, outputSize, ivec4(ivec2(0), textureSize(image, 0)), topDown, linear);
}

vec4 placedLayerAt(sampler2D image, vec2 pixel, vec4 dest, ivec4 region, bool topDown, bool linear) {
  vec2 position = pixel - dest.xy;
  if (any(lessThan(position, vec2(0.0))) || any(greaterThanEqual(position, dest.zw))) return vec4(0.0);
  return layerRegionAt(image, position, dest.zw, region, topDown, linear);
}
`;

const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_layer;
uniform vec2 u_outputSize;
uniform vec4 u_dest;
uniform ivec4 u_region;
uniform bool u_topDown, u_linear, u_opaque;
uniform float u_opacity;
out vec4 color;

${layerSamplingGLSL}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, u_outputSize.y - gl_FragCoord.y);
  color = placedLayerAt(u_layer, pixel, u_dest, u_region, u_topDown, u_linear);
  if (u_opaque) color.a = 1.0;
  color *= u_opacity;
}`;

export function createFrameComposite(gl, { program, resources, target, textureUnit, fullscreen }) {
  const shader = program(fragment);
  const base = target(), uploaded = resources.texture();
  let layerWidth = 0, layerHeight = 0;
  return function composite(world, frame, plan, layers, output, present) {
    const { w, h } = plan;
    base.resize(plan.world.w, plan.world.h);
    present(world, frame, plan.world.w, plan.world.h, base.framebuffer);
    const overlays = typeof layers === 'function' ? layers() : layers;
    if (!output) {
      if (gl.canvas.width !== w) gl.canvas.width = w;
      if (gl.canvas.height !== h) gl.canvas.height = h;
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    textureUnit(0, base.textures[0]);
    fullscreen(shader, output, w, h, { u_layer: 0, u_outputSize: [w, h], u_topDown: false,
      u_opaque: true, u_dest: [0, 0, w, h], u_region: [0, 0, base.width, base.height], u_linear: plan.world.filter === 'linear', u_opacity: 1 });

    if (overlays.length) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      for (const layer of overlays) {
        if (layer.gpu) textureUnit(0, layer.gpu.texture);
        else {
          textureUnit(0, uploaded);
          if (layerWidth !== layer.w || layerHeight !== layer.h) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, layer.w, layer.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, layer.data);
            layerWidth = layer.w;
            layerHeight = layer.h;
          } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, layer.w, layer.h, gl.RGBA, gl.UNSIGNED_BYTE, layer.data);
          }
        }
        gl.blendFuncSeparate(gl.ONE, layer.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        fullscreen(shader, output, w, h, { u_topDown: !layer.gpu, u_opaque: false, u_dest: layer.dest,
          u_region: layer.gpu?.region ?? [0, 0, layer.w, layer.h], u_linear: layer.filter === 'linear', u_opacity: layer.opacity });
      }
      gl.disable(gl.BLEND);
    }
  };
}
