import { createRenderer } from './renderer.mjs';
import { createTransitionComposer } from './transition-composer.mjs';

export function createCameraAtlas(canvas, { toolkit, contextAttributes, ...definition } = {}) {
  const api = toolkit?.KIT?.cameraAtlas;
  if (!api) throw new TypeError('Camera atlases need the Ink Studio toolkit');
  const plan = api.prepare(definition);
  const renderer = createRenderer(canvas, { toolkit, contextAttributes, reuseOrder: false });
  const gl = canvas.getContext('webgl2'), { width, height } = plan;
  let composer, session, disposed = false;
  function available() {
    if (disposed) throw new Error('The camera atlas has been disposed');
    if (gl.isContextLost()) throw new Error('The camera atlas WebGL context is lost');
  }

  function withFramebuffers(draw) {
    const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    try {
      return draw();
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
    }
  }

  const restored = () => session.reset();
  try {
    composer = createTransitionComposer(gl);
    const atlas = composer.createTarget(width, height), scratch = composer.createTarget(1, 1);
    const clear = new Float32Array(4);
    session = api.create(plan, {
      clear() {
        available();
        const scissor = gl.isEnabled(gl.SCISSOR_TEST);
        const channels = gl.getParameter(gl.COLOR_WRITEMASK);
        try {
          withFramebuffers(() => {
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, atlas.framebuffer);
            gl.disable(gl.SCISSOR_TEST);
            gl.colorMask(true, true, true, true);
            gl.clearBufferfv(gl.COLOR, 0, clear);
          });
        } finally {
          gl.colorMask(...channels);
          if (scissor) gl.enable(gl.SCISSOR_TEST);
        }
      },
      capture(world, frame, tile) {
        available();
        withFramebuffers(() => {
          const { x, y, width: w, height: h } = tile;
          if (scratch.width !== w || scratch.height !== h) scratch.resize(w, h);
          renderer.render(world, { ...frame, target: scratch });
          const source = scratch.framebuffer, destination = atlas.framebuffer;
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
          gl.disable(gl.SCISSOR_TEST);
          gl.blitFramebuffer(0, 0, w, h, x, height - y - h, x + w, height - y, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        });
      },
      read({ x, y, width: w, height: h }) {
        available();
        const bottomUp = new Uint8Array(w * h * 4);
        withFramebuffers(() => {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, atlas.framebuffer);
          const buffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
          const packOptions = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS];
          const previous = packOptions.map(option => gl.getParameter(option));
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          try {
            packOptions.forEach((option, i) => gl.pixelStorei(option, i === 0 ? 4 : 0));
            gl.readPixels(x, height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
          } finally {
            packOptions.forEach((option, i) => gl.pixelStorei(option, previous[i]));
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
          }
        });
        const rgba = new Uint8Array(bottomUp.length), stride = w * 4;
        for (let row = 0; row < h; row++) {
          const start = (h - 1 - row) * stride;
          rgba.set(bottomUp.subarray(start, start + stride), row * stride);
        }
        return { w, h, rgba };
      },
      texture(context, tile) {
        if (context !== gl) return null;
        available();
        return { texture: withFramebuffers(() => atlas.texture), region: [tile.x, tile.y, tile.width, tile.height] };
      },
      dispose() {
        disposed = true;
        canvas.removeEventListener?.('webglcontextrestored', restored);
        renderer.dispose();
        composer.dispose();
      }
    });
    canvas.addEventListener?.('webglcontextrestored', restored);
    return Object.freeze({ ...session, get texture() {
      available();
      return withFramebuffers(() => atlas.texture);
    } });
  } catch (error) {
    renderer.dispose();
    composer?.dispose();
    throw error;
  }
}
