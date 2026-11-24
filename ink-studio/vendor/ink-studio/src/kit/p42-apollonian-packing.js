/* Fill each curvilinear gap using the complex Descartes reflection. */
(function (P) {
  const count = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const xy = p => Array.isArray(p) && p.length === 2 && Array.from(p).every(Number.isFinite);
  const tau = 2 * Math.PI;
  const equalRadius = Math.sqrt(3) / (2 + Math.sqrt(3));
  const regular = () => Array.from({ length: 3 }, (_, i) => {
    const a = i * tau / 3;
    return { center: [(1 - equalRadius) * Math.cos(a), (1 - equalRadius) * Math.sin(a)], radius: equalRadius };
  });
  function check(ok, message) {
    if (!ok) throw new RangeError('Apollonian packing: ' + message);
  }
  function apollonian({ depth = 7, center = [0, 0], radius = 1, rotation = 0,
    seeds = regular(), minRadius = .001, maxCircles = 6000 } = {}) {
    check(count(depth, 0, 20) && count(maxCircles, 3, 20000) && Number.isFinite(minRadius) &&
      minRadius >= 1e-6 && minRadius <= .5, 'invalid depth, minimum radius or circle budget');
    check(xy(center) && Number.isFinite(radius) && radius >= 1e-5 && center.every(v => Math.abs(v) + radius <= 1e6) &&
      Number.isFinite(rotation), 'invalid enclosure frame');
    check(Array.isArray(seeds) && seeds.length === 3, 'expected three seed circles');
    const roots = Array.from(seeds, (seed, i) => {
      const r = seed?.radius, p = seed?.center;
      check(Number.isFinite(r) && r >= 1e-4 && r <= .9999 && xy(p) &&
        Math.abs(Math.hypot(...p) + r - 1) < 1e-9, 'seed circles must be internally tangent to the unit enclosure');
      return { id: 'seed:' + i, k: 1 / r, kx: p[0] / r, ky: p[1] / r };
    });
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const a = seeds[i], b = seeds[j];
      check(Math.abs(Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) - a.radius - b.radius) < 1e-9,
        'seed circles must be mutually tangent');
    }
    const [x, y] = center, c = Math.cos(rotation), s = Math.sin(rotation);
    function world({ k, kx, ky }) {
      const u = kx / k, v = ky / k;
      return [x + radius * (c * u - s * v), y + radius * (s * u + c * v)];
    }
    const boundary = { id: 'boundary', center: [x, y], radius };
    const circles = roots.map(root => ({ id: root.id, center: world(root), radius: radius / root.k, address: [], depth: 0, parents: [] }));
    const queue = [{ quad: [{ id: boundary.id, k: -1, kx: 0, ky: 0 }, ...roots], address: [], via: -1 }];
    let limited = false;
    for (let i = 0; depth && i < queue.length && !limited; i++) {
      const { quad, address, via } = queue[i];
      for (let slot = 0; slot < 4; slot++) {
        if (slot === via) continue;
        const others = quad.filter((_, j) => j !== slot), old = quad[slot];
        const k = 2 * others.reduce((sum, circle) => sum + circle.k, 0) - old.k;
        if (!(k > 0) || 1 / k < minRadius) continue;
        if (circles.length === maxCircles) {
          limited = true;
          break;
        }
        const next = [...address, slot], id = 'gap:' + next.join('.');
        const node = { id, k, kx: 2 * others.reduce((sum, circle) => sum + circle.kx, 0) - old.kx,
          ky: 2 * others.reduce((sum, circle) => sum + circle.ky, 0) - old.ky };
        circles.push({ id, center: world(node), radius: radius / k, address: next,
          depth: next.length, parents: others.map(circle => circle.id) });
        if (next.length < depth) {
          const replaced = quad.slice();
          replaced[slot] = node;
          queue.push({ quad: replaced, address: next, via: slot });
        }
      }
    }
    return P.data.freeze({ boundary, circles, limited });
  }
  P.packing = Object.freeze({ apollonian });
})(KIT.procedural);
