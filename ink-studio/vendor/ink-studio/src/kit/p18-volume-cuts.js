/* Finite planar profiles extruded on Y and combined as a subtractive volume. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

  function compile(specs) {
    if (!Array.isArray(specs) || specs.length > 256) throw new Error('Volume cuts need at most 256 prisms');
    const keys = new Set();
    const cuts = specs.map(({ key, profile, span }) => {
      if (typeof key !== 'string' || !key || keys.has(key) || !Array.isArray(span) || span.length !== 2 ||
          !span.every(Number.isFinite) || span[0] >= span[1] || !Array.isArray(profile) || profile.length > 128) {
        throw new Error('Volume cuts need unique keys, finite ordered depth and 3 to 128 profile points');
      }
      keys.add(key);
      const planar = P.geometry.profileDistance(profile), ring = profile.map(p => p.slice()), [low, high] = span;
      const area = ring.reduce((sum, a, i) => {
        const b = ring[(i + 1) % ring.length];
        return sum + a[0] * b[1] - b[0] * a[1];
      }, 0);
      if (!Number.isFinite(area) || area === 0) throw new Error('Volume cut profiles need nonzero finite area');
      const box = P.spatial.boxOf(ring.flatMap(([x, z]) => [[x, low, z], [x, high, z]]));
      const edges = ring.flatMap((a, i) => {
        const b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
        return length ? [{ a, dx, dz, length, normal: [Math.sign(area) * dz / length, 0, -Math.sign(area) * dx / length] }] : [];
      });
      return { key, box, planar, low, high, edges };
    });
    const bounds = cuts.length ? P.data.freeze(P.spatial.boxOf(cuts.flatMap(c => [c.box.min, c.box.max]))) : null;
    function distance([x, y, z], ceiling = Infinity) {
      let closest = ceiling;
      for (const c of cuts) {
        const { min, max } = c.box, vertical = Math.max(c.low - y, y - c.high);
        const lower = Math.max(min[0] - x, x - max[0], min[2] - z, z - max[2], vertical);
        if (lower >= closest) continue;
        closest = Math.min(closest, Math.max(c.planar(x, z), vertical));
      }
      return closest;
    }
    function exposed(p, n) {
      return distance(p, 0) >= -1e-8 && distance(V.mad(p, n, 2e-7), 0) >= -1e-8;
    }
    function sample(spacing, emit, { maxSamples = 250000 } = {}) {
      if (!Number.isFinite(spacing) || spacing <= 0 || typeof emit !== 'function' ||
          !Number.isSafeInteger(maxSamples) || maxSamples < 1 || maxSamples > 1000000) {
        throw new Error('Volume samples need positive spacing and a bounded sample budget');
      }
      let visited = 0;
      function budget(work) {
        visited += work;
        if (visited > maxSamples) throw new Error('Volume surface sample budget exceeded');
      }
      for (const c of cuts) {
        const { min, max } = c.box;
        const nx = Math.max(1, Math.ceil((max[0] - min[0]) / spacing)), nz = Math.max(1, Math.ceil((max[2] - min[2]) / spacing));
        budget(nx * nz * 2);
        const boundary = (p, normal) => {
          if (exposed(p, normal)) emit(p, normal, c.key);
        };
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
          const x = min[0] + (max[0] - min[0]) * (i + .5) / nx, z = min[2] + (max[2] - min[2]) * (j + .5) / nz;
          if (c.planar(x, z) > 0) continue;
          boundary([x, c.low, z], [0, -1, 0]);
          boundary([x, c.high, z], [0, 1, 0]);
        }
        const ny = Math.max(1, Math.ceil((c.high - c.low) / spacing));
        for (const edge of c.edges) {
          const n = Math.max(1, Math.ceil(edge.length / spacing));
          budget(n * ny);
          for (let i = 0; i < n; i++) for (let j = 0; j < ny; j++) {
            const t = (i + .5) / n, y = c.low + (c.high - c.low) * (j + .5) / ny;
            boundary([edge.a[0] + edge.dx * t, y, edge.a[1] + edge.dz * t], edge.normal.slice());
          }
        }
      }
    }
    function raycast(origin, direction, max, accept = () => true) {
      if (!finitePoint(origin) || !finitePoint(direction) || V.len(direction) < 1e-9 ||
          !Number.isFinite(max) || max <= 0 || typeof accept !== 'function') {
        throw new Error('Volume cuts need a finite ray and hit limit');
      }
      let hit = null;
      function consider(t, normal, c, p) {
        if (t < 0 || t >= (hit?.distance ?? max) || !exposed(p, normal) || !accept(p, normal, c.key)) return;
        hit = { p, n: normal.slice(), distance: t, key: c.key };
      }
      for (const c of cuts) {
        if (P.spatial.rayBox(c.box, origin, direction, hit?.distance ?? max) === null) continue;
        if (Math.abs(direction[1]) > 1e-9) for (const [y, sign] of [[c.low, -1], [c.high, 1]]) {
          const t = (y - origin[1]) / direction[1], p = V.mad(origin, direction, t);
          if (c.planar(p[0], p[2]) <= 1e-8) consider(t, [0, sign, 0], c, p);
        }
        for (const edge of c.edges) {
          const across = V.dot(direction, edge.normal);
          if (Math.abs(across) < 1e-9) continue;
          const t = ((edge.a[0] - origin[0]) * edge.normal[0] + (edge.a[1] - origin[2]) * edge.normal[2]) / across;
          const p = V.mad(origin, direction, t);
          const u = ((p[0] - edge.a[0]) * edge.dx + (p[2] - edge.a[1]) * edge.dz) / edge.length;
          if (u >= -1e-8 && u <= edge.length + 1e-8 && p[1] >= c.low - 1e-8 && p[1] <= c.high + 1e-8) {
            consider(t, edge.normal, c, p);
          }
        }
      }
      return hit;
    }
    return Object.freeze({ bounds, distance, sample, raycast, subtract(field) {
      if (typeof field !== 'function') throw new Error('Volume subtraction needs a signed field');
      return p => {
        const d = field(p);
        return Math.max(d, -distance(p, -d));
      };
    } });
  }
  P.volumeCuts = { compile };
})(KIT);
