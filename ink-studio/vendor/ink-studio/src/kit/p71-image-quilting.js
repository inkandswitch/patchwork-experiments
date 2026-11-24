/* Planar swatches stitched along minimum-error overlap seams. */
(function (K) {
  const P = K.procedural,
    integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high,
    bounded = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  function raster(raw) {
    const { width, height, channels = 3, data } = raw ?? {};
    if (!integer(width,1,1024) || !integer(height,1,1024) || width * height > 350000 ||
      !integer(channels,1,4) || (!Array.isArray(data) && !ArrayBuffer.isView(data)) ||
      width * height * channels !== data.length)
      throw new Error('Raster samples need bounded dimensions and finite interleaved channels');
    for (const value of data) if (!bounded(value,-1e6,1e6)) throw new Error('Raster channels must be finite');
    return { width, height, channels, data };
  }
  function seam(major, minor, error) {
    let previous = new Float64Array(minor), next = new Float64Array(minor);
    const back = new Int16Array(major * minor), result = new Int16Array(major);
    for (let i = 0; i < major; i++) {
      for (let j = 0; j < minor; j++) {
        let from = j;
        if (j && previous[j-1] < previous[from]) from = j-1;
        if (j + 1 < minor && previous[j+1] < previous[from]) from = j+1;
        next[j] = previous[from] + error(i,j);
        back[i * minor + j] = from;
      }
      [previous,next] = [next,previous];
    }
    let at = 0;
    for (let j = 1; j < minor; j++) if (previous[j] < previous[at]) at = j;
    for (let i = major - 1; i >= 0; i--) {
      result[i] = at;
      at = back[i * minor + at];
    }
    return result;
  }

  function quilt(raw, {
    width, height, patch = 10, overlap = Math.floor(patch / 3), candidates = 56, tolerance = 0.12,
    seed = 0, maxWork = 24000000
  } = {}) {
    const source = raster(raw), { width: sw, height: sh, channels, data: from } = source;
    if (!integer(width,1,1024) || !integer(height,1,1024) || width * height > 350000 ||
      !integer(patch,2,Math.min(sw,sh,128)) || !integer(overlap,0,patch - 1) ||
      !integer(candidates,1,4096) || !bounded(tolerance,0,5) ||
      !Number.isSafeInteger(seed) || !integer(maxWork,1,120000000))
      throw new Error('Quilting needs a bounded output, patch size and overlap search');
    const spacing = patch - overlap, sourceWidth = sw - patch + 1, sourceHeight = sh - patch + 1,
      sourceCount = sourceWidth * sourceHeight, n = Math.min(sourceCount,candidates),
      data = new Float64Array(width * height * channels), coverage = new Uint8Array(width * height),
      patches = [], work = { comparisons: 0 }, dice = K.grow.dice(P.data.hash('image-quilting',seed));
    const stride = (width, length) => 1 + Math.max(0, Math.ceil((width - patch) / length)),
      cols = stride(width,spacing), rows = stride(height,spacing);
    let status = 'ok';
    tiles:
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = col * spacing, y = row * spacing, w = Math.min(patch,width - x), h = Math.min(patch,height - y),
        left = col ? Math.min(overlap,w) : 0, top = row ? Math.min(overlap,h) : 0,
        paired = left * h + top * (w - left), scored = [];
      function error(a,b,u,v) {
        const i = ((y+v) * width + x+u) * channels, j = ((b+v) * sw + a+u) * channels;
        let d = 0;
        for (let k = 0; k < channels; k++) d += (data[i+k] - from[j+k]) ** 2;
        return d;
      }
      const cost = (paired * n + h * left + w * top) * channels;
      if (work.comparisons + cost > maxWork) { status = 'budget'; break tiles; }
      work.comparisons += cost;
      let a = Math.floor(dice() * sourceWidth), b = Math.floor(dice() * sourceHeight), minimum = Infinity, chosenError = 0;
      if (paired) {
        // Seeded permutation prefix without replacement.
        const seen = new Map();
        for (let i = 0; i < n; i++) {
          const q = i + Math.floor(dice() * (sourceCount - i)), site = seen.get(q) ?? q;
          seen.set(q, seen.get(i) ?? i);
          const u = site % sourceWidth, v = Math.floor(site / sourceWidth);
          let ssd = 0;
          for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < (dy < top ? w : left); dx++) ssd += error(u,v,dx,dy);
          if (ssd < minimum) minimum = ssd;
          scored.push({ u,v,ssd });
        }
        const near = scored.filter(q => q.ssd <= minimum * (1 + tolerance) + 1e-12),
          picked = near[Math.floor(dice() * near.length)];
        [a,b] = [picked.u,picked.v];
        chosenError = picked.ssd;
      }
      const vertical = left ? seam(h,left,(v,u) => error(a,b,u,v)) : null,
        horizontal = top ? seam(w,top,(u,v) => error(a,b,u,v)) : null;
      for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
        const at = (y+v) * width + x+u;
        if (coverage[at] && ((vertical && u < vertical[v]) || (horizontal && v < horizontal[u]))) continue;
        const fromAt = ((b+v) * sw + a+u) * channels, to = at * channels;
        for (let k = 0; k < channels; k++) data[to+k] = from[fromAt+k];
        coverage[at] = 1;
      }
      patches.push({ at: [x,y], source: [a,b], error: chosenError });
    }
    return Object.freeze({ status, width, height, channels, data, coverage,
      patches: P.data.freeze(patches), work: Object.freeze(work) });
  }

  Object.assign(P.materials, { raster, quilt });
})(KIT);
