// SFNT TrueType outlines, Unicode cmap and horizontal pair kerning. Not a shaping engine.
const TrueTypeFont = (() => {
  const fail = message => {
    throw new RangeError('TrueType: ' + message);
  };
  function reader(bytes) {
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const range = (p, n) => {
      if (!Number.isSafeInteger(p) || p < 0 || p + n > d.byteLength) fail('truncated or invalid table offset');
    };
    return {
      length: bytes.length,
      u8(p) {
        range(p, 1);
        return d.getUint8(p);
      },
      i8(p) {
        range(p, 1);
        return d.getInt8(p);
      },
      u16(p) {
        range(p, 2);
        return d.getUint16(p);
      },
      i16(p) {
        range(p, 2);
        return d.getInt16(p);
      },
      u32(p) {
        range(p, 4);
        return d.getUint32(p);
      },
      slice(p, n) {
        range(p, n);
        return reader(bytes.subarray(p, p + n));
      }
    };
  }
  function read(input, createFont, { name = 'TrueType', kerning: overrides = {} } = {}) {
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : null;
    if (!bytes || bytes.length > 64 * 1024 * 1024) fail('expected at most 64 MiB of font bytes');
    const r = reader(bytes),
      signature = r.u32(0);
    if (signature !== 0x00010000 && signature !== 0x74727565)
      fail('expected an uncompressed glyf-based .ttf; CFF, WOFF and collections are unsupported');
    const count = r.u16(4);
    if (count > 256) fail('table budget exceeded');
    const tables = new Map();
    for (let i = 0; i < count; i++) {
      const p = 12 + i * 16,
        tag = String.fromCharCode(r.u8(p), r.u8(p + 1), r.u8(p + 2), r.u8(p + 3));
      if (tables.has(tag)) fail('duplicate table');
      tables.set(tag, r.slice(r.u32(p + 8), r.u32(p + 12)));
    }
    const table = tag => tables.get(tag) ?? fail('missing ' + tag + ' table'),
      head = table('head'),
      hhea = table('hhea'),
      maxp = table('maxp'),
      loca = table('loca'),
      glyf = table('glyf'),
      hmtx = table('hmtx'),
      cmap = table('cmap');
    const unitsPerEm = head.u16(18),
      numGlyphs = maxp.u16(4),
      metrics = hhea.u16(34),
      longLoc = head.i16(50);
    if (!numGlyphs || !metrics || metrics > numGlyphs || ![0, 1].includes(longLoc)) fail('invalid glyph metrics');
    const locations = [];
    for (let i = 0; i <= numGlyphs; i++) {
      const p = longLoc ? loca.u32(i * 4) : loca.u16(i * 2) * 2;
      if (p > glyf.length || (i && p < locations[i - 1])) fail('invalid loca range');
      locations.push(p);
    }
    hmtx.slice(0, metrics * 4 + (numGlyphs - metrics) * 2);
    const advance = id => hmtx.u16(Math.min(id, metrics - 1) * 4);
    const mappings = [];
    for (let i = 0; i < cmap.u16(2); i++) {
      const p = 4 + i * 8,
        platform = cmap.u16(p),
        encoding = cmap.u16(p + 2),
        offset = cmap.u32(p + 4);
      if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
      const format = cmap.u16(offset);
      if (format === 4 || format === 12) mappings.push({ format, offset });
    }
    mappings.sort((a, b) => b.format - a.format);
    if (!mappings.length) fail('needs Unicode cmap format 4 or 12');
    const mapping = mappings[0],
      cm = cmap.slice(
        mapping.offset,
        mapping.format === 12 ? cmap.u32(mapping.offset + 4) : cmap.u16(mapping.offset + 2)
      );
    const gid = cp => {
      let id = 0;
      if (mapping.format === 12) {
        let lo = 0,
          hi = cm.u32(12) - 1;
        if (hi > 1000000) fail('cmap group budget exceeded');
        cm.slice(16, (hi + 1) * 12);
        while (lo <= hi) {
          const m = (lo + hi) >>> 1,
            p = 16 + m * 12,
            a = cm.u32(p),
            b = cm.u32(p + 4);
          if (cp < a) hi = m - 1;
          else if (cp > b) lo = m + 1;
          else {
            id = cm.u32(p + 8) + cp - a;
            break;
          }
        }
      } else if (cp <= 65535) {
        const n = cm.u16(6) / 2;
        if (!Number.isInteger(n) || !n) fail('invalid cmap segments');
        cm.slice(14, n * 8 + 2);
        for (let i = 0; i < n; i++) {
          if (cp > cm.u16(14 + i * 2)) continue;
          const start = cm.u16(16 + n * 2 + i * 2);
          if (cp < start) break;
          const delta = cm.i16(16 + n * 4 + i * 2),
            at = 16 + n * 6 + i * 2,
            ro = cm.u16(at);
          id = ro ? cm.u16(at + ro + (cp - start) * 2) : cp;
          if (!ro || id) id = (id + delta) & 65535;
          break;
        }
      }
      return id < numGlyphs ? id : 0;
    };
    const cache = new Map();
    let totalPoints = 0;
    function glyph(id, stack = []) {
      if (cache.has(id)) return cache.get(id);
      if (id >= numGlyphs || stack.includes(id) || stack.length > 16) fail('invalid or recursive composite glyph');
      const start = locations[id],
        end = locations[id + 1];
      if (start === end) {
        const empty = { contours: [], points: [], advance: advance(id) };
        cache.set(id, empty);
        return empty;
      }
      const g = glyf.slice(start, end - start),
        nc = g.i16(0),
        contours = [],
        points = [];
      let p = 10,
        glyphAdvance = advance(id);
      if (nc >= 0) {
        if (nc > 4096) fail('contour budget exceeded');
        const ends = [];
        for (let i = 0; i < nc; i++) {
          const e = g.u16(p);
          p += 2;
          if (i && e <= ends[i - 1]) fail('invalid contour endpoints');
          ends.push(e);
        }
        const n = nc ? ends.at(-1) + 1 : 0;
        if (n > 65536) fail('point budget exceeded');
        const instructions = g.u16(p);
        p += 2;
        g.slice(p, instructions);
        p += instructions;
        const flags = [];
        while (flags.length < n) {
          const f = g.u8(p++);
          flags.push(f);
          if (f & 8) {
            const repeats = g.u8(p++);
            if (flags.length + repeats > n) fail('invalid repeated flags');
            for (let j = 0; j < repeats; j++) flags.push(f);
          }
        }
        const xs = [],
          ys = [];
        let x = 0,
          y = 0;
        for (const f of flags) {
          if (f & 2) {
            const d = g.u8(p++);
            x += f & 16 ? d : -d;
          } else if (!(f & 16)) {
            x += g.i16(p);
            p += 2;
          }
          xs.push(x);
        }
        for (const f of flags) {
          if (f & 4) {
            const d = g.u8(p++);
            y += f & 32 ? d : -d;
          } else if (!(f & 32)) {
            y += g.i16(p);
            p += 2;
          }
          ys.push(y);
        }
        for (let i = 0; i < n; i++) points.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
        let from = 0;
        for (const e of ends) {
          contours.push(points.slice(from, e + 1));
          from = e + 1;
        }
      } else {
        if (nc !== -1) fail('invalid composite contour count');
        let flags,
          instructions = false,
          parts = 0;
        do {
          if (++parts > 256) fail('composite component budget exceeded');
          flags = g.u16(p);
          instructions ||= !!(flags & 256);
          const child = g.u16(p + 2);
          p += 4;
          let a, b;
          if (flags & 1) {
            a = flags & 2 ? g.i16(p) : g.u16(p);
            b = flags & 2 ? g.i16(p + 2) : g.u16(p + 2);
            p += 4;
          } else {
            a = flags & 2 ? g.i8(p) : g.u8(p);
            b = flags & 2 ? g.i8(p + 1) : g.u8(p + 1);
            p += 2;
          }
          let xx = 1,
            xy = 0,
            yx = 0,
            yy = 1;
          const fixed = () => {
            const n = g.i16(p) / 16384;
            p += 2;
            return n;
          };
          if (flags & 8) xx = yy = fixed();
          else if (flags & 64) {
            xx = fixed();
            yy = fixed();
          } else if (flags & 128) {
            xx = fixed();
            yx = fixed();
            xy = fixed();
            yy = fixed();
          }
          const raw = glyph(child, [...stack, id]),
            transformed = raw.points.map(q => ({ x: xx * q.x + xy * q.y, y: yx * q.x + yy * q.y, on: q.on }));
          if (flags & 512) glyphAdvance = raw.advance;
          let dx, dy;
          if (flags & 2) {
            dx = a;
            dy = b;
            if (flags & 2048) {
              [dx, dy] = [xx * a + xy * b, yx * a + yy * b];
            }
            if (flags & 4) {
              dx = Math.round(dx);
              dy = Math.round(dy);
            }
          } else {
            if (!points[a] || !transformed[b]) fail('invalid composite point attachment');
            dx = points[a].x - transformed[b].x;
            dy = points[a].y - transformed[b].y;
          }
          for (const q of transformed) {
            q.x += dx;
            q.y += dy;
          }
          let at = 0;
          for (const contour of raw.contours) {
            contours.push(transformed.slice(at, at + contour.length));
            at += contour.length;
          }
          points.push(...transformed);
          if (points.length > 65536) fail('composite point budget exceeded');
        } while (flags & 32);
        if (instructions) {
          const length = g.u16(p);
          g.slice(p + 2, length);
        }
      }
      totalPoints += points.length;
      if (totalPoints > 2000000) fail('decoded point budget exceeded');
      const result = { contours, points, advance: glyphAdvance };
      cache.set(id, result);
      return result;
    }
    function outline(id) {
      const cs = [];
      for (const raw of glyph(id).contours) {
        if (!raw.length) continue;
        const points = [];
        for (let i = 0; i < raw.length; i++) {
          const a = raw[i],
            b = raw[(i + 1) % raw.length];
          points.push(a);
          if (!a.on && !b.on) points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
        }
        const first = points.findIndex(q => q.on);
        if (first < 0) continue;
        const ring = points.slice(first).concat(points.slice(0, first));
        cs.push(['M', ring[0].x, ring[0].y]);
        for (let i = 1; i <= ring.length; i++) {
          const q = ring[i % ring.length];
          if (q.on) cs.push(['L', q.x, q.y]);
          else {
            const end = ring[(i + 1) % ring.length];
            cs.push(['Q', q.x, q.y, end.x, end.y]);
            i++;
          }
        }
        cs.push(['Z']);
      }
      return cs;
    }
    const legacy = new Map(),
      kern = tables.get('kern');
    if (kern && kern.u16(0) === 0) {
      let p = 4;
      for (let t = 0; t < kern.u16(2); t++) {
        const length = kern.u16(p + 2),
          coverage = kern.u16(p + 4),
          s = kern.slice(p, length);
        if (length < 6) fail('invalid kern subtable');
        if ((coverage & 0xff00) === 0 && (coverage & 7) === 1) {
          const n = s.u16(6);
          s.slice(14, n * 6);
          for (let i = 0; i < n; i++) {
            const q = 14 + i * 6,
              key = s.u16(q) * 65536 + s.u16(q + 2),
              value = s.i16(q + 4);
            legacy.set(key, (coverage & 8 ? 0 : (legacy.get(key) ?? 0)) + value);
          }
        }
        p += length;
      }
    }
    const pairLookups = positioning(tables.get('GPOS'));
    return createFont({
      name,
      unitsPerEm,
      ascender: hhea.i16(4),
      descender: hhea.i16(6),
      lineGap: Math.max(0, hhea.i16(8)),
      fallback: '?',
      glyphs: ch => {
        const id = gid(ch.codePointAt(0));
        if (!id) return null;
        return { id, advance: glyph(id).advance, commands: outline(id) };
      },
      kerning: (a, b) => {
        if (Object.hasOwn(overrides, a + ',' + b)) return overrides[a + ',' + b];
        const x = gid(a.codePointAt(0)),
          y = gid(b.codePointAt(0));
        let sum = 0,
          found = false;
        for (const lookup of pairLookups) {
          const n = lookup(x, y);
          if (n !== null) {
            found = true;
            sum += n;
          }
        }
        return found ? sum : (legacy.get(x * 65536 + y) ?? 0);
      }
    });
  }
  function positioning(g) {
    if (!g) return [];
    const features = g.u16(6),
      lookups = g.u16(8),
      selected = new Set();
    for (let i = 0; i < g.u16(features); i++) {
      const p = features + 2 + i * 6,
        tag = String.fromCharCode(g.u8(p), g.u8(p + 1), g.u8(p + 2), g.u8(p + 3));
      if (tag !== 'kern') continue;
      const f = features + g.u16(p + 4);
      for (let j = 0; j < g.u16(f + 2); j++) selected.add(g.u16(f + 4 + j * 2));
    }
    const coverage = (base, id) => {
      const format = g.u16(base),
        n = g.u16(base + 2);
      if (format === 1) {
        for (let i = 0; i < n; i++) if (g.u16(base + 4 + i * 2) === id) return i;
        return -1;
      }
      if (format === 2) {
        for (let i = 0; i < n; i++) {
          const p = base + 4 + i * 6;
          if (id >= g.u16(p) && id <= g.u16(p + 2)) return g.u16(p + 4) + id - g.u16(p);
        }
        return -1;
      }
      fail('unsupported GPOS coverage');
    };
    const cls = (base, id) => {
      const format = g.u16(base);
      if (format === 1) {
        const start = g.u16(base + 2),
          n = g.u16(base + 4);
        return id >= start && id < start + n ? g.u16(base + 6 + (id - start) * 2) : 0;
      }
      if (format === 2) {
        for (let i = 0; i < g.u16(base + 2); i++) {
          const p = base + 4 + i * 6;
          if (id >= g.u16(p) && id <= g.u16(p + 2)) return g.u16(p + 4);
        }
        return 0;
      }
      fail('unsupported GPOS class definition');
    };
    const value = (p, format) => {
      let x = 0;
      for (let bit = 0; bit < 8; bit++)
        if (format & (1 << bit)) {
          if (bit === 2) x = g.i16(p);
          else g.u16(p);
          p += 2;
        }
      return { x, next: p };
    };
    const pair = (p, a, b) => {
      const format = g.u16(p),
        index = coverage(p + g.u16(p + 2), a);
      if (index < 0) return null;
      const f1 = g.u16(p + 4),
        f2 = g.u16(p + 6);
      if (f1 > 255 || f2 > 255) fail('invalid GPOS value format');
      if (format === 1) {
        const n = g.u16(p + 8);
        if (index >= n) fail('invalid GPOS pair coverage');
        let at = p + g.u16(p + 10 + index * 2);
        const count = g.u16(at);
        at += 2;
        for (let i = 0; i < count; i++) {
          const second = g.u16(at),
            v = value(at + 2, f1),
            w = value(v.next, f2);
          if (second === b) return v.x;
          at = w.next;
        }
        return null;
      }
      if (format === 2) {
        const c1 = cls(p + g.u16(p + 8), a),
          c2 = cls(p + g.u16(p + 10), b),
          n1 = g.u16(p + 12),
          n2 = g.u16(p + 14);
        if (c1 >= n1 || c2 >= n2) fail('invalid GPOS class index');
        const size =
          2 * Array.from({ length: 8 }, (_, i) => !!(f1 & (1 << i)) + !!(f2 & (1 << i))).reduce((a, b) => a + b, 0);
        return value(p + 16 + (c1 * n2 + c2) * size, f1).x;
      }
      return null;
    };
    const result = [];
    for (const index of selected) {
      if (index >= g.u16(lookups)) fail('invalid GPOS lookup index');
      const l = lookups + g.u16(lookups + 2 + index * 2),
        type = g.u16(l),
        flags = g.u16(l + 2);
      if (flags !== 0 || ![2, 9].includes(type)) continue;
      const subs = [];
      for (let j = 0; j < g.u16(l + 4); j++) {
        let p = l + g.u16(l + 6 + j * 2);
        if (type === 9) {
          if (g.u16(p) !== 1 || g.u16(p + 2) !== 2) continue;
          p += g.u32(p + 4);
        }
        subs.push(p);
      }
      result.push((a, b) => {
        for (const p of subs) {
          const n = pair(p, a, b);
          if (n !== null) return n;
        }
        return null;
      });
    }
    return result;
  }
  return Object.freeze({ read });
})();
if (typeof module !== 'undefined') module.exports = TrueTypeFont;
