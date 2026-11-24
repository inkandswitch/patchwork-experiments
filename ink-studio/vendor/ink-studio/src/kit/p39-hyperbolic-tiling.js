/* Regular {p,q} mosaics from geodesic reflections in the Poincaré disk. */
(function (P) {
  const tau = 2 * Math.PI;
  const count = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const add = ([a, b], [c, d]) => [a + c, b + d];
  const mul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
  const scale = ([a, b], s) => [a * s, b * s];
  const conjugate = ([a, b]) => [a, -b];
  const unit = a => [Math.cos(a), Math.sin(a)];
  function divide(z, w) {
    const [a, b] = w;
    return scale(mul(z, conjugate(w)), 1 / (a * a + b * b));
  }
  const denominator = (shift, z) => add([1, 0], mul(conjugate(shift), z));
  function mapped({ shift, turn, mirror }, point) {
    const z = mul(turn, mirror ? conjugate(point) : point);
    return divide(add(z, shift), denominator(shift, z));
  }
  // Compose a disk isometry with a reflection in a seed edge. The phase of
  // the derivative at zero gives the new local orientation without a large matrix.
  function follow({ shift, turn, mirror }, reflector) {
    const center = mul(turn, mirror ? conjugate(reflector.shift) : reflector.shift);
    const d = denominator(shift, center);
    const phase = divide(mul(turn, mirror ? conjugate(reflector.turn) : reflector.turn), mul(d, d));
    return { shift: divide(add(center, shift), d), turn: scale(phase, 1 / Math.hypot(...phase)), mirror: !mirror };
  }
  function check(ok, message) {
    if (!ok) throw new RangeError('Hyperbolic tiling: ' + message);
  }

  function hyperbolic({ p = 5, q = 4, depth = 6, center = [0, 0], radius = 1, rotation = 0,
    minEdge = .0015, edgeSegments = 10, maxTiles = 4096 } = {}) {
    check(count(p, 3, 16) && count(q, 3, 16) && (p - 2) * (q - 2) > 4, 'expected a hyperbolic {p,q} pair with 3–16 sides and valence');
    check(count(depth, 0, 16) && count(edgeSegments, 1, 48) && count(maxTiles, 1, 16000) &&
      maxTiles * p * edgeSegments <= 2000000 && Number.isFinite(minEdge) && minEdge >= .00001 && minEdge <= .5,
    'invalid depth, edge resolution or tile budget');
    check(Array.isArray(center) && center.length === 2 && Array.from(center).every(Number.isFinite) &&
      Number.isFinite(radius) && radius >= 1e-5 && center.every(v => Math.abs(v) + radius <= 1e6) &&
      Number.isFinite(rotation), 'invalid disk frame');
    const alpha = Math.PI / p, beta = Math.PI / q;
    const hyp = 1 / (Math.tan(alpha) * Math.tan(beta));
    const circumradius = Math.sqrt((hyp - 1) / (hyp + 1));
    const inradiusCosh = Math.cos(beta) / Math.sin(alpha);
    const reflectionDistance = Math.sqrt(1 - 1 / inradiusCosh ** 2);
    const vertices = Array.from({ length: p }, (_, i) => scale(unit(tau * i / p), circumradius));
    const reflectors = [], lines = [];
    for (let i = 0; i < p; i++) {
      const angle = (2 * i + 1) * alpha;
      reflectors.push({ shift: scale(unit(angle), reflectionDistance), turn: scale(unit(2 * angle), -1) });
      const c = scale(unit(angle), 1 / reflectionDistance), r = Math.sqrt(Math.hypot(...c) ** 2 - 1);
      const a = add(vertices[i], scale(c, -1)), b = add(vertices[(i + 1) % p], scale(c, -1));
      const start = Math.atan2(a[1], a[0]), difference = Math.atan2(b[1], b[0]) - start;
      const sweep = Math.atan2(Math.sin(difference), Math.cos(difference));
      lines.push(Array.from({ length: edgeSegments - 1 }, (_, n) =>
        add(c, scale(unit(start + sweep * (n + 1) / edgeSegments), r))));
    }

    const cells = [], seen = new Map(), epsilon = 5e-9;
    const [x, y] = center, rotationPhase = unit(rotation);
    const world = v => add([x, y], scale(mul(v, rotationPhase), radius));
    let limited = false;
    function insert(frame, address, via) {
      const [a, b] = frame.shift;
      if (!Number.isFinite(a + b) || a * a + b * b >= 1) return;
      const ix = Math.floor(a / epsilon), iy = Math.floor(b / epsilon);
      for (let j = iy - 1; j <= iy + 1; j++) for (let i = ix - 1; i <= ix + 1; i++) {
        const at = seen.get(i + ':' + j);
        if (at && Math.abs(at[0] - a) < epsilon && Math.abs(at[1] - b) < epsilon) return;
      }
      const ring = vertices.map(v => mapped(frame, v));
      if (ring.some(([u, v]) => !(u * u + v * v < 1))) return;
      if (address.length && ring.some(([u, v], i) => {
        const next = ring[(i + 1) % p];
        return Math.hypot(u - next[0], v - next[1]) < minEdge;
      })) return;
      if (cells.length === maxTiles) {
        limited = true;
        return;
      }
      seen.set(ix + ':' + iy, frame.shift);
      cells.push({ frame, address, via, ring });
    }
    insert({ shift: [0, 0], turn: [1, 0], mirror: false }, [], -1);
    for (let i = 0; i < cells.length && !limited; i++) {
      const { frame, address, via } = cells[i];
      if (address.length >= depth) break;
      for (let side = 0; side < p && !limited; side++) {
        if (side !== via) insert(follow(frame, reflectors[side]), [...address, side], side);
      }
    }
    const tiles = cells.map(({ frame, address, ring }) => {
      let outline = ring.flatMap((point, i) => [point, ...lines[i].map(v => mapped(frame, v))]).map(world);
      let vertices = ring.map(world);
      if (frame.mirror) {
        outline = [outline[0], ...outline.slice(1).reverse()];
        vertices = [vertices[0], ...vertices.slice(1).reverse()];
      }
      return { id: address.length ? 'disk:' + address.join('.') : 'disk:root', address,
        depth: address.length, center: world(frame.shift), vertices, outline };
    });
    return P.data.freeze({ p, q, center: [x, y], radius, tiles, limited });
  }
  P.tiles.hyperbolic = hyperbolic;
})(KIT.procedural);
