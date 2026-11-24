/* Deflate oriented Robinson triangles and Ammann–Beenker half-squares. */
(function (P) {
  const phi = (1 + Math.sqrt(5)) / 2, silver = 1 + Math.SQRT2;
  const c = Math.cos(Math.PI / 8), s = Math.sin(Math.PI / 8), q = Math.SQRT1_2;
  const count = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const position = p => Array.isArray(p) && p.length === 2 &&
    Array.from(p).every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const unit = a => [Math.cos(a), Math.sin(a)];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const piece = (type, ...points) => ({ type, points });
  function check(ok, message) {
    if (!ok) throw new RangeError('Quasiperiodic tiling: ' + message);
  }

  function penrose({ type, points: [a, b, c] }) {
    if (type === 'halfThinRhomb') {
      const p = mix(a, b, 1 / phi);
      return [piece('halfThinRhomb', c, p, b), piece('halfThickRhomb', p, c, a)];
    }
    const p = mix(b, a, 1 / phi), q = mix(b, c, 1 / phi);
    return [piece('halfThickRhomb', q, c, a), piece('halfThickRhomb', p, q, b), piece('halfThinRhomb', q, p, a)];
  }

  // Templates are drawn in units of the child edge. Ordered corners carry the matching orientation.
  function affineRule([a, b, c], tiles) {
    const u = sub(b, a), v = sub(c, a), det = cross(u, v);
    return tiles.map(({ type, points }) => piece(type, ...points.map(p => {
      const delta = sub(p, a);
      return [cross(delta, v) / det, cross(u, delta) / det];
    })));
  }
  const squareRule = (() => {
    const a = [0, 0], b = [1 + q, 1 + q], c = [2 + 2 * q, 0];
    const p = [1, 0], m = [1 + q, q], r = [1 + 2 * q, 0], d = [1, 1], e = [2 + q, q];
    return affineRule([a, b, c], [
      piece('halfSquare', r, m, p), piece('halfSquare', e, m, b), piece('halfSquare', d, p, a),
      piece('rhomb', e, c, r, m), piece('rhomb', m, p, d, b)
    ]);
  })();
  const rhombRule = (() => {
    const bottom = [0, silver * s], right = [silver * c, 0], top = [0, -silver * s], left = [-silver * c, 0];
    const lt = [-Math.SQRT2 * c, -s], lb = [-Math.SQRT2 * c, s];
    const rt = [Math.SQRT2 * c, -s], rb = [Math.SQRT2 * c, s], innerL = [-s, 0], innerR = [s, 0];
    return affineRule([bottom, right, top], [
      piece('rhomb', lt, left, lb, innerL), piece('rhomb', rb, right, rt, innerR),
      piece('halfSquare', lt, innerL, top), piece('halfSquare', lb, innerL, bottom),
      piece('halfSquare', rt, innerR, top), piece('halfSquare', rb, innerR, bottom),
      piece('rhomb', innerR, top, innerL, bottom)
    ]);
  })();
  function ammannBeenker({ type, points: [a, b, c] }) {
    const u = sub(b, a), v = sub(c, a);
    const rule = type === 'rhomb' ? rhombRule : squareRule;
    return rule.map(child => piece(child.type, ...child.points.map(([x, y]) =>
      [a[0] + x * u[0] + y * v[0], a[1] + x * u[1] + y * v[1]])));
  }
  const families = {
    penrose: {
      factor: phi, order: 5, deflate: penrose,
      seed: () => Array.from({ length: 10 }, (_, i) => {
        const p = unit((2 * i - 1) * Math.PI / 10), q = unit((2 * i + 1) * Math.PI / 10);
        return piece('halfThinRhomb', [0, 0], ...(i % 2 ? [p, q] : [q, p]));
      })
    },
    ammannBeenker: {
      factor: silver, order: 8, deflate: ammannBeenker,
      seed: () => Array.from({ length: 8 }, (_, i) => {
        const ray = angle => unit(angle).map(v => v / (2 * c));
        const p = ray((2 * i - 1) * Math.PI / 8), q = ray((2 * i + 1) * Math.PI / 8);
        return piece('rhomb', q, add(p, q), p, [0, 0]);
      })
    }
  };
  const fullType = { halfThinRhomb: 'thinRhomb', halfThickRhomb: 'thickRhomb', halfSquare: 'square' };
  const signedArea = p => p.slice(2).reduce((sum, v, i) => sum + cross(sub(p[i + 1], p[0]), sub(v, p[0])), 0) * .5;
  const ccw = points => signedArea(points) < 0 ? points.slice().reverse() : points;

  function sharedVertices() {
    const buckets = new Map(), points = [], tolerance = 1e-10;
    function intern(p) {
      const [x, y] = p.map(v => Math.floor(v / tolerance));
      for (let j = y - 1; j <= y + 1; j++) for (let i = x - 1; i <= x + 1; i++) {
        const index = buckets.get(i + ':' + j);
        if (index !== undefined && p.every((v, k) => Math.abs(v - points[index][k]) < tolerance)) return index;
      }
      const index = points.length;
      buckets.set(x + ':' + y, index);
      points.push(p);
      return index;
    }
    return { intern, points };
  }

  function assemble(leaves, transform, family) {
    const { intern, points } = sharedVertices(), pending = new Map(), tiles = [];
    const addressKey = p => family + ':' + p.join('.');
    function addTile(type, addresses, indices, partial = false) {
      tiles.push({ id: addresses.map(addressKey).join('|'), type, addresses, indices, partial });
    }
    for (const { type, points, address } of leaves) {
      const ids = points.map(intern);
      if (type === 'rhomb') {
        addTile(type, [address], ids);
        continue;
      }
      const [tip, a, b] = type === 'halfSquare' ? [ids[1], ids[0], ids[2]] : ids;
      const key = type + ':' + Math.min(a, b) + ':' + Math.max(a, b);
      const previous = pending.get(key);
      if (!previous) pending.set(key, { tip, a, b, type, address });
      else {
        addTile(fullType[type], [previous.address, address], [a, previous.tip, b, tip]);
        pending.delete(key);
      }
    }
    for (const { tip, a, b, type, address } of pending.values()) addTile(type, [address], [a, tip, b], true);
    const world = points.map(transform);
    return tiles.map(({ indices, ...tile }) => ({ ...tile, polygon: ccw(indices.map(i => world[i])) }));
  }

  function quasiperiodic({ family = 'penrose', depth = 4, radius = 1, center = [0, 0], rotation = 0,
    boundary, maxPieces = 65536 } = {}) {
    check(typeof family === 'string' && Object.hasOwn(families, family) && count(depth, 0, 12) &&
      Number.isFinite(radius) && radius >= 1e-4 && radius <= 1e6 && position(center) &&
      center.every(n => Math.abs(n) + radius <= 1e6) && Number.isFinite(rotation) &&
      count(maxPieces, 1, 65536), 'invalid family, depth, frame or piece budget');
    const { factor, order, seed, deflate } = families[family];
    const [x, y] = center, [cos, sin] = unit(rotation);
    const transform = ([u, v]) => [x + radius * (cos * u - sin * v), y + radius * (sin * u + cos * v)];
    const roots = seed();
    check(roots.length <= maxPieces, 'piece budget exceeded');
    let leaves = roots.map((node, i) => ({ ...node, address: [i] })), visited = roots.length;
    for (let level = 0; level < depth; level++) {
      const next = [];
      for (const node of leaves) {
        const children = deflate(node);
        check(next.length + children.length <= maxPieces, 'piece budget exceeded');
        children.forEach((child, i) => next.push({ ...child, address: [...node.address, i] }));
      }
      leaves = next;
      visited += leaves.length;
    }
    let tiles = assemble(leaves, transform, family);
    if (boundary !== undefined) {
      const clipped = P.surfaceCells.clip(tiles, { boundary, budget: maxPieces, work: 4000000 });
      const byId = new Map(tiles.map(tile => [tile.id, tile]));
      tiles = clipped.cells.map(({ key, fragments: [polygon] }) => ({ ...byId.get(key), polygon }));
    }
    return P.data.freeze({ family, depth, factor, order, tiles, work: { pieces: leaves.length, visited },
      at(address) {
        check(Array.isArray(address) && count(address.length, 1, depth + 1) &&
          Array.from(address).every(n => count(n, 0, 9)), 'invalid substitution address');
        let node = roots[address[0]];
        for (const index of address.slice(1)) {
          check(node, 'address does not name a substitution piece');
          node = deflate(node)[index];
        }
        check(node, 'address does not name a substitution piece');
        return P.data.freeze({ id: family + ':' + address.join('.'), type: node.type, address: address.slice(),
          polygon: ccw(node.points.map(transform)) });
      } });
  }
  function levels({ family = 'penrose', depth = 4, radius = 1 } = {}) {
    check(typeof family === 'string' && Object.hasOwn(families, family) && count(depth, 0, 12) &&
      Number.isFinite(radius) && radius >= 1e-4 && radius <= 1e6, 'invalid family, depth or radius');
    const { factor, seed, deflate } = families[family], children = new Map();
    let population = new Map(), visited = 0;
    for (const { type } of seed()) population.set(type, (population.get(type) ?? 0) + 1);
    const thin = family === 'penrose' ? Math.sin(Math.PI / 5) : Math.SQRT1_2 / (2 * c);
    const result = [];
    for (let level = 0; level <= depth; level++) {
      const pieces = [...population.values()].reduce((sum, n) => sum + n, 0);
      visited += pieces;
      result.push({ depth: level, pieces, visited, feature: radius * thin / factor ** level });
      if (level === depth) break;
      const next = new Map();
      for (const [type, size] of population) {
        if (!children.has(type))
          children.set(type, deflate(piece(type, [0, 0], [1, 0], [1, 1])).map(row => row.type));
        for (const child of children.get(type)) next.set(child, (next.get(child) ?? 0) + size);
      }
      population = next;
    }
    return P.data.freeze(result);
  }
  quasiperiodic.levels = levels;
  P.tiles.quasiperiodic = quasiperiodic;
})(KIT.procedural);
