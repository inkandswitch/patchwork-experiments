export function createTargets(gl, resources) {
  const textureUnit = (unit, texture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  function target(colors = 1, { integer = false, depth = false } = {}) {
    const framebuffer = resources.allocate('Framebuffer');
    const textures = Array.from({ length: colors }, () => resources.texture());
    let depthBuffer = depth ? resources.allocate('Renderbuffer') : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const attachments = textures.map((texture, i) => {
      const attachment = gl.COLOR_ATTACHMENT0 + i;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture, 0);
      return attachment;
    });
    gl.drawBuffers(attachments);
    if (depthBuffer) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let w = 0, h = 0;
    return {
      framebuffer, textures,
      get width() { return w; },
      get height() { return h; },
      ensureDepth() {
        if(depthBuffer)return;
        depthBuffer=resources.allocate('Renderbuffer');
        gl.bindRenderbuffer(gl.RENDERBUFFER,depthBuffer);
        if(w&&h)gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depthBuffer);
      },
      resize(width, height) {
        if (w === width && h === height) return;
        for (const texture of textures) {
          textureUnit(0, texture);
          if (integer) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32I, width, height, 0, gl.RGBA_INTEGER, gl.INT, null);
          else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        if (depthBuffer) {
          gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('Ink Studio could not build a complete WebGL render target');
        w = width;
        h = height;
      }
    };
  }

  // The shader addresses an entire sample in one row. An incomplete final row
  // is zero-padded without copying the complete scene on every upload.
  function table(width, unit, maxSize) {
    const texture = resources.texture();
    const stride = width * 4;
    const tail = new Float32Array(stride);
    let rows = 0;
    function upload(values, count = values.length, dirtyRows) {
      const next = Math.max(1, Math.ceil(count / stride));
      if (next > maxSize) throw new RangeError('Ink Studio data exceeds the WebGL texture size limit');
      textureUnit(unit, texture);
      if (next !== rows) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, next, 0, gl.RGBA, gl.FLOAT, null);
        rows = next;
        dirtyRows = undefined;
      }
      const full = Math.floor(count / stride);
      if (dirtyRows !== undefined) {
        for (const row of dirtyRows) {
          const start = row * stride;
          if (row < full) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, width, 1, gl.RGBA, gl.FLOAT, values, start);
          else {
            tail.fill(0);
            tail.set(values.subarray(start, count));
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, width, 1, gl.RGBA, gl.FLOAT, tail);
          }
        }
        return;
      }
      if (full) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, full, gl.RGBA, gl.FLOAT, values);
      if (full < next) {
        tail.fill(0);
        tail.set(values.subarray(full * stride, count));
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, full, width, 1, gl.RGBA, gl.FLOAT, tail);
      }
    }
    return { bind: (at = unit) => textureUnit(at, texture), upload };
  }

  return { target, table, textureUnit };
}
