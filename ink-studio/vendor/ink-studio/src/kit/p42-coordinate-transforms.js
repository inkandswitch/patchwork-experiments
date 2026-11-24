/* Plane maps share one finite-domain contract across coordinates, meshes and rasters. */
(function (K) {
  const P = K.procedural, matrices = new WeakMap(),
    axes = { xy: [0, 1], xz: [0, 2], yz: [1, 2] },
    limit = 1e12, pixelBudget = 4096 * 4096,
    finite = (n, cap = limit) => Number.isFinite(n) && Math.abs(n) <= cap,
    integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi,
    pair = value => (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === 2 &&
      finite(value[0]) && finite(value[1]),
    add = ([a, b], [c, d]) => [a + c, b + d],
    negate = ([a, b]) => [-a, -b],
    conjugate = ([a, b]) => [a, -b],
    multiply = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];

  function complex(value) {
    if (finite(value)) return [value, 0];
    if (pair(value)) return Array.from(value);
    throw new RangeError('Expected a real number or a finite complex pair');
  }

  function quotient(x, y, re, im, magnitude) {
    if (!magnitude) return null;
    const u = re / magnitude, v = im / magnitude, a = x / magnitude, b = y / magnitude,
      r = a * u + b * v, j = b * u - a * v;
    return finite(r) && finite(j) ? [r, j] : null;
  }

  function normalize(matrix) {
    const largest = Math.max(...matrix.map(([x, y]) => Math.hypot(x, y)));
    if (!largest || !Number.isFinite(largest)) throw new RangeError('A coordinate matrix needs finite nonzero coefficients');
    const result = matrix.map(row => row.map(v => v / largest));
    const [a, b, c, d] = result, left = multiply(a, d), right = multiply(b, c),
      determinant = add(left, negate(right)), magnitude = Math.hypot(...determinant);
    if (magnitude <= 1e-14 * Math.max(Math.hypot(...left), Math.hypot(...right)))
      throw new RangeError('Coordinate map is singular or numerically ill-conditioned');
    return result;
  }

  function evaluator([[ar, ai], [br, bi], [cr, ci], [dr, di]], mirror) {
    const constant = Math.hypot(dr, di);
    return (x, y) => {
      if (!finite(x) || !finite(y)) return null;
      if (mirror) y = -y;
      const r = cr * x - ci * y, i = cr * y + ci * x,
        re = r + dr, im = i + di, magnitude = Math.hypot(re, im);
      if (magnitude <= 1e-12 * Math.max(constant, Math.hypot(r, i))) return null;
      return quotient(ar * x - ai * y + br, ar * y + ai * x + bi, re, im, magnitude);
    };
  }

  function pole([, , [cr, ci], [dr, di]], mirror) {
    const point = quotient(-dr, -di, cr, ci, Math.hypot(cr, ci));
    return point ? Object.freeze(mirror ? conjugate(point) : point) : null;
  }

  function make(matrix, mirror = false) {
    const m = normalize(matrix), [a, b, c, d] = m, inverted = [d, negate(b), negate(c), a],
      i = mirror ? inverted.map(conjugate) : inverted;
    const map = Object.freeze({ orientation: mirror ? -1 : 1, pole: pole(m, mirror), inversePole: pole(i, mirror),
      forward: evaluator(m, mirror), inverse: evaluator(i, mirror) });
    matrices.set(map, { m, mirror });
    return map;
  }

  function mobius({ a = 1, b = 0, c = 0, d = 1 } = {}) {
    return make([a, b, c, d].map(complex));
  }

  function inversion({ center = [0, 0], radius = 1 } = {}) {
    if (!pair(center) || !finite(radius, 1e6) || radius <= 0)
      throw new RangeError('Circle inversion needs a finite center and a positive radius up to 1e6');
    const [x, y] = center;
    return make([[x, y], [radius * radius - x * x - y * y, 0], [1, 0], [-x, y]], true);
  }

  function matrixProduct([a, b, c, d], [e, f, g, h]) {
    return [add(multiply(a, e), multiply(b, g)), add(multiply(a, f), multiply(b, h)),
      add(multiply(c, e), multiply(d, g)), add(multiply(c, f), multiply(d, h))];
  }

  function then(before, after) {
    return { m: normalize(matrixProduct(after.m, after.mirror ? before.m.map(conjugate) : before.m)),
      mirror: before.mirror !== after.mirror };
  }

  function compiled(map) {
    const value = matrices.get(map);
    if (!value) throw new TypeError('Expected a compiled coordinate map');
    return value;
  }

  function compose(...maps) {
    if (maps.length > 64) throw new RangeError('At most 64 coordinate maps may be composed');
    const out = maps.map(compiled).reduce(then, compiled(mobius()));
    return make(out.m, out.mirror);
  }

  function repeat(map, count) {
    const source = compiled(map);
    if (!integer(count, 0, 64)) throw new RangeError('Coordinate repeat count must be 0–64');
    let out = compiled(mobius()), power = source;
    while (count) {
      if (count & 1) out = then(out, power);
      count >>= 1;
      if (count) power = then(power, power);
    }
    return make(out.m, out.mirror);
  }

  function droste({ center = [0, 0], radius = 1, ratio = .48, angle = 0, twist = 0, depth = 6 } = {}) {
    if (!pair(center) || !finite(radius, 1e6) || radius < 1e-6 || !finite(ratio) || ratio < .125 || ratio > .95 ||
      !finite(angle, 100 * Math.PI) || !finite(twist, 64) || !integer(depth, 0, 16))
      throw new RangeError('Invalid Droste center, radius, ratio, twist or depth');
    const [cx, cy] = center, levels = Array.from({ length: depth + 1 }, (_, index) => {
      const scale = ratio ** index, rotation = angle * index, a = [scale * Math.cos(rotation), scale * Math.sin(rotation)];
      return Object.freeze({ id: 'droste/' + index, index, scale, angle: rotation, radius: radius * scale,
        innerRadius: radius * ratio ** (index + 1),
        map: make([a, add([cx, cy], negate(multiply(a, [cx, cy]))), [0, 0], [1, 0]]) });
    });

    function resolve(x, y) {
      if (!finite(x) || !finite(y)) return null;
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (!r || r > radius || r < levels.at(-1).innerRadius) return null;
      const row = levels.findLast(level => r <= level.radius);
      const sweep = -row.angle - twist * Math.log(r / radius), c = Math.cos(sweep), s = Math.sin(sweep),
        u = cx + (dx * c - dy * s) / row.scale, v = cy + (dx * s + dy * c) / row.scale;
      return finite(u) && finite(v) ? { id: row.id, level: row.index, point: [u, v] } : null;
    }
    return Object.freeze({ levels: Object.freeze(levels), resolve, pullback: (x, y) => resolve(x, y)?.point ?? null });
  }

  function crossesPole(pole, a, b, c) {
    if (!pole || [0, 1].some(i => pole[i] < Math.min(a[i], b[i], c[i]) || pole[i] > Math.max(a[i], b[i], c[i])))
      return false;
    const cross = (p, q) => (q[0] - p[0]) * (pole[1] - p[1]) - (q[1] - p[1]) * (pole[0] - p[0]);
    const u = cross(a, b), v = cross(b, c), w = cross(c, a);
    return (u >= 0 && v >= 0 && w >= 0) || (u <= 0 && v <= 0 && w <= 0);
  }

  function mesh(source, map, { target = 'geometry', plane = 'xy', direction, outside = 'drop', maxCoordinate = 1e6 } = {}) {
    compiled(map);
    const uv = target === 'uv', motion = direction ?? (uv ? 'inverse' : 'forward');
    if ((!uv && target !== 'geometry') || typeof plane !== 'string' || !Object.hasOwn(axes, plane) ||
      !['forward', 'inverse'].includes(motion) || !['drop', 'clamp'].includes(outside) || (!uv && outside !== 'drop') ||
      !finite(maxCoordinate) || maxCoordinate <= 0 || source?.points?.length > 750000 || source?.triangles?.length > 1500000)
      throw new RangeError('Invalid coordinate mesh options or mesh budget');
    TexturedSurface.validate(source);
    const pole = motion === 'forward' ? map.pole : map.inversePole, [i, j] = uv ? [0, 1] : axes[plane],
      input = uv ? source.uvs : source.points, stride = uv ? 2 : 3, count = input.length / stride,
      points = [], uvs = [], triangles = [], ids = new Int32Array(count).fill(-1);
    const original = Array.from({ length: count }, (_, k) => [input[k * stride + i], input[k * stride + j]]);
    const mapped = original.map(([x, y]) => {
      const pair = map[motion](x, y);
      if (!pair) return null;
      if (uv && outside === 'clamp') return pair.map(v => K.clamp(v, 0, 1));
      return pair.every(v => uv ? v >= 0 && v <= 1 : Math.abs(v) <= maxCoordinate) ? pair : null;
    });
    function vertex(index) {
      if (ids[index] >= 0) return ids[index];
      const id = points.length / 3, at = index * 3, tex = index * 2;
      points.push(source.points[at], source.points[at + 1], source.points[at + 2]);
      uvs.push(source.uvs[tex], source.uvs[tex + 1]);
      const dst = uv ? uvs : points, base = id * stride;
      dst[base + i] = mapped[index][0];
      dst[base + j] = mapped[index][1];
      return ids[index] = id;
    }
    let dropped = 0;
    const flip = !uv && map.orientation < 0;
    for (let k = 0; k < source.triangles.length; k += 3) {
      const a = source.triangles[k], b = source.triangles[k + 1], c = source.triangles[k + 2];
      if (!mapped[a] || !mapped[b] || !mapped[c] || crossesPole(pole, original[a], original[b], original[c])) {
        dropped++;
        continue;
      }
      const ia = vertex(a), ib = vertex(b), ic = vertex(c);
      triangles.push(ia, flip ? ic : ib, flip ? ib : ic);
    }
    return { points: Float64Array.from(points), uvs: Float64Array.from(uvs), triangles: Uint32Array.from(triangles), dropped };
  }

  function bounds(box) {
    if (!pair(box?.min) || !pair(box?.max) || box.min.some((v, i) => v >= box.max[i]))
      throw new RangeError('Warp raster needs finite ordered XY bounds');
    return [box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1]];
  }
  const unit = { min: [0, 0], max: [1, 1] };
  function image(source, { map, w = source?.w, h = source?.h, extent = unit, sourceExtent = unit,
    filter = 'nearest', background = [0, 0, 0, 0] } = {}) {
    const pull = typeof map === 'function' ? map : map?.pullback ?? map?.inverse;
    FrameComposite.image(source);
    if (typeof pull !== 'function' || !integer(w, 1, 4096) || !integer(h, 1, 4096) ||
        source.w * source.h > pixelBudget || !['nearest', 'linear'].includes(filter) ||
        !Array.isArray(background) || background.length !== 4 || !Array.from(background).every(n => integer(n, 0, 255)))
      throw new RangeError('Invalid raster warp map, dimensions, filter or background');
    const [x0, y0, dx, dy] = bounds(extent), [lx, ly, sx, sy] = bounds(sourceExtent),
      { w: sw, h: sh, rgba, rgb, alpha } = source, input = rgba ?? rgb, stride = rgba ? 4 : 3,
      out = new Uint8Array(w * h * 4), op = i => rgba ? rgba[i * 4 + 3] : alpha?.[i] ?? 255;

    function nearest(at, u, v) {
      const i = Math.min(sw - 1, Math.floor(u)) + sw * Math.min(sh - 1, Math.floor(v)), src = i * stride;
      for (let c = 0; c < 3; c++) out[at + c] = input[src + c];
      out[at + 3] = op(i);
    }
    function linear(at, u, v) {
      const x = K.clamp(u - .5, 0, sw - 1), y = K.clamp(v - .5, 0, sh - 1),
        i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j,
        base = i + sw * j, right = i + 1 < sw ? 1 : 0, below = j + 1 < sh ? sw : 0;
      const a = op(base) * (1 - fx) * (1 - fy), b = op(base + right) * fx * (1 - fy),
        c = op(base + below) * (1 - fx) * fy, d = op(base + right + below) * fx * fy, total = a + b + c + d;
      out[at + 3] = Math.round(total);
      if (!out[at + 3]) return;
      for (let k = 0; k < 3; k++)
        out[at + k] = Math.round((a * input[base * stride + k] + b * input[(base + right) * stride + k] +
          c * input[(base + below) * stride + k] + d * input[(base + right + below) * stride + k]) / total);
    }
    const sample = filter === 'nearest' ? nearest : linear;
    for (let row = 0, at = 0; row < h; row++) for (let col = 0; col < w; col++, at += 4) {
      const p = pull(x0 + dx * ((col + .5) / w), y0 + dy * ((row + .5) / h));
      if (pair(p)) {
        const u = (p[0] - lx) / sx, v = (p[1] - ly) / sy;
        if (u >= 0 && u <= 1 && v >= 0 && v <= 1) { sample(at, u * sw, v * sh); continue; }
      }
      out.set(background, at);
    }
    return { w, h, rgba: out };
  }

  P.coordinateTransforms = Object.freeze({ mobius, inversion, compose, repeat, droste, mesh, image });
})(KIT);
