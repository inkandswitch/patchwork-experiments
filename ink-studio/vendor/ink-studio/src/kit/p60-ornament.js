/* Frieze and plane-group orbits for pigment, signed relief, and physical tiles. */
(function (P) {
  const identity = [1, 0, 0, 1], halfTurn = [-1, 0, 0, -1];
  const vertical = [-1, 0, 0, 1], horizontal = [1, 0, 0, -1];
  const quarter = [0, -1, 1, 0], sixth = [1, -1, 1, 0], third = [0, -1, 1, -1];
  const diagonal = [0, 1, 1, 0], antiDiagonal = [0, -1, -1, 0];
  const op = (matrix, u = 0, v = 0) => ({ matrix, offset: [u, v] });
  const center = op(identity, .5, .5);
  const wallpapers = {
    p1: ['oblique'], p2: ['oblique', op(halfTurn)],
    pm: ['rectangular', op(horizontal)], pg: ['rectangular', op(horizontal, .5)],
    cm: ['rectangular', op(horizontal), center],
    pmm: ['rectangular', op(vertical), op(horizontal)],
    pmg: ['rectangular', op(halfTurn), op(horizontal, .5)],
    pgg: ['rectangular', op(vertical, .5, .5), op(horizontal, .5, .5)],
    cmm: ['rectangular', op(vertical), op(horizontal), center],
    p4: ['square', op(quarter)], p4m: ['square', op(quarter), op(horizontal)],
    p4g: ['square', op(quarter), op(horizontal, .5, .5)],
    p3: ['hexagonal', op(third)], p3m1: ['hexagonal', op(third), op(antiDiagonal)],
    p31m: ['hexagonal', op(third), op(diagonal)],
    p6: ['hexagonal', op(sixth)], p6m: ['hexagonal', op(sixth), op(diagonal)]
  };
  const friezes = {
    p1: ['rectangular'], p211: ['rectangular', op(halfTurn, 0, 1)],
    p1m1: ['rectangular', op(vertical)], p11m: ['rectangular', op(horizontal, 0, 1)],
    p11g: ['rectangular', op(horizontal, .5, 1)],
    p2mm: ['rectangular', op(vertical), op(horizontal, 0, 1)],
    p2mg: ['rectangular', op(vertical), op(horizontal, .5, 1)]
  };
  const wrap = x => x - Math.floor(x);
  const count = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const pair = (v, limit) => Array.isArray(v) && v.length === 2 &&
    Array.from(v).every(n => Number.isFinite(n) && Math.abs(n) <= limit);
  const apply = ([a, b, c, d], x, y) => [a * x + b * y, c * x + d * y];
  function check(ok, message) {
    if (!ok) throw new RangeError('Ornament: ' + message);
  }
  function orbit(generators, wallpaper) {
    const result = [op(identity)], keys = new Set(['1,0,0,1,0,0']);
    for (let i = 0; i < result.length; i++) {
      const { matrix: a, offset: [u, v] } = result[i];
      for (const { matrix: b, offset: [x, y] } of generators) {
        const [m, q] = apply(a, b[0], b[2]), [n, r] = apply(a, b[1], b[3]);
        const [dx, dy] = apply(a, x, y);
        const next = op([m, n, q, r], wrap(u + dx), wallpaper ? wrap(v + dy) : v + dy);
        const key = [...next.matrix, ...next.offset].join(',');
        if (keys.has(key)) continue;
        keys.add(key);
        result.push(next);
      }
    }
    return P.data.freeze(result);
  }

  function extents(points) {
    return [
      Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
      Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))
    ];
  }
  const inside = (x, y, [l, t, r, b], pad) => x >= l - pad && x <= r + pad && y >= t - pad && y <= b + pad;
  function pigment(value, opaque) {
    const result = DrawingPrimitives.color(value);
    check(!opaque || result[3] === 255, 'motif colors must be opaque');
    return Object.freeze(result);
  }
  function compile({ kind = 'wallpaper', group = 'p1', cell = [1, 1], angle, motif, reach } = {}) {
    const wallpaper = kind === 'wallpaper', catalog = wallpaper ? wallpapers : friezes;
    check((wallpaper || kind === 'frieze') && typeof group === 'string' && Object.hasOwn(catalog, group), 'unknown symmetry group');
    const [lattice, ...generators] = catalog[group];
    check(pair(cell, 1e4) && cell.every(n => n >= 1e-4) &&
      (!['square', 'hexagonal'].includes(lattice) || cell[0] === cell[1]), 'invalid cell lengths for this lattice');
    const [a, b] = cell, limit = Math.min(a, b);
    reach ??= limit * .16;
    const required = lattice === 'hexagonal' ? Math.PI * 2 / 3 : Math.PI / 2;
    angle ??= required;
    check(Number.isFinite(angle) && angle >= Math.PI / 6 && angle <= Math.PI * 5 / 6 &&
      (lattice === 'oblique' || angle === required), 'invalid angle for this lattice');
    check(Number.isFinite(reach) && reach > 0 && reach <= limit, 'distance reach must be positive and no larger than either cell length');
    const shear = angle === Math.PI / 2 ? 0 : b * Math.cos(angle);
    const height = b * Math.sin(angle);
    const toPlane = (u, v) => [a * u + shear * v, height * v];
    const toUV = (x, y) => [(x - shear * y / height) / a, y / height];
    const basis = P.data.freeze([toPlane(1, 0), toPlane(0, 1)]);
    const inverseU = Math.hypot(1, shear / height) / a, inverseV = 1 / height;
    const operations = orbit(generators, wallpaper);
    check(Array.isArray(motif) && count(motif.length, 1, 64), 'expected 1–64 motif shapes');

    let work = 0;
    const layers = Array.from(motif, shape => {
      const { type, points, color, width, closed = false } = shape ?? {};
      const path = type === 'path';
      check((path || type === 'polygon') && Array.isArray(points) &&
        count(points.length, path ? 1 : 3, 128) && Array.from(points).every(v => pair(v, 4)) &&
        (path ? Number.isFinite(width) && width > 0 && width <= 2 * limit && typeof closed === 'boolean'
          : width === undefined && !closed), 'invalid motif polygon or stroke');
      const ink = pigment(color, true), radius = path ? width / 2 : 0, copies = [];
      for (const { matrix, offset: [du, dv] } of operations) {
        const uv = points.map(([u, v]) => {
          const [x, y] = apply(matrix, u, v);
          return [x + du, y + dv];
        });
        const world = uv.map(([u, v]) => toPlane(u, v)), bound = extents(world);
        const stroke = path && closed ? [...world, world[0]] : world;
        const distance = path ? SweptDisc.compile(stroke, stroke.map(() => radius)) : P.geometry.profileDistance(world);
        const [l, t, r, bottom] = extents(uv);
        const pad = radius + reach, px = pad * inverseU, py = pad * inverseV;
        const y0 = wallpaper ? Math.ceil(-bottom - py) : 0, y1 = wallpaper ? Math.floor(1 - t + py) : 0;
        const x0 = Math.ceil(-r - px), x1 = Math.floor(1 - l + px);
        for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
          work += points.length;
          check(work <= 131072, 'motif exceeds the copy and edge budget');
          const [x, y] = toPlane(i, j);
          copies.push({ x, y, bound, radius, distance });
        }
      }
      return { ink, copies };
    });
    const copies = layers.flatMap(layer => layer.copies);
    function cellPoint(u, v) {
      return toPlane(wrap(u), wallpaper ? wrap(v) : v);
    }
    function query(x, y) {
      check(Number.isFinite(x) && Number.isFinite(y), 'sample needs a finite XY position');
      return cellPoint(...toUV(x, y));
    }
    function shade(x, y) {
      for (let i = layers.length - 1; i >= 0; i--) {
        const { ink, copies } = layers[i];
        for (const copy of copies)
          if (inside(x - copy.x, y - copy.y, copy.bound, copy.radius) && copy.distance(x - copy.x, y - copy.y) <= 0)
            return ink;
      }
      return null;
    }
    function localDistance(x, y) {
      let d = reach;
      for (const copy of copies) {
        const lx = x - copy.x, ly = y - copy.y;
        if (inside(lx, ly, copy.bound, copy.radius + reach)) d = Math.min(d, copy.distance(lx, ly));
      }
      return Math.max(-reach, d);
    }
    function raster({ w = 128, h = 128, bounds = { min: [0, 0], max: [1, 1] },
      space = 'uv', samples = 1, background, mode = 'pigment', bevel = 0 } = {}) {
      check(count(w, 1, 4096) && count(h, 1, 4096) && count(samples, 1, 4) &&
        w * h * samples * samples <= 4194304 && w * h * samples * samples * work <= 500000000 &&
        ['uv', 'plane'].includes(space) && pair(bounds?.min, 1e6) && pair(bounds?.max, 1e6) &&
        bounds.min.every((v, i) => v < bounds.max[i]) && ['pigment', 'relief'].includes(mode) &&
        Number.isFinite(bevel) && bevel >= 0 && bevel <= reach,
      'invalid raster bounds or sample budget');
      const rgba = new Uint8Array(w * h * 4), clear = background === undefined ? [0, 0, 0, 0] : pigment(background, false);
      const [u0, v0] = bounds.min, du = (bounds.max[0] - u0) / w, dv = (bounds.max[1] - v0) / h;
      const samplePoint = space === 'uv' ? cellPoint : query;
      const colorAt = mode === 'pigment' ? shade : (x, y) => {
        const d = localDistance(x, y);
        const gray = bevel ? 255 * Math.max(0, Math.min(1, .5 + d / (2 * bevel))) : d <= 0 ? 0 : 255;
        return [gray, gray, gray, 255];
      };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, alpha = 0;
        for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) {
          const u = u0 + (x + (i + .5) / samples) * du, v = v0 + (y + (j + .5) / samples) * dv;
          const [sr, sg, sb, sa] = colorAt(...samplePoint(u, v)) ?? clear;
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          alpha += sa;
        }
        if (alpha) rgba.set([Math.round(r / alpha), Math.round(g / alpha), Math.round(b / alpha),
          Math.round(alpha / (samples * samples))], (y * w + x) * 4);
      }
      return { w, h, rgba };
    }
    function corners(u, v) {
      return [toPlane(u, v), toPlane(u + 1, v), toPlane(u + 1, v + 1), toPlane(u, v + 1)];
    }
    function tiles({ min = [0, 0], max = [1, 1] } = {}) {
      check([min, max].every(v => pair(v, 1e6) && v.every(Number.isSafeInteger)) &&
        max.every((v, i) => v > min[i]) && (max[0] - min[0]) * (max[1] - min[1]) <= 4096 &&
        (wallpaper || min[1] === 0 && max[1] === 1), 'invalid tile window');
      const result = [];
      for (let v = min[1]; v < max[1]; v++) for (let u = min[0]; u < max[0]; u++)
        result.push({ id: u + ':' + v, cell: [u, v], corners: corners(u, v) });
      return P.data.freeze(result);
    }
    return Object.freeze({ kind, group, lattice, basis, operations, raster, tiles,
      distance(x, y) { return localDistance(...query(x, y)); },
      position(uv) {
        check(pair(uv, 1e6), 'position needs finite UV coordinates');
        return toPlane(...uv);
      },
      ink(x, y) { return shade(...query(x, y)); }
    });
  }
  P.ornament = P.data.freeze({ compile, groups: { wallpaper: Object.keys(wallpapers), frieze: Object.keys(friezes) } });
})(KIT.procedural);
