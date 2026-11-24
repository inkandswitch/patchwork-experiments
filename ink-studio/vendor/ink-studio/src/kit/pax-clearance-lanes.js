/* Search a measured carrier line without replacing it with a chord. */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-8;
  function fitAlongLane({
    range, start, pointAt, fit, maxDistance = Infinity, spacing = .04, precision = .002,
    segments = 24, maxTests = 256
  }) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) ||
      !Number.isFinite(start) || start < range[0] || start > range[1] ||
      !(maxDistance === Infinity || Number.isFinite(maxDistance) && maxDistance >= 0) ||
      ![spacing, precision].every(v => Number.isFinite(v) && v > 0) ||
      !Number.isSafeInteger(segments) || segments < 2 || segments > 256 ||
      !Number.isSafeInteger(maxTests) || maxTests < 1 || maxTests > 2048 ||
      typeof pointAt !== 'function' || typeof fit !== 'function')
      throw new Error('Lane fitting needs bounded measurements and a fit callback');
    function measure(t) {
      const point = pointAt(t);
      if (point == null) return null;
      if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))
        throw new Error('Lane measurements need finite XYZ points');
      return point.slice();
    }
    const origin = measure(start);
    if (!origin) return null;
    const accepted = v => v !== false && v != null;
    const initial = fit(start);
    if (accepted(initial)) return { parameter: start, distance: 0, value: initial };
    if (!maxDistance || maxTests === 1) return null;
    let tests = 1;

    function branch(end) {
      const table = [{ t: start, distance: 0 }];
      let previous = origin, at = start, sum = 0;
      for (let i = 1; i <= segments && sum < maxDistance; i++) {
        let t = start + (end - start) * i / segments, point = measure(t);
        const missed = !point;
        if (missed) {
          let low = at, high = t;
          for (let j = 0; j < 10; j++) {
            const probe = (low + high) / 2, next = measure(probe);
            if (next) { low = probe; point = next; }
            else high = probe;
          }
          t = low;
        }
        if (point) {
          const delta = K.V.dist(previous, point);
          if (!Number.isFinite(delta)) throw new Error('Lane length must be finite');
          sum += delta;
          if (sum - table.at(-1).distance > EPS) table.push({ t, distance: sum });
          previous = point;
          at = t;
        }
        if (missed) break;
      }
      return { table, length: Math.min(table.at(-1).distance, maxDistance), last: 0 };
    }
    const sides = range.filter(end => end !== start).map(branch);
    let best = null;
    function probe(side, distance) {
      const { table } = side;
      let lo = 0, hi = table.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (table[mid].distance < distance) lo = mid;
        else hi = mid;
      }
      const a = table[lo], b = table[hi],
        parameter = a.t + (b.t - a.t) * (distance - a.distance) / (b.distance - a.distance);
      tests++;
      const value = fit(parameter);
      return accepted(value) ? { parameter, distance, value } : null;
    }
    while (tests < maxTests) {
      let selected, next = Infinity;
      for (const side of sides) {
        const distance = Math.min(side.length, side.last + spacing, best?.distance ?? Infinity);
        if (distance > side.last + EPS && distance < next) { next = distance; selected = side; }
      }
      if (!selected) break;
      let hit = probe(selected, next);
      if (hit) {
        let low = selected.last, high = next;
        while (tests < maxTests && high - low > precision) {
          const mid = (low + high) / 2, candidate = probe(selected, mid);
          if (candidate) { hit = candidate; high = mid; }
          else low = mid;
        }
        if (!best || hit.distance < best.distance) best = hit;
        selected.length = selected.last;
      } else selected.last = next;
    }
    return best;
  }
  P.fitAlongLane = fitAlongLane;
})(KIT);
