// Portable outlines, layout and seekable glyph animation. No canvas, fonts or packages required.
const Typography = (() => {
  const check = (ok, message) => {
    if (!ok) throw new RangeError('Typography: ' + message);
  };
  const number = (n, lo = -1e9, hi = 1e9) => Number.isFinite(n) && n >= lo && n <= hi;
  const vector = (v, n) =>
    (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length === n && Array.from(v).every(x => number(x));
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => {
    n = clamp(n);
    return n * n * (3 - 2 * n);
  };
  const freeze = a => {
    if (a && typeof a === 'object' && !Object.isFrozen(a)) {
      Object.values(a).forEach(freeze);
      Object.freeze(a);
    }
    return a;
  };
  const fonts = new WeakSet(),
    outlines = new WeakMap();
  const arity = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  function commands(input) {
    check(Array.isArray(input) && input.length <= 65536, 'expected bounded M/L/Q/C/Z command arrays');
    let open = false;
    return input
      .map(c => {
        check(
          Array.isArray(c) &&
            Object.hasOwn(arity, c[0]) &&
            c.length === arity[c[0]] + 1 &&
            c.slice(1).every(x => number(x)),
          'invalid outline command'
        );
        if (c[0] === 'M') {
          check(!open, 'close each contour with Z');
          open = true;
        } else {
          check(open, 'outline must start with M');
          if (c[0] === 'Z') open = false;
        }
        return c.slice();
      })
      .concat((check(!open, 'close each contour with Z'), []));
  }
  function font(def) {
    check(
      def &&
        number(def.unitsPerEm, 1, 1e6) &&
        number(def.ascender) &&
        number(def.descender) &&
        def.ascender > def.descender,
      'invalid font metrics'
    );
    check(
      def.glyphs && (typeof def.glyphs === 'object' || typeof def.glyphs === 'function'),
      'expected glyph dictionary or provider'
    );
    const dictionary =
      typeof def.glyphs === 'function'
        ? null
        : Object.fromEntries(
            Object.entries(def.glyphs).map(([ch, g]) => [ch, { ...g, commands: commands(g.commands ?? []) }])
          );
    const unitsPerEm = def.unitsPerEm,
      fallback = def.fallback ?? '?',
      pairs = { ...def.kerning };
    const cache = new Map(),
      provider =
        typeof def.glyphs === 'function' ? def.glyphs : ch => (Object.hasOwn(dictionary, ch) ? dictionary[ch] : null);
    const read = ch => {
      if (cache.has(ch)) return cache.get(ch);
      const raw = provider(ch);
      if (!raw) return null;
      check(number(raw.advance, 0, 1e7), 'invalid glyph advance');
      check(raw.id === undefined || typeof raw.id === 'string' || Number.isSafeInteger(raw.id), 'invalid glyph ID');
      const cs = commands(raw.commands ?? []),
        g = freeze({ id: raw.id ?? ch, advance: raw.advance, commands: cs });
      cache.set(ch, g);
      return g;
    };
    const kern = typeof def.kerning === 'function' ? def.kerning : (a, b) => pairs[a + ',' + b] ?? 0;
    const api = Object.freeze({
      name: String(def.name ?? 'Outline font'),
      unitsPerEm: def.unitsPerEm,
      ascender: def.ascender,
      descender: def.descender,
      lineGap: def.lineGap ?? 0,
      glyph(ch) {
        check(typeof ch === 'string' && [...ch].length === 1, 'expected one Unicode code point');
        return read(ch) ?? read(fallback) ?? freeze({ id: '.notdef', advance: unitsPerEm * 0.6, commands: [] });
      },
      kerning(a, b) {
        const value = kern(a, b);
        check(number(value), 'invalid kerning');
        return value;
      },
      has: ch => !!read(ch)
    });
    check(number(api.lineGap, 0, 1e6), 'invalid line gap');
    fonts.add(api);
    return api;
  }
  function flatten(input, tolerance = 1) {
    check(number(tolerance, 1e-5, 1e6), 'invalid outline tolerance');
    const cs = commands(input),
      loops = [];
    let total = 0;
    let loop, p;
    const add = q => {
      check(++total <= 200000 && (loop?.length ?? 0) < 65536, 'outline subdivision budget exceeded');
      if (!p || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-10) loop.push(q);
      p = q;
    };
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const distance = (p, a, b) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const quadratic = (a, b, c, depth = 0) => {
      if (depth >= 18 || distance(b, a, c) <= tolerance) return add(c);
      const ab = mid(a, b),
        bc = mid(b, c),
        m = mid(ab, bc);
      quadratic(a, ab, m, depth + 1);
      quadratic(m, bc, c, depth + 1);
    };
    const cubic = (a, b, c, d, depth = 0) => {
      if (depth >= 18 || Math.max(distance(b, a, d), distance(c, a, d)) <= tolerance) return add(d);
      const ab = mid(a, b),
        bc = mid(b, c),
        cd = mid(c, d),
        abc = mid(ab, bc),
        bcd = mid(bc, cd),
        m = mid(abc, bcd);
      cubic(a, ab, abc, m, depth + 1);
      cubic(m, bcd, cd, d, depth + 1);
    };
    for (const c of cs) {
      if (c[0] === 'M') {
        loop = [];
        loops.push(loop);
        p = null;
        add(c.slice(1));
      } else if (c[0] === 'L') add(c.slice(1));
      else if (c[0] === 'Q') quadratic(p, c.slice(1, 3), c.slice(3));
      else if (c[0] === 'C') cubic(p, c.slice(1, 3), c.slice(3, 5), c.slice(5));
      else if (loop.length > 1 && Math.hypot(...loop[0].map((v, i) => v - loop.at(-1)[i])) < 1e-10) loop.pop();
    }
    return loops.filter(a => a.length >= 3);
  }
  function outline(f, ch, { tolerance = f.unitsPerEm / 512 } = {}) {
    check(fonts.has(f), 'expected a typography font');
    if (!outlines.has(f)) outlines.set(f, new Map());
    const cache = outlines.get(f),
      g = f.glyph(ch),
      key = ch + '/' + tolerance;
    if (!cache.has(key)) {
      if (cache.size >= 4096) cache.clear();
      cache.set(key, freeze(flatten(g.commands, tolerance)));
    }
    return cache.get(key);
  }
  function layout(text, f, { size = 1, tracking = 0, lineHeight, align = 'left', kerning = true } = {}) {
    check(
      fonts.has(f) && typeof text === 'string' && [...text].length <= 4096,
      'expected a font and at most 4096 characters'
    );
    check(
      number(size, 1e-5, 1e5) &&
        number(tracking) &&
        ['left', 'center', 'right'].includes(align) &&
        typeof kerning === 'boolean',
      'invalid layout settings'
    );
    const scale = size / f.unitsPerEm,
      leading = lineHeight ?? (f.ascender - f.descender + f.lineGap) * scale;
    check(number(leading, 1e-5, 1e6), 'invalid line height');
    const glyphs = [],
      lines = [];
    let x = 0,
      line = 0,
      previous = null,
      index = 0;
    const finish = () => {
      const width = Math.max(0, x - (previous === null ? 0 : tracking)),
        shift = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
      for (const g of glyphs) if (g.line === line) g.x += shift;
      lines.push({ width, baseline: -line * leading });
    };
    for (const char of text.replace(/\r\n?/g, '\n')) {
      if (char === '\n') {
        finish();
        x = 0;
        line++;
        previous = null;
        continue;
      }
      const g = f.glyph(char === '\t' ? ' ' : char),
        advance = g.advance * scale * (char === '\t' ? 4 : 1);
      if (previous !== null && kerning) x += f.kerning(previous, char) * scale;
      glyphs.push({ index: index++, char, glyph: g, x, y: -line * leading, advance, scale, line });
      x += advance + tracking;
      previous = char;
    }
    finish();
    return Object.freeze({
      font: f,
      text,
      size,
      glyphs: freeze(glyphs),
      lines: freeze(lines),
      width: Math.max(...lines.map(l => l.width)),
      height: (f.ascender - f.descender) * scale + line * leading
    });
  }
  const mul = (a, b) =>
    Array.from({ length: 9 }, (_, i) => {
      const r = Math.floor(i / 3),
        c = i % 3;
      return a[r * 3] * b[c] + a[r * 3 + 1] * b[c + 3] + a[r * 3 + 2] * b[c + 6];
    });
  const app = (m, v) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function rotation([x, y, z]) {
    const a = Math.cos(x),
      b = Math.sin(x),
      c = Math.cos(y),
      d = Math.sin(y),
      e = Math.cos(z),
      f = Math.sin(z);
    return mul([c, 0, d, 0, 1, 0, -d, 0, c], mul([1, 0, 0, 0, a, -b, 0, b, a], [e, -f, 0, f, e, 0, 0, 0, 1]));
  }
  const hash = (x, seed) => {
    let h = (x ^ seed) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  };
  function pose(run, time = 0, options = {}) {
    check(fonts.has(run?.font) && number(time), 'expected a layout and finite time');
    const {
      path,
      offset = 0,
      fit = false,
      wrap = false,
      position = [0, 0, 0],
      rotation: angles = [0, 0, 0],
      scale = 1,
      transform,
      writeOn,
      scramble
    } = options;
    check(
      vector(position, 3) &&
        vector(angles, 3) &&
        number(offset) &&
        number(scale, 1e-6, 1e6) &&
        typeof fit === 'boolean' &&
        typeof wrap === 'boolean' &&
        (transform === undefined || typeof transform === 'function'),
      'invalid glyph transform'
    );
    if (path) check(number(path.length, 1e-8) && typeof path.frame === 'function', 'expected a transported curve path');
    const timing = o => {
      check(
        o && number(o.start ?? 0) && number(o.duration ?? 1, 1e-6, 1e6) && number(o.stagger ?? 0, 0, 1e6),
        'invalid animation timing'
      );
    };
    if (writeOn) timing(writeOn);
    if (scramble) {
      timing(scramble);
      check(
        number(scramble.rate ?? 16, 1e-5, 1e6) &&
          Number.isSafeInteger(scramble.seed ?? 1) &&
          typeof (scramble.chars ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') === 'string' &&
          [...(scramble.chars ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')].length > 0,
        'invalid scrambling'
      );
    }
    const global = rotation(angles),
      factor = path && fit ? path.length / Math.max(run.width, 1e-8) : 1,
      anchor = path && fit && run.glyphs.length ? Math.min(...run.glyphs.map(g => g.x)) : 0;
    return run.glyphs.map(g => {
      let char = g.char;
      if (scramble && char.trim()) {
        const local = time - (scramble.start ?? 0) - g.index * (scramble.stagger ?? 0);
        if (local >= 0 && local < (scramble.duration ?? 1)) {
          const chars = [...(scramble.chars ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')];
          char =
            chars[hash(g.index * 65537 + Math.floor(local * (scramble.rate ?? 16)), scramble.seed ?? 1) % chars.length];
        }
      }
      let progress = 1;
      if (writeOn) {
        const order = writeOn.reverse ? run.glyphs.length - 1 - g.index : g.index;
        progress = clamp((time - (writeOn.start ?? 0) - order * (writeOn.stagger ?? 0)) / (writeOn.duration ?? 1));
      }
      const custom = transform?.(g, time) ?? {},
        delta = custom.position ?? [0, 0, 0],
        turn = custom.rotation ?? [0, 0, 0],
        s = custom.scale ?? 1,
        opacity = custom.opacity ?? 1;
      check(
        vector(delta, 3) &&
          vector(turn, 3) &&
          (number(s, 0, 1e6) || (vector(s, 3) && s.every(v => v >= 0))) &&
          number(opacity, 0, 1),
        'invalid per-glyph transform'
      );
      let p = [g.x * factor, g.y * factor, 0],
        basis = identity,
        distance = offset + (g.x - anchor + g.advance / 2) * factor,
        visible = true;
      if (path) {
        const d = wrap ? ((distance % path.length) + path.length) % path.length : distance;
        visible = wrap || (d >= 0 && d <= path.length);
        const f = path.frame(d);
        check(vector(f.p, 3) && vector(f.T, 3) && vector(f.N, 3) && vector(f.B, 3), 'invalid path frame');
        basis = [f.T[0], f.N[0], f.B[0], f.T[1], f.N[1], f.B[1], f.T[2], f.N[2], f.B[2]];
        p = f.p.map((v, i) => v - (f.T[i] * g.advance * factor) / 2 + f.N[i] * g.y * factor);
      }
      const displacement = app(basis, delta);
      p = p.map((v, i) => v + displacement[i]);
      p = app(global, p).map((v, i) => position[i] + v * scale);
      const axes = mul(global, mul(basis, rotation(turn))),
        scales = typeof s === 'number' ? [s, s, s] : s;
      const matrix = axes.map((v, i) => v * scales[i % 3] * scale * factor);
      return {
        index: g.index,
        char,
        glyph: run.font.glyph(char),
        position: p,
        matrix,
        progress,
        opacity: visible ? opacity : 0,
        scale: g.scale,
        pathDistance: path ? distance : null
      };
    });
  }
  function strokes(loops, progress = 1) {
    check(number(progress, 0, 1), 'write-on progress must be 0..1');
    const lengths = loops.map(l =>
      l.reduce((n, p, i) => n + Math.hypot(p[0] - l[(i + 1) % l.length][0], p[1] - l[(i + 1) % l.length][1]), 0)
    );
    let remaining = lengths.reduce((a, b) => a + b, 0) * progress;
    const out = [];
    for (const l of loops) {
      if (remaining <= 0) break;
      const stroke = [l[0].slice()];
      for (let i = 0; i < l.length && remaining > 0; i++) {
        const a = l[i],
          b = l[(i + 1) % l.length],
          len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!len) continue;
        const u = Math.min(1, remaining / len);
        stroke.push(a.map((v, k) => v + (b[k] - v) * u));
        remaining -= len * u;
      }
      if (stroke.length > 1) out.push(stroke);
    }
    return out;
  }
  function bitmapFont(glyphs, { width = 6, height = 8, baseline = 7, name = 'Bitmap' } = {}) {
    check(
      Number.isSafeInteger(width) &&
        width > 0 &&
        width <= 256 &&
        Number.isSafeInteger(height) &&
        height > 0 &&
        height <= 256 &&
        number(baseline, 0, height) &&
        glyphs instanceof Map,
      'invalid bitmap font'
    );
    const traced = new Map();
    return font({
      name,
      unitsPerEm: height,
      ascender: baseline,
      descender: baseline - height,
      glyphs: ch => {
        if (traced.has(ch)) return traced.get(ch);
        const bits = glyphs.get(ch);
        if (!bits) return null;
        check(bits.length === width * height, 'invalid bitmap glyph');
        const edges = new Map(),
          key = (x, y) => x + ',' + y;
        const edge = (a, b) => {
          const reverse = key(...b) + '/' + key(...a);
          if (edges.has(reverse)) edges.delete(reverse);
          else edges.set(key(...a) + '/' + key(...b), [a, b]);
        };
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++)
            if (bits[y * width + x]) {
              const a = [x, baseline - y - 1],
                b = [x + 1, baseline - y - 1],
                c = [x + 1, baseline - y],
                d = [x, baseline - y];
              edge(a, b);
              edge(b, c);
              edge(c, d);
              edge(d, a);
            }
        const starts = new Map();
        for (const [id, [a, b]] of edges) {
          const k = key(...a);
          if (!starts.has(k)) starts.set(k, []);
          starts.get(k).push([id, b]);
        }
        const cs = [];
        while (edges.size) {
          const [id, [a, b]] = edges.entries().next().value;
          edges.delete(id);
          cs.push(['M', ...a], ['L', ...b]);
          let p = b,
            guard = 0;
          while (key(...p) !== key(...a)) {
            check(++guard <= width * height * 4, 'invalid bitmap boundary');
            const next = starts.get(key(...p))?.find(([i]) => edges.has(i));
            check(next, 'unclosed bitmap boundary');
            edges.delete(next[0]);
            p = next[1];
            cs.push(['L', ...p]);
          }
          cs.push(['Z']);
        }
        const g = { advance: width, commands: cs };
        traced.set(ch, g);
        return g;
      }
    });
  }
  function raster(f, ch, { pixelsPerEm = 32, padding = 1, samples = 1, color = 0xffffff } = {}) {
    check(
      fonts.has(f) &&
        number(pixelsPerEm, 1, 2048) &&
        Number.isSafeInteger(padding) &&
        padding >= 0 &&
        padding <= 32 &&
        [1, 2, 4].includes(samples) &&
        Number.isSafeInteger(color) &&
        color >= 0 &&
        color <= 0xffffff,
      'invalid glyph raster options'
    );
    const loops = outline(f, ch, { tolerance: f.unitsPerEm / (pixelsPerEm * 8) }),
      points = loops.flat(),
      k = pixelsPerEm / f.unitsPerEm;
    const lo = [Infinity, Infinity],
      hi = [-Infinity, -Infinity];
    for (const p of points)
      for (let axis = 0; axis < 2; axis++) {
        lo[axis] = Math.min(lo[axis], p[axis]);
        hi[axis] = Math.max(hi[axis], p[axis]);
      }
    const low = points.length ? lo.map(v => Math.floor(v * k)) : [0, 0],
      high = points.length ? hi.map(v => Math.ceil(v * k)) : [1, 1];
    const width = Math.max(1, high[0] - low[0] + padding * 2),
      height = Math.max(1, high[1] - low[1] + padding * 2);
    check(width * height <= 4194304 && height * samples * points.length <= 64000000, 'glyph raster budget exceeded');
    const rgba = new Uint8Array(width * height * 4),
      hits = new Uint8Array(width * height);
    // Scan once per subpixel row, rather than testing every pixel against every edge.
    for (let y = 0; y < height; y++)
      for (let sy = 0; sy < samples; sy++) {
        const py = (high[1] - y + padding - (sy + 0.5) / samples) / k,
          crossings = [];
        for (const l of loops)
          for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
            const a = l[i],
              b = l[j];
            if (a[1] > py !== b[1] > py)
              crossings.push(((((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) * k - low[0] + padding) * samples);
          }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i + 1 < crossings.length; i += 2) {
          const start = Math.max(0, Math.ceil(crossings[i] - 0.5)),
            end = Math.min(width * samples, Math.ceil(crossings[i + 1] - 0.5));
          for (let x = start; x < end; x++) hits[y * width + Math.floor(x / samples)]++;
        }
      }
    for (let i = 0; i < hits.length; i++)
      if (hits[i])
        rgba.set([color >>> 16, (color >>> 8) & 255, color & 255, Math.round((hits[i] / samples ** 2) * 255)], i * 4);
    return {
      width,
      height,
      rgba,
      bounds: [(low[0] - padding) / k, (low[1] - padding) / k, (high[0] + padding) / k, (high[1] + padding) / k],
      pixelsPerEm
    };
  }
  return Object.freeze({
    font,
    flatten,
    outline,
    layout,
    pose,
    strokes,
    bitmapFont,
    raster,
    trueType(bytes, options) {
      return (typeof TrueTypeFont !== 'undefined' ? TrueTypeFont : require('./typography-truetype.js')).read(
        bytes,
        font,
        options
      );
    },
    transform: (frame, p) => app(frame.matrix, p).map((v, i) => v + frame.position[i]),
    smooth
  });
})();
if (typeof module !== 'undefined') module.exports = Typography;
