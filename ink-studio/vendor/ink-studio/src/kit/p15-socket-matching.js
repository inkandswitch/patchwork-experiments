/* Deterministic spatial matching for procedural connections between named sockets.
   The matcher owns no scene entities, rendering, or decoration-specific behavior. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    order = (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  function connect(input, options = {}) {
    if (!Array.isArray(input) || input.length > 2048)
      throw new Error('Proximity matching supports at most 2048 sockets');
    const defaults = Object.assign({ reach: 6, minDistance: 0.25, rise: 3, degree: 2, maxEdges: 512 }, options),
      ids = new Set();
    if (
      !Number.isFinite(defaults.reach) ||
      defaults.reach <= 0 ||
      defaults.reach > 128 ||
      !Number.isFinite(defaults.rise) ||
      defaults.rise < 0 ||
      !Number.isInteger(defaults.degree) ||
      defaults.degree < 0 ||
      defaults.degree > 8 ||
      !Number.isFinite(defaults.minDistance) ||
      defaults.minDistance < 0 ||
      !Number.isSafeInteger(defaults.maxEdges) ||
      defaults.maxEdges < 0 ||
      defaults.maxEdges > 4096 ||
      (options.allow !== undefined && typeof options.allow !== 'function')
    )
      throw new Error('Invalid proximity matching policy');
    const nodes = input
      .map(raw => {
        const p = Object.assign({}, defaults, raw);
        if (
          !p ||
          typeof p.id !== 'string' ||
          !p.id ||
          ids.has(p.id) ||
          !vector(p.point) ||
          !Number.isFinite(p.reach) ||
          p.reach <= 0 ||
          p.reach > 128 ||
          !Number.isFinite(p.rise) ||
          p.rise < 0 ||
          !Number.isInteger(p.degree) ||
          p.degree < 0 ||
          p.degree > 8 ||
          (p.group !== undefined && typeof p.group !== 'string') ||
          (p.exclude !== undefined &&
            (!Array.isArray(p.exclude) || p.exclude.length > 2048 || p.exclude.some(s => typeof s !== 'string')))
        )
          throw new Error('Sockets need unique names, finite points and bounded matching settings');
        ids.add(p.id);
        p.point = Object.freeze(p.point.slice());
        if (p.exclude) p.exclude = Object.freeze(p.exclude.slice());
        return Object.freeze(p);
      })
      .sort((a, b) => order(a.id, b.id));
    const cell = Math.max(0.25, ...nodes.map(p => p.reach)),
      grid = new Map(),
      candidates = [];
    for (const a of nodes) {
      const at = a.point.map(v => Math.floor(v / cell));
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++)
            for (const b of grid.get([at[0] + x, at[1] + y, at[2] + z].join('/')) || []) {
              const distance = V.dist(a.point, b.point);
              if (
                a.group !== b.group ||
                distance < defaults.minDistance ||
                distance > Math.min(a.reach, b.reach) ||
                Math.abs(a.point[1] - b.point[1]) > Math.min(a.rise, b.rise) ||
                a.exclude?.includes(b.id) ||
                b.exclude?.includes(a.id)
              )
                continue;
              if (candidates.length >= 65536) throw new Error('Proximity matching exceeds its 65536-candidate budget');
              candidates.push({ a: b, b: a, distance });
            }
      const key = at.join('/');
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(a);
    }
    candidates.sort((a, b) => a.distance - b.distance || order(a.a.id, b.a.id) || order(a.b.id, b.b.id));
    const used = new Map(),
      out = [];
    for (const edge of candidates) {
      if (
        (used.get(edge.a.id) || 0) >= edge.a.degree ||
        (used.get(edge.b.id) || 0) >= edge.b.degree ||
        options.allow?.(edge.a, edge.b) === false
      )
        continue;
      if (out.length >= defaults.maxEdges) throw new Error('Proximity matching exceeds its connection budget');
      used.set(edge.a.id, (used.get(edge.a.id) || 0) + 1);
      used.set(edge.b.id, (used.get(edge.b.id) || 0) + 1);
      out.push(
        Object.freeze({
          id: JSON.stringify([edge.a.id, edge.b.id]),
          a: edge.a.id,
          b: edge.b.id,
          distance: edge.distance
        })
      );
    }
    return Object.freeze(out);
  }
  A.proximity = { connect };
})(KIT);
