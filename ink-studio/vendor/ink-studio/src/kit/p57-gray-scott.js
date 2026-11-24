/* Shared integration for one-shot and retained Gray–Scott fields. */
const GrayScott = (() => {
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const fraction = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const saturate = n => Math.max(0, Math.min(1, n));
  const check = (ok, message) => { if (!ok) throw new RangeError('Gray–Scott: ' + message); };

  function create(points, links, {
    dt = 1, du = .8, dv = .39, feed = .0367, kill = .0649, spots, initial,
    seed = 0, maxWork = 34000000
  } = {}, lengths) {
    check(Array.isArray(points) && integer(points.length, 1, 180000) &&
      Array.isArray(links) && links.length <= points.length * 12 &&
      fraction(dt) && dt > 0 && fraction(du) && fraction(dv) &&
      [feed, kill].every(value => fraction(value) || typeof value === 'function') &&
      (initial === undefined || typeof initial === 'function') &&
      (spots === undefined || Array.isArray(spots) && spots.length <= points.length && spots.every(i => integer(i, 0, points.length - 1))) &&
      Number.isSafeInteger(seed) && integer(maxWork, 1, 85000000),
    'expected a bounded domain, seed and stable integration controls');
    const n = points.length, work = n + 2 * links.length;
    const offsets = new Uint32Array(n + 1), count = new Float64Array(n);
    const ids = new Uint32Array(links.length * 2), weights = new Float64Array(ids.length);
    const distances = lengths && new Float64Array(ids.length);
    for (const link of links) {
      check(Array.isArray(link) && link.length >= 2 && link.length <= 3 &&
        integer(link[0], 0, n - 1) && integer(link[1], 0, n - 1) && link[0] !== link[1] &&
        (link[2] === undefined || Number.isFinite(link[2]) && link[2] > 0 && link[2] <= 1e6),
      'surface links need distinct indices and positive weights');
      const [a, b, weight = 1] = link;
      offsets[a + 1]++; offsets[b + 1]++;
      count[a] += weight; count[b] += weight;
    }
    for (let i = 1; i <= n; i++) offsets[i] += offsets[i - 1];
    const cursor = offsets.slice();
    links.forEach(([a, b, weight = 1], edge) => {
      const i = cursor[a]++, j = cursor[b]++;
      ids[i] = b; ids[j] = a;
      weights[i] = weights[j] = weight;
      if (distances) distances[i] = distances[j] = lengths[edge];
    });
    const dice = KIT.grow.dice(KIT.procedural.data.hash('reaction-diffusion', seed));
    const seeded = new Set(spots ?? [Math.floor(n / 2)]);
    const start = Object.fromEntries(['u', 'v', 'feed', 'kill'].map(name => [name, new Float64Array(n)]));
    for (const [i, p] of points.entries()) {
      const f = typeof feed === 'function' ? feed(p, i) : feed;
      const k = typeof kill === 'function' ? kill(p, i) : kill;
      const pair = initial ? initial(p, i) : seeded.has(i) ? [.48 + .04 * dice(), .24 + .025 * dice()] : [1, 0];
      check(fraction(f) && fraction(k) && Array.isArray(pair) && pair.length === 2 && fraction(pair[0]) && fraction(pair[1]),
        'field values must be between zero and one');
      [start.u[i], start.v[i]] = pair;
      start.feed[i] = f;
      start.kill[i] = k;
    }
    let channels = start, tick = 0, revision = 0, busy = false;
    const available = () => check(!busy, 'cannot change the field within a step');
    function commit(data, nextTick = tick) {
      available();
      channels = data; tick = nextTick; revision++;
    }
    function advance(steps, transport) {
      available();
      check(integer(steps, 0, 20000) && tick + steps <= Number.MAX_SAFE_INTEGER && Number.isFinite((tick + steps) * dt),
        'expected a bounded number of steps');
      let remaining = maxWork - work * steps;
      check(remaining >= 0, 'exceeds the integration budget');
      if (!steps) return tick;
      const { feed, kill } = channels;
      let u = channels.u.slice(), v = channels.v.slice(), nextU = new Float64Array(n), nextV = new Float64Array(n);
      const spend = amount => {
        remaining -= amount;
        check(remaining >= 0, 'advection exceeds the integration budget');
      };
      busy = true;
      try {
        for (let step = 0; step < steps; step++) {
          for (let i = 0; i < n; i++) {
            let sumU = 0, sumV = 0;
            for (let j = offsets[i]; j < offsets[i + 1]; j++) {
              sumU += u[ids[j]] * weights[j];
              sumV += v[ids[j]] * weights[j];
            }
            const a = u[i], b = v[i], lapU = count[i] ? sumU / count[i] - a : 0,
              lapV = count[i] ? sumV / count[i] - b : 0, reaction = a * b * b;
            nextU[i] = saturate(a + dt * (du * lapU - reaction + feed[i] * (1 - a)));
            nextV[i] = saturate(b + dt * (dv * lapV + reaction - (feed[i] + kill[i]) * b));
          }
          [u, nextU] = [nextU, u];
          [v, nextV] = [nextV, v];
          transport?.(u, v, nextU, nextV, tick + step, dt, spend);
        }
      } finally { busy = false; }
      commit({ u, v, feed, kill }, tick + steps);
      return tick;
    }
    return { advance, available, commit, reset: () => commit(start, 0), dt, du, dv, work,
      offsets, ids, distances, get channels() { return channels; }, get tick() { return tick; }, get revision() { return revision; } };
  }
  return Object.freeze({ create });
})();
