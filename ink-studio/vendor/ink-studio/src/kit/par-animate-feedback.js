/* Raster feedback uses the render graph's premultiplied sampling and decay rules. */
(function (P) {
  const { kinds, size, int, range, clamp, buffer, raster } = P.rasterSimSupport;
  kinds.feedback = (settings, recipe) => {
    const { frames, fps = 1 / recipe.dt, mode = 'hold', cuts = [], ...pass } = settings;
    if (Object.keys(pass).some(key => !['halfLife', 'filter', 'warp', 'gain', 'threshold', 'opacity'].includes(key)))
      throw new TypeError('Unknown raster feedback setting');
    if (!Array.isArray(frames) || !int(frames.length, 1, 512) || !Array.isArray(cuts) || cuts.length > 4096 ||
        !Array.from(cuts).every(t => range(t, 0, recipe.dt * recipe.maxTicks)))
      throw new RangeError('Feedback needs a bounded raster sequence and finite cuts');
    const dims = size(frames[0], 262144), { width: w, height: h } = dims, length = w * h * 4;
    if (length * frames.length > 16e6 || !frames.every(frame => frame.width === w && frame.height === h))
      throw new RangeError('Feedback frames need a common size within the raster budget');
    const image = frames.map(frame => FrameComposite.pixels({ w, h, rgba: P.raster.rgba(frame).data }).data);
    const node = RenderGraph.prepare({ passes: [{ ...pass, id: 'signal', type: 'feedback' }] }).passes[0];
    const { halfLife, warp, filter, gain, threshold, opacity } = node;
    const cutTicks = new Set(cuts.map(t => Math.ceil(t / recipe.dt - 1e-8)));
    let state = new Uint8Array(length);
    function step(tick, dt) {
      const elapsed = tick * dt, source = image[P.animationGraph.frameIndex(image.length, elapsed, { fps, mode }).index];
      const out = new Uint8Array(length), previous = new Float64Array(4), old = { data: state, w, h, filter };
      const decay = tick === 0 || cutTicks.has(tick) ? 0 : Math.pow(.5, dt / halfLife);
      const { pivot, blockSize, transform: [c, s], offset, wave, theta, frequency } =
        RenderGraph.feedbackMotion({ warp }, elapsed, dt, w, h);
      for (let iy = 0, q = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++, q += 4) {
        const x = ix + .5, y = iy + .5, u = x - pivot[0], v = y - pivot[1];
        const qx = blockSize ? (Math.floor(x / blockSize) + .5) * blockSize : x;
        const qy = blockSize ? (Math.floor(y / blockSize) + .5) * blockSize : y;
        const sx = pivot[0] + c * u + s * v - offset[0] - wave[0] * Math.sin(qy * frequency + theta);
        const sy = pivot[1] - s * u + c * v - offset[1] - wave[1] * Math.sin(qx * frequency + theta);
        previous.fill(0);
        if (decay && sx >= 0 && sy >= 0 && sx < w && sy < h) FrameComposite.sample(old, sx, sy, previous);
        let weight = gain;
        if (threshold && source[q + 3]) weight *= clamp((Math.max(source[q], source[q + 1], source[q + 2]) /
          source[q + 3] - threshold[0]) / (threshold[1] - threshold[0]));
        const remain = decay * (1 - source[q + 3] * weight / 255);
        for (let c = 0; c < 4; c++) out[q + c] = Math.min(255, Math.round(source[q + c] * weight + Math.floor(previous[c] * remain + 1e-5)));
      }
      state = out;
    }
    step(0, recipe.dt);
    return { work: w * h * 4, step, capture: () => ({ signal: state }),
      restore(saved) { state = Uint8Array.from(buffer(saved?.signal, length, 0, 255)); },
      frame() {
        const { rgb, alpha } = FrameComposite.straight(state, w, h, true), data = new Uint8Array(length);
        for (let p = 0; p < w * h; p++) data.set([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], Math.round(alpha[p] * opacity)], p * 4);
        return { value: raster(dims, data, 4) };
      }
    };
  };
})(KIT.procedural);
