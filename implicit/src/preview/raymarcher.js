// WebGL2 host for the raymarching shader: program management (compiled in
// the background with KHR_parallel_shader_compile when available, keeping the
// last good program on screen meanwhile), on-demand rendering, and a lower
// resolution while the camera is moving. It survives a lost WebGL context:
// on webglcontextrestored it rebuilds its GL objects and recompiles the last
// field, and it tells the caller about both events.

import { VERTEX_SHADER, fragmentShader } from "./shader.js";
import { cameraBasis } from "./camera.js";

const UNIFORMS = [
  "uRes", "uEye", "uRight", "uUp", "uFwd", "uTanHalf", "uBMin", "uBMax", "uMode", "uSliceY",
  "uColor", "uBg", "uInk", "uWarm", "uCool", "uZero", "uMaxSteps",
];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onContextLost?: () => void, onContextRestored?: (recompiled: Promise<{ ok: boolean }>) => void }} [hooks]
 * @returns {null | ReturnType<typeof make>}  null when WebGL2 is unavailable
 */
export function createRaymarcher(canvas, hooks = {}) {
  let gl = null;
  try {
    gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  return make(canvas, gl, hooks);
}

function make(canvas, gl, hooks) {
  // GL objects: created here and again after a context restore
  let parallel = null;
  let buf = null;
  let vao = null;
  let vs = null;
  function initGL() {
    parallel = gl.getExtension("KHR_parallel_shader_compile");
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERTEX_SHADER);
    gl.compileShader(vs);
  }
  initGL();

  let current = null; // { program, loc }
  let pending = null; // { program, fs, resolve, glsl }
  let lastField = null; // the GLSL of the last setField, recompiled after a restore
  let frame = 0;
  let disposed = false;
  let lost = false;

  /** state the page sets */
  const state = {
    camera: null,
    bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    mode: 0,
    sliceY: 0,
    colors: { color: [0.8, 0.6, 0.4], bg: [1, 1, 1], ink: [0, 0, 0], warm: [0.9, 0.4, 0.2], cool: [0.2, 0.4, 0.9] },
    scale: 1, // resolution multiplier (lower while interacting)
    maxSteps: 220,
  };

  // preventDefault() tells the browser we will restore, so we must
  const onLost = (e) => {
    e.preventDefault();
    if (disposed) return;
    lost = true;
    // every GL object died with the context
    current = null;
    if (pending) {
      pending.resolve({ ok: false, error: "The WebGL context was lost." });
      pending = null;
    }
    hooks.onContextLost?.();
  };
  const onRestored = () => {
    if (disposed) return;
    lost = false;
    initGL();
    const recompiled = lastField != null ? setField(lastField) : Promise.resolve({ ok: true });
    hooks.onContextRestored?.(recompiled);
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  function finishLink(p) {
    const ok = gl.getProgramParameter(p.program, gl.LINK_STATUS);
    if (!ok) {
      const log = gl.getShaderInfoLog(p.fs) || gl.getProgramInfoLog(p.program) || "unknown error";
      gl.deleteProgram(p.program);
      gl.deleteShader(p.fs);
      p.resolve({ ok: false, error: log });
      return;
    }
    const loc = {};
    for (const u of UNIFORMS) loc[u] = gl.getUniformLocation(p.program, u);
    if (current) gl.deleteProgram(current.program);
    gl.deleteShader(p.fs);
    current = { program: p.program, loc };
    p.resolve({ ok: true, ms: performance.now() - p.t0 });
    render();
  }

  function poll() {
    if (!pending || disposed) return;
    const p = pending;
    if (parallel && !gl.getProgramParameter(p.program, parallel.COMPLETION_STATUS_KHR)) {
      requestAnimationFrame(poll);
      return;
    }
    pending = null;
    finishLink(p);
  }

  /**
   * Compile a new field. Resolves { ok, ms } or { ok: false, error } once the
   * program is ready; the old program stays on screen until then. Superseded
   * compiles resolve { ok: false, superseded: true }.
   */
  function setField(userGLSL) {
    lastField = userGLSL;
    if (disposed || lost) return Promise.resolve({ ok: false, error: "The WebGL context was lost." });
    if (pending) {
      pending.resolve({ ok: false, superseded: true });
      gl.deleteProgram(pending.program);
      gl.deleteShader(pending.fs);
      pending = null;
    }
    return new Promise((resolve) => {
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fragmentShader(userGLSL));
      gl.compileShader(fs);
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.bindAttribLocation(program, 0, "aPos");
      gl.linkProgram(program);
      pending = { program, fs, resolve, t0: performance.now() };
      if (parallel) requestAnimationFrame(poll);
      else poll();
    });
  }

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * state.scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * state.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return [w, h];
  }

  function render() {
    if (disposed || lost || !current || !state.camera) return false;
    const [w, h] = size();
    gl.viewport(0, 0, w, h);
    gl.useProgram(current.program);
    gl.bindVertexArray(vao);
    const L = current.loc;
    const { eye, right, up, fwd } = cameraBasis(state.camera);
    const c = state.colors;
    gl.uniform2f(L.uRes, w, h);
    gl.uniform3fv(L.uEye, eye);
    gl.uniform3fv(L.uRight, right);
    gl.uniform3fv(L.uUp, up);
    gl.uniform3fv(L.uFwd, fwd);
    gl.uniform1f(L.uTanHalf, Math.tan(state.camera.fovY / 2));
    gl.uniform3fv(L.uBMin, state.bounds.min);
    gl.uniform3fv(L.uBMax, state.bounds.max);
    gl.uniform1i(L.uMode, state.mode);
    gl.uniform1f(L.uSliceY, state.sliceY);
    gl.uniform3fv(L.uColor, c.color);
    gl.uniform3fv(L.uBg, c.bg);
    gl.uniform3fv(L.uInk, c.ink);
    gl.uniform3fv(L.uWarm, c.warm);
    gl.uniform3fv(L.uCool, c.cool);
    gl.uniform1i(L.uZero, Math.min(frame, 0));
    gl.uniform1i(L.uMaxSteps, state.maxSteps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frame++;
    return true;
  }

  function dispose() {
    disposed = true;
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    if (pending) pending.resolve({ ok: false, superseded: true });
    if (lost) return; // nothing left to delete
    if (current) gl.deleteProgram(current.program);
    gl.deleteShader(vs);
    gl.deleteBuffer(buf);
    gl.deleteVertexArray(vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return {
    state,
    setField,
    render,
    dispose,
    get ready() {
      return !!current;
    },
    get lost() {
      return lost;
    },
    get parallel() {
      return !!parallel;
    },
  };
}
