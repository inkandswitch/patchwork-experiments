/* Approximate nearest patch fields and mask-preserving exemplar synthesis. */
(function (K) {
  const P = K.procedural, M = P.materials,
    integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b,
    unit = n => Number.isFinite(n) && n >= 0 && n <= 1,
    clamp = (n,a,b) => Math.max(a,Math.min(b,n)),
    typed = v => Array.isArray(v) || ArrayBuffer.isView(v);

  function patchMatch(source, target, {
    radius = 3, iterations = 5, weights, seed = 0, initial, maxWork = 40000000
  } = {}) {
    const A = M.raster(source), B = M.raster(target), count = B.width * B.height, sourceCount = A.width * A.height,
      channels = A.channels, length = radius * 2 + 1;
    if (channels !== B.channels || !integer(radius,0,14) || !integer(iterations,0,40) ||
      (weights !== undefined && (!typed(weights) || weights.length !== count || !Array.from(weights).every(unit))) ||
      (initial !== undefined && (!typed(initial) || initial.length !== count ||
        !Array.from(initial).every(v => integer(v,0,sourceCount - 1)))) ||
      !Number.isSafeInteger(seed) || !integer(maxWork,1,180000000))
      throw new Error('Patch matching needs compatible rasters, weights and bounded search');
    const nearest = new Int32Array(count), costs = new Float64Array(count).fill(Infinity),
      rng = K.grow.dice(P.data.hash('patch-match',seed)), work = { comparisons: 0, proposals: 0, passes: 0 };
    for (let i = 0; i < count; i++) nearest[i] = initial ? initial[i] : Math.floor(rng() * sourceCount);
    const offsets = Array.from({ length: length * length }, (_,i) => [i % length - radius, Math.floor(i / length) - radius]);
    let status = 'ok', exhausted = false;
    function evaluate(i,x,y,sx,sy,initializing = false) {
      const next = sy * A.width + sx;
      if (!initializing && next === nearest[i]) return;
      if (work.comparisons + offsets.length * channels > maxWork) { exhausted = true; return; }
      work.comparisons += offsets.length * channels;
      work.proposals++;
      let loss = 0, total = 0;
      for (const [dx,dy] of offsets) {
        const u = x + dx, v = y + dy;
        if (u < 0 || u >= B.width || v < 0 || v >= B.height) continue;
        const a = clamp(sx+dx,0,A.width-1), b = clamp(sy+dy,0,A.height-1), to = v * B.width + u,
          w = weights?.[to] ?? 1;
        if (!w) continue;
        const A0 = (b * A.width + a) * channels, B0 = to * channels;
        for (let c = 0; c < channels; c++) loss += w * (A.data[A0+c] - B.data[B0+c]) ** 2;
        total += w;
      }
      const value = total ? loss / (total * channels) : 0;
      if (value < costs[i]) {
        nearest[i] = next;
        costs[i] = value;
      }
    }
    for (let i = 0; i < count && !exhausted; i++)
      evaluate(i,i%B.width,Math.floor(i/B.width),nearest[i]%A.width,Math.floor(nearest[i]/A.width),true);
    outer:
    for (let pass = 0; pass < iterations && !exhausted; pass++) {
      const sign = pass % 2 ? -1 : 1;
      for (let j = 0; j < count; j++) {
        const i = sign > 0 ? j : count - 1 - j, x = i % B.width, y = Math.floor(i / B.width);
        for (const [dx,dy] of [[sign,0],[0,sign]]) {
          if (x - dx < 0 || x - dx >= B.width || y - dy < 0 || y - dy >= B.height) continue;
          const n = nearest[(y-dy) * B.width + x-dx];
          evaluate(i,x,y,clamp(n%A.width+dx,0,A.width-1),clamp(Math.floor(n/A.width)+dy,0,A.height-1));
          if (exhausted) break outer;
        }
        for (let limit = Math.max(A.width,A.height); limit >= 1; limit = Math.floor(limit * 0.5)) {
          const m = nearest[i], u = m % A.width, v = Math.floor(m / A.width),
            west = Math.max(0,u-limit), east = Math.min(A.width-1,u+limit),
            north = Math.max(0,v-limit), south = Math.min(A.height-1,v+limit);
          const sx = west + Math.floor(rng() * (east-west+1)), sy = north + Math.floor(rng() * (south-north+1));
          evaluate(i,x,y,sx,sy);
          if (exhausted) break outer;
        }
      }
      work.passes++;
    }
    if (exhausted) status = 'budget';
    return Object.freeze({ status, width: B.width, height: B.height, sourceSize: Object.freeze([A.width,A.height]),
      nearest, costs, work: Object.freeze(work) });
  }

  function synthesize(source, target, {
    mask, radius = 2, iterations = 4, cycles = 4, guide = 0.16, blend = 'sample',
    seed = 0, maxWork = 140000000
  } = {}) {
    const A = M.raster(source), B = M.raster(target), channels = A.channels, total = B.width * B.height;
    if (channels !== B.channels || !typed(mask) || mask.length !== total ||
      !Array.from(mask).every(v => v === true || v === false || v === 0 || v === 1) ||
      !integer(cycles,1,12) || !integer(radius,0,14) || !integer(iterations,0,40) ||
      !unit(guide) || !['sample','average'].includes(blend) ||
      !integer(maxWork,1,180000000) || !Number.isSafeInteger(seed))
      throw new Error('Exemplar synthesis needs a binary writable mask and bounded controls');
    const rng = K.grow.dice(P.data.hash('patch-synthesis',seed)),
      weights = new Float64Array(total), unknown = [], work = { comparisons: 0, cycles: 0 },
      u = Math.floor(rng()*A.width), v = Math.floor(rng()*A.height),
      data = Float64Array.from(B.data);
    for (let i = 0; i < total; i++) {
      weights[i] = mask[i] ? guide : 1;
      if (!mask[i]) continue;
      unknown.push(i);
      const j = ((Math.floor(i/B.width)+v)%A.height*A.width+(i%B.width+u)%A.width)*channels;
      for (let c = 0; c < channels; c++) data[i*channels+c] = A.data[j+c];
    }
    const span = radius * 2 + 1, voteWork = unknown.length * span * span * channels;
    let status = 'ok', matched = null, initial;
    if (unknown.length && unknown.length < total && Math.floor(maxWork / 4) >= total * span * span * channels) {
      const known = Uint8Array.from(mask,v => Number(!v)),
        scout = patchMatch(A,B,{ radius,iterations:Math.max(1,Math.floor(iterations/2)),weights:known,
          seed, maxWork: Math.floor(maxWork / 4) });
      work.comparisons += scout.work.comparisons;
      if (scout.status === 'ok') {
        const nearestKnown = P.geometry.distanceTransform(known,{ size:[B.width,B.height] }).nearest,
          wrap = (x,n) => ((x%n)+n)%n;
        initial = scout.nearest.slice();
        for (const i of unknown) {
          const p = nearestKnown[i], from = scout.nearest[p],
            sx = wrap(from%A.width+i%B.width-p%B.width,A.width),
            sy = wrap(Math.floor(from/A.width)+Math.floor(i/B.width)-Math.floor(p/B.width),A.height),
            j = sy*A.width+sx;
          initial[i] = j;
          for (let c = 0; c < channels; c++) data[i*channels+c] = A.data[j*channels+c];
        }
      }
    }
    for (let cycle = 0; unknown.length && cycle < cycles; cycle++) {
      const available = maxWork - work.comparisons - voteWork;
      if (available <= 0) { status = 'budget'; break; }
      const result = patchMatch(A, { ...B, data }, { radius, iterations, seed: P.data.hash('cycle/' + cycle, seed),
        weights, initial: matched?.nearest ?? initial, maxWork: available });
      work.comparisons += result.work.comparisons;
      if (result.status !== 'ok') { status = 'budget'; break; }
      matched = result;
      work.comparisons += voteWork;
      for (const i of unknown) {
        const x = i % B.width, y = Math.floor(i / B.width), sums = new Float64Array(channels);
        let best = -Infinity, total = 0, pick = 0;
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          const px = x-dx, py = y-dy;
          if (px < 0 || px >= B.width || py < 0 || py >= B.height) continue;
          const q = py * B.width + px, m = matched.nearest[q],
            ax = clamp(m%A.width+dx,0,A.width-1), ay = clamp(Math.floor(m/A.width)+dy,0,A.height-1),
            j = (ay*A.width+ax)*channels,
            w = 1 / ((1 + matched.costs[q]) * (1 + 0.27*(dx*dx+dy*dy)));
          if (w > best) { best = w; pick = j; }
          if (blend === 'average') {
            total += w;
            for (let c = 0; c < channels; c++) sums[c] += A.data[j+c] * w;
          }
        }
        for (let c = 0; c < channels; c++) data[i*channels+c] = blend === 'sample' ? A.data[pick+c] : sums[c] / total;
      }
      work.cycles++;
    }
    return Object.freeze({ status, width: B.width, height: B.height, channels, data, matching: matched, work: Object.freeze(work) });
  }

  Object.assign(M, { patchMatch, synthesize });
})(KIT);
