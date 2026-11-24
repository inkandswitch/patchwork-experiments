import { createResources } from './resources.mjs';
import { createTargets } from './targets.mjs';
import { builtinTransitionFragment, transitionFragment, transitionVertex } from './transition-shaders.mjs';

const defaultUniforms = {
  u_color: [0, 0, 0, 1], u_anchor: [0.5, 0.5], u_direction: [1, 0],
  u_cells: 8, u_bands: 12, u_steps: 6, u_strength: 0.65, u_seed: 27, u_softness: 0, u_width: 0.19
};
const fallback = { fragment1: 'from', fragment2: 'to' };
const samplerName = /^[_a-zA-Z][_a-zA-Z0-9]*$/;
const reservedSamplers = new Set(['u_from', 'u_to', 'u_mask']);
const activated = gl => gl.activeTexture(gl.TEXTURE0);

export function createTransitionComposer(canvasOrGl, { contextAttributes } = {}) {
  const gl = typeof canvasOrGl?.getContext === 'function'
    ? canvasOrGl.getContext('webgl2', { alpha: false, antialias: false, ...contextAttributes })
    : canvasOrGl;
  if (typeof gl?.createVertexArray !== 'function' || typeof gl?.texStorage2D !== 'function')
    throw new Error('Ink Studio transitions require a canvas with WebGL 2 or a WebGL 2 context');
  const canvas = gl.canvas;
  const sources = new Map(), programs = new Map(), shaders = new Map();
  const targets = new Map();
  let resources, empty, vao, disposed = false;

  function alive() {
    if (disposed) throw new Error('The Ink Studio transition composer has been disposed');
    if (gl.isContextLost()) throw new Error('The Ink Studio WebGL context is lost');
  }

  function clearGpu(release) {
    if (release) {
      for (const program of programs.values()) program.resources.dispose();
      for (const source of sources.values()) if (source.upload && source.texture) gl.deleteTexture(source.texture);
      for (const handle of targets.values()) handle.resources?.dispose();
      resources?.dispose();
    }
    programs.clear();
    for (const source of sources.values()) source.texture = null;
    for (const handle of targets.values()) handle.resources = handle.buffer = null;
    resources = empty = vao = null;
  }

  const lose = event => {
    event.preventDefault();
    // WebGL invalidates the old handles during a loss.
    clearGpu(false);
  };
  canvas.addEventListener?.('webglcontextlost', lose);

  function dimensions(width, height, viewport = true) {
    const textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const [limitX, limitY] = viewport ? gl.getParameter(gl.MAX_VIEWPORT_DIMS) : [textureLimit, textureLimit];
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > Math.min(textureLimit, limitX) || height > Math.min(textureLimit, limitY))
      throw new RangeError('Transition dimensions must fit the WebGL limits');
  }

  function targetBuffer(handle) {
    alive();
    if (!targets.has(handle.target)) throw new Error('The Ink Studio transition target has been disposed');
    if (!handle.buffer) {
      handle.resources = createResources(gl);
      try {
        activated(gl);
        handle.buffer = createTargets(gl, handle.resources).target();
        handle.buffer.resize(handle.width, handle.height);
      } catch (error) {
        handle.resources.dispose();
        handle.resources = handle.buffer = null;
        throw error;
      }
    }
    return handle.buffer;
  }

  function makeTarget(width, height) {
    alive();
    dimensions(width, height);
    const handle = { width, height };
    const target = handle.target = {
      get width() { return handle.width; },
      get height() { return handle.height; },
      get framebuffer() { return targetBuffer(handle).framebuffer; },
      get texture() { return targetBuffer(handle).textures[0]; },
      resize(w, h) {
        alive();
        dimensions(w, h);
        targetBuffer(handle).resize(w, h);
        handle.width = w;
        handle.height = h;
      },
      dispose() {
        handle.resources?.dispose();
        for (const [name, source] of sources) if (source.target === target) sources.delete(name);
        targets.delete(target);
      }
    };
    targets.set(target, handle);
    return target;
  }

  function bind(unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  function upload(source) {
    const { input } = source;
    activated(gl);
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not allocate a WebGL transition source');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const nearest = source.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const unpack = [
      [gl.UNPACK_ALIGNMENT, 1], [gl.UNPACK_FLIP_Y_WEBGL, false], [gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false],
      [gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE], [gl.UNPACK_ROW_LENGTH, 0],
      [gl.UNPACK_SKIP_PIXELS, 0], [gl.UNPACK_SKIP_ROWS, 0]
    ];
    const previous = unpack.map(([kind]) => gl.getParameter(kind));
    const unpackBuffer = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    try {
      for (const [kind, value] of unpack) gl.pixelStorei(kind, value);
      if (source.raw)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, input.width, input.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, input.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input);
      return texture;
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    } finally {
      for (let i = 0; i < unpack.length; i++) gl.pixelStorei(unpack[i][0], previous[i]);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, unpackBuffer);
    }
  }

  function removeSource(name) {
    const old = sources.get(name);
    if (old?.upload && old.texture) gl.deleteTexture(old.texture);
    return sources.delete(name);
  }

  function setSource(name, input, { origin, filter = 'nearest' } = {}) {
    alive();
    if (typeof name !== 'string' || !name || name === 'cover')
      throw new TypeError('Specify a named transition source other than the reserved cover');
    if (input == null) return removeSource(name);
    if (origin !== undefined && origin !== 'top-left' && origin !== 'bottom-left')
      throw new RangeError('A transition source origin is top-left or bottom-left');
    if (filter !== 'nearest' && filter !== 'linear')
      throw new RangeError('A transition source filter is nearest or linear');
    let source;
    if (targets.has(input)) {
      source = { target: input, flip: +(origin === 'top-left') };
    } else if (input.texture !== undefined) {
      if (!gl.isTexture(input.texture)) throw new TypeError('Use a texture from the transition composer context');
      source = { texture: input.texture, flip: +(origin === 'top-left') };
    } else {
      const raw = input.data !== undefined;
      const width = input.videoWidth ?? input.naturalWidth ?? input.displayWidth ?? input.width;
      const height = input.videoHeight ?? input.naturalHeight ?? input.displayHeight ?? input.height;
      dimensions(width, height, false);
      if (raw && (!(input.data instanceof Uint8Array || input.data instanceof Uint8ClampedArray) ||
          input.data.length !== width * height * 4))
        throw new TypeError('Raw transition sources require width × height × 4 RGBA bytes');
      source = { input, upload: true, raw, filter, flip: +(origin !== 'bottom-left') };
      source.texture = upload(source);
    }
    removeSource(name);
    sources.set(name, source);
  }

  function lookup(name, optional = false) {
    if (name === 'cover') return { texture: empty, flip: 0 };
    const source = sources.get(name) ?? (Object.hasOwn(fallback, name) ? sources.get(fallback[name]) : undefined);
    if (!source && optional) return { texture: empty, flip: 0 };
    if (!source) throw new Error('Missing transition source ' + name);
    if (source.target) return { texture: source.target.texture, flip: source.flip, exists: true };
    if (source.upload) source.texture ??= upload(source);
    if (!source.texture) throw new Error('Set transition source ' + name + ' again after context restoration');
    return { texture: source.texture, flip: source.flip, exists: true };
  }

  function clearProgram(name) {
    programs.get(name)?.resources.dispose();
    programs.delete(name);
  }

  function programFor(name) {
    if (!programs.has(name)) {
      const fragment = shaders.get(name) ?? builtinTransitionFragment(name);
      if (!fragment) throw new RangeError('Unknown transition shader ' + name);
      const owner = createResources(gl);
      try {
        programs.set(name, { resources: owner, program: owner.program(transitionVertex, fragment) });
      } catch (error) {
        owner.dispose();
        throw new Error('Transition shader ' + name + ': ' + error.message, { cause: error });
      }
    }
    return programs.get(name).program;
  }

  function draw(frame, { target = null, width = target?.width ?? canvas.width,
    height = target?.height ?? canvas.height, uniforms = {} } = {}) {
    alive();
    if (typeof frame?.shader !== 'string' || ![frame.value, frame.phase, frame.progress, frame.time].every(Number.isFinite))
      throw new TypeError('Draw expects a frame from a sampled transition');
    dimensions(width, height);
    if (target && (width !== target.width || height !== target.height))
      throw new RangeError('Transition draw dimensions must match the target');
    const framebuffer = target?.framebuffer ?? null;
    if (target && !gl.isFramebuffer(framebuffer))
      throw new TypeError('Transition target must use a framebuffer on the same WebGL context');
    if (!resources) {
      resources = createResources(gl);
      try {
        activated(gl);
        empty = resources.texture();
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
        vao = resources.allocate('VertexArray');
      } catch (error) {
        resources.dispose();
        resources = empty = vao = null;
        throw error;
      }
    }
    const program = programFor(frame.shader);
    const inputs = [lookup(frame.from), lookup(frame.to), lookup(frame.mask, true)];
    const samplers = {};
    const entries = Object.entries(frame.samplers ?? {});
    if (entries.length + 3 > gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))
      throw new RangeError('Transition shader uses too many texture units');
    for (const [uniform, value] of entries) {
      const { source, flipUniform } = typeof value === 'string' ? { source: value } : value;
      if (!samplerName.test(uniform) || reservedSamplers.has(uniform) ||
          flipUniform !== undefined && !samplerName.test(flipUniform))
        throw new TypeError('Invalid custom transition sampler ' + uniform);
      const input = lookup(source);
      samplers[uniform] = inputs.length;
      if (flipUniform) samplers[flipUniform] = input.flip;
      inputs.push(input);
    }
    if (!target) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    if (target) {
      const output = target.texture ?? gl.getFramebufferAttachmentParameter(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
      if (inputs.some(input => input.texture === output))
        throw new Error('A transition cannot sample its draw target');
    }
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.colorMask(true, true, true, true);
    inputs.forEach((input, unit) => {
      gl.bindSampler(unit, null);
      bind(unit, input.texture);
    });
    gl.bindVertexArray(vao);
    gl.useProgram(program.p);
    program.set({
      ...defaultUniforms, ...frame.uniforms, ...uniforms, ...samplers,
      u_from: 0, u_to: 1, u_mask: 2, u_size: [width, height],
      u_fromCover: +(frame.from === 'cover'), u_toCover: +(frame.to === 'cover'),
      u_hasMask: +!!inputs[2].exists, u_fromFlip: inputs[0].flip, u_toFlip: inputs[1].flip, u_maskFlip: inputs[2].flip,
      u_progress: frame.progress, u_phase: frame.phase, u_time: frame.time, u_value: frame.value
    });
    const dither = gl.isEnabled(gl.DITHER);
    gl.disable(gl.DITHER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (dither) gl.enable(gl.DITHER);
    activated(gl);
  }

  return {
    setSource, removeSource, createTarget: makeTarget, draw,
    registerShader(name, spec) {
      alive();
      if (typeof name !== 'string' || !name || builtinTransitionFragment(name))
        throw new TypeError('Use a new name for a custom transition shader');
      if (typeof spec?.source !== 'string' || !spec.source.trim() ||
          spec.uniforms !== undefined && typeof spec.uniforms !== 'string')
        throw new TypeError('A custom transition shader requires a GLSL body and optional uniform declarations');
      clearProgram(name);
      shaders.set(name, transitionFragment(spec));
    },
    unregisterShader(name) {
      alive();
      if (!shaders.delete(name)) return false;
      clearProgram(name);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearGpu(!gl.isContextLost());
      sources.clear();
      targets.clear();
      shaders.clear();
      canvas.removeEventListener?.('webglcontextlost', lose);
    }
  };
}
