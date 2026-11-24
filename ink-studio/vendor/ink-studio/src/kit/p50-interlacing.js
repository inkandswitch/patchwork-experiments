/* Over–under crossings on a loom or along a transported spine. */
(function (K) {
  const P = K.procedural, V = K.V, C = K.curve, EPS = 1e-9;
  const number = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
  const point = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(v => number(v, -1e6, 1e6));
  const record = p => p != null && [Object.prototype, null].includes(Object.getPrototypeOf(p));
  const check = (ok, why) => { if (!ok) throw new RangeError('Interlacing: ' + why); };
  const clamp = t => Math.max(0, Math.min(1, t));
  const blend = t => t ** 3 * (10 + t * (-15 + 6 * t));

  function strands(input, family, radius, min = 1, max = 128) {
    check(integer(input, min, max) || Array.isArray(input) && integer(input.length, min, max) &&
      Array.from(input).every(record), 'expected a bounded ' + family + ' strand count or list');
    const specs = typeof input === 'number' ? Array.from({ length: input }, () => ({})) : input;
    return specs.map(({ id, radius: r = radius }, index) => {
      const key = id === undefined ? family + ':' + index : id;
      check(typeof key === 'string' && key.length > 0 && key.length <= 128 && number(r, 1e-5, 1e3),
        'strands need a stable name and positive radius');
      return { id: key, family, index, radius: r };
    });
  }
  function unique(specs) {
    check(new Set(specs.map(s => s.id)).size === specs.length, 'strand IDs must be unique');
  }
  function lengths(points) {
    const out = [0];
    for (let i = 1; i < points.length; i++) out.push(out[i - 1] + V.dist(points[i - 1], points[i]));
    return out;
  }

  function segmentDistance(p, q, r, s) {
    const a = V.sub(q, p), b = V.sub(s, r), d = V.sub(p, r), axis = V.cross(a, b), det = V.dot(axis, axis);
    if (det > 0) {
      const u = V.dot(axis, V.cross(b, d)) / det, v = V.dot(axis, V.cross(a, d)) / det;
      if (u > 0 && u < 1 && v > 0 && v < 1)
        return V.len(V.mad(V.mad(d, a, u), b, -v));
    }
    const aa = V.dot(a, a), bb = V.dot(b, b);
    const toA = t => V.len(V.mad(t, a, -clamp(V.dot(t, a) / aa)));
    const toB = t => V.len(V.mad(t, b, -clamp(V.dot(t, b) / bb)));
    return Math.min(toA(V.mul(d, -1)), toA(V.sub(b, d)), toB(d), toB(V.add(d, a)));
  }

  function checkClearance(input, { clearance = 0, maxChecks = 6000000 } = {}) {
    check(Array.isArray(input) && integer(input.length, 1, 256) && Array.from(input).every(record) &&
      number(clearance, 0, 1e3) && integer(maxChecks, 1, 40000000), 'invalid clearance inputs or budget');
    unique(input);
    const pieces = [];
    for (const { id, radius, path } of input) {
      const { points } = path ?? {};
      check(typeof id === 'string' && id.length > 0 && number(radius, 1e-5, 1e3) && Array.isArray(points) &&
        integer(points.length, 2, 4097) && Array.from(points).every(point), 'clearance needs named paths and round radii');
      check(pieces.length + points.length <= 160000, 'clearance exceeds its segment budget');
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        check(V.dist(a, b) > 1e-12, 'clearance paths need distinct adjacent samples');
        pieces.push({ id, radius, a, b, i: i - 1,
          box: P.spatial.expand(P.spatial.boxOf([a, b]), radius + clearance / 2) });
      }
    }
    const extent = P.spatial.boxOf(pieces.flatMap(({box}) => [box.min, box.max]));
    const span = extent.max.map((v, i) => v - extent.min[i]), axis = span.indexOf(Math.max(...span));
    pieces.sort((a, b) => a.box.min[axis] - b.box.min[axis]);
    let checks = 0;
    for (let i = 0; i < pieces.length; i++) {
      const a = pieces[i];
      for (let j = i + 1; j < pieces.length && pieces[j].box.min[axis] <= a.box.max[axis]; j++) {
        check(++checks <= maxChecks, 'clearance exceeds its comparison budget');
        const b = pieces[j];
        if (a.id === b.id || !P.spatial.overlap(a.box, b.box)) continue;
        const distance = segmentDistance(a.a, a.b, b.a, b.b), required = a.radius + b.radius + clearance;
        if (distance + EPS * Math.max(1, required) < required)
          return P.data.freeze({ ok: false, checks, contact: { strands: [a.id, b.id], segments: [a.i, b.i], distance, required } });
      }
    }
    return Object.freeze({ ok: true, checks, contact: null });
  }

  function crossing(id, over, under, oi, ui, point, extra) {
    const a = over.path.points[oi], b = under.path.points[ui], separation = V.dist(a, b);
    return { id, over: over.id, under: under.id, point, overPoint: a, underPoint: b,
      overDistance: over.distances[oi], underDistance: under.distances[ui],
      separation, gap: separation - over.radius - under.radius, ...extra };
  }

  function weave({
    warp = 12, weft = 10, pattern = ['10', '01'], spacing = [.4, .4], margin,
    radius = .061, clearance = .024, transitionSamples = 7,
    origin = [0, 0, 0], u = [1, 0, 0], v = [0, 0, -1]
  } = {}) {
    const vertical = strands(warp, 'warp', radius), horizontal = strands(weft, 'weft', radius);
    unique([...vertical, ...horizontal]);
    check(Array.isArray(pattern) && integer(pattern.length, 1, 128) &&
      Array.from(pattern).every(row => typeof row === 'string' && /^[01]{1,128}$/.test(row) && row.length === pattern[0].length),
      'weave pattern needs equal-width binary rows');
    check(Array.isArray(spacing) && spacing.length === 2 && Array.from(spacing).every(n => number(n, 1e-4, 1e4)) &&
      number(clearance, 0, 1e3) && integer(transitionSamples, 2, 24) &&
      point(origin) && point(u) && point(v) && V.len(u) > EPS && V.len(v) > EPS,
      'invalid weave spacing, clearance, or axes');
    const ends = margin ?? spacing.map(n => n / 2), U = V.norm(u), W = V.norm(v);
    check(Array.isArray(ends) && ends.length === 2 && Array.from(ends).every(n => number(n, 1e-4, 1e4)) &&
      Math.abs(V.dot(U, W)) < 1e-9, 'weave needs positive margins and perpendicular axes');
    check((transitionSamples + 3) * (vertical.length * horizontal.length * 2 + vertical.length + horizontal.length) <= 160000,
      'the weave exceeds its path sample budget');
    const normal = V.cross(U, W), [du, dv] = spacing;
    const at = (x, y, z) => V.mad(V.mad(V.mad(origin, U, x), W, y), normal, z);
    const grid = horizontal.map((row, r) => vertical.map((col, c) => {
      const sep = row.radius + col.radius + clearance, over = pattern[r % pattern.length][c % pattern[0].length] === '1';
      return { sep, over };
    }));

    function line(spec, marks, pitch, margin, position) {
      const start = -margin, stop = pitch * (marks.length - 1) + margin;
      const points = [], centers = [];
      let prev, level;
      function append(s, h) {
        if (prev !== undefined && s <= prev) return;
        const p = position(s, h);
        check(point(p), 'woven strand exceeds its spatial bounds');
        if (!points.length || V.dist(points.at(-1), p) > 1e-12) points.push(p);
        prev = s;
        level = h;
      }
      function ramp(s, h) {
        const a = prev, b = level;
        if (s > a && h !== b)
          for (let j = 1; j < transitionSamples; j++) {
            const t = j / transitionSamples;
            append(a + (s - a) * t, b + (h - b) * blend(t));
          }
        append(s, h);
      }
      append(start, margin <= marks[0].sep ? marks[0].height : 0);
      for (let i = 0; i < marks.length; i++) {
        const { sep, height } = marks[i], s = i * pitch;
        if (i) check(marks[i - 1].sep + sep + EPS < pitch, 'weave spacing cannot fit the crossing allowances');
        ramp(Math.max(start, s - sep), height);
        append(s, height);
        centers.push(points.length - 1);
        append(Math.min(stop, s + sep), height);
      }
      ramp(stop, 0);
      const path = C.path(points, { up: normal });
      return { ...spec, path, centers, distances: lengths(path.points) };
    }

    const cols = vertical.map((spec, c) => line(spec, grid.map(row => {
      const { sep, over } = row[c];
      return { sep, height: sep * (over ? .5 : -.5) };
    }), dv, ends[1], (s, h) => at(c * du, s, h)));
    const rows = horizontal.map((spec, r) => line(spec, grid[r].map(({sep, over}) =>
      ({ sep, height: sep * (over ? -.5 : .5) })), du, ends[0], (s, h) => at(s, r * dv, h)));
    for (const [group, pitch] of [[cols, du], [rows, dv]])
      for (let i = 1; i < group.length; i++) check(group[i - 1].radius + group[i].radius + clearance <= pitch,
        'parallel strands exceed the loom spacing');
    const crossings = grid.flatMap((row, r) => row.map(({over}, c) => {
      const a = cols[c], b = rows[r], center = at(c * du, r * dv, 0), extra = { row: r, column: c };
      return over ? crossing('weave:' + r + ':' + c, a, b, a.centers[r], b.centers[c], center, extra) :
        crossing('weave:' + r + ':' + c, b, a, b.centers[c], a.centers[r], center, extra);
    }));
    return P.data.freeze({ strands: [...cols, ...rows].map(({centers, distances, ...strand}) => strand), crossings });
  }

  function braid({
    spine, strands: input = 3, word, repeats = 1, radius = .09, spacing,
    clearance = .034, samplesPerCrossing = 14, up, maxChecks
  } = {}) {
    const specs = strands(input, 'braid', radius, 2, 24), total = specs.length;
    unique(specs);
    const sequence = word ?? Array.from({ length: total - 1 }, (_, i) => (i + 1) * (i % 2 ? -1 : 1));
    check(Array.isArray(sequence) && integer(sequence.length, 1, 256) && Array.from(sequence).every(g =>
      Number.isInteger(g) && integer(Math.abs(g), 1, total - 1)) && integer(repeats, 1, 128) &&
      integer(samplesPerCrossing, 4, 48) && number(clearance, 0, 1e3), 'invalid braid word, resolution, or clearance');
    const path = C.path(spine, up === undefined ? {} : {up});
    const largest = Math.max(...specs.map(s => s.radius)), pitch = spacing ?? (largest * 2 + clearance) * 1.65;
    const count = repeats * sequence.length, samples = count * samplesPerCrossing;
    check(number(pitch, 1e-5, 1e4), 'braid needs positive finite slot spacing');
    check(samples + count + path.points.length <= 4096 &&
      (samples + count + path.points.length) * total <= 90000, 'the braid exceeds its path sample budget');
    const slot = lane => (lane - (total - 1) / 2) * pitch;
    const order = specs.map((_, i) => i), stages = [];
    for (let i = 0; i < count; i++) {
      const g = sequence[i % sequence.length], from = Math.abs(g) - 1;
      stages.push({ g, from, order: order.slice() });
      [order[from], order[from + 1]] = [order[from + 1], order[from]];
    }
    check(!path.closed || order.every((strand, i) => strand === i), 'a closed spine needs a word that returns every strand to its slot');

    const ticks = new Set(lengths(path.points).map(d => clamp(d / path.length) * count));
    for (let i = 0; i <= samples; i++) ticks.add(i / samplesPerCrossing);
    for (let i = 0; i < count; i++) ticks.add(i + .5);
    const stations = [];
    for (const t of [...ticks].sort((a,b)=>a-b)) {
      if (!stations.length || t - stations.at(-1) > 1e-11) stations.push(t);
      else if (t % 1 === .5 || t === count) stations[stations.length - 1] = t;
    }
    const points = specs.map(() => []), marks = [];
    for (const t of stations) {
      const step = Math.min(count - 1, Math.floor(t)), fraction = t - step;
      const { g, from, order: start } = stages[step], frame = path.frame(t / count * path.length);
      const angle = Math.PI * blend(fraction), mid = slot(from + .5), crest = Math.sign(g) * pitch / 2 * Math.sin(angle);
      for (let lane = 0; lane < total; lane++) {
        const delta = lane === from ? -1 : lane === from + 1 ? 1 : 0;
        const x = delta ? mid + delta * pitch / 2 * Math.cos(angle) : slot(lane);
        const p = V.mad(V.mad(frame.p, frame.B, x), frame.N, -delta * crest);
        const strand = points[start[lane]];
        check(point(p) && (!strand.length || V.dist(strand.at(-1), p) > 1e-12),
          'braid spine produced collapsed or out-of-range samples');
        strand.push(p);
      }
      if (fraction === .5) marks.push({ step, g, from, point: V.mad(frame.p, frame.B, mid), index: points[0].length - 1 });
    }
    const built = specs.map((spec, i) => {
      const strand = C.path(points[i], { closed: path.closed, up: path.frame(0).N });
      return { ...spec, path: strand, distances: lengths(strand.points) };
    });
    const clean = built.map(({distances, ...strand}) => strand), verified = checkClearance(clean, {clearance, maxChecks});
    check(verified.ok, verified.ok ? '' : 'braid segments are too close between ' + verified.contact.strands.join(' and '));
    const crossings = marks.map(({step, g, from, point, index}) => {
      const left = built[stages[step].order[from]], right = built[stages[step].order[from + 1]];
      return crossing('braid:' + step, g > 0 ? left : right, g > 0 ? right : left, index, index, point,
        { step, generator: g, station: (step + .5) * path.length / count });
    });
    return P.data.freeze({ strands: clean, crossings, endOrder: order.map(i => specs[i].id), closed: path.closed });
  }

  P.interlace = Object.freeze({weave, braid, checkClearance});
})(KIT);
