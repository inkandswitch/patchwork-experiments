/* kpz-sprite: little pixel pictures written as code, and drawn past the edge of a thing, the way a pixel artist breaks a smooth outline
   with a tuft, a clump of leaves or a hanging strand. A sprite is plain data, made from text or by a rule, so an author can write one
   by hand or have a generator make as many as are wanted; one placement routine, in both renderers, puts them on the picture.

   K.sprite.art(text, o)    a sprite from text art: one line a row, as it stands on top of a thing (the last line touches the edge);
        '.' or ' ' is empty, '#' the colour of the edge where it stands, '+' a step lighter, '*' two lighter, '-' a step darker, '='
        two darker; o.key adds characters: a number (steps lighter, or darker if negative) or { pal: i } (that palette colour, as a
        flower). o.hang: the text is drawn hanging (the first line touches the edge), for things that hang from an edge. o.sink: rows
        that overlap the thing itself (0: it starts just past the edge; 1 covers the edge pixel and its outline). o.ax: the column that
        stands on the anchor (the middle). At most 7 wide and 6 tall.
        -> { w, h, ax, sink, cells: [row 0 (the root) ... ] } with cells[r * w + c] = 0 empty, 8 + steps, or 100 + palette index
   K.sprite.gen             rules that make sprites, each from a seed: as many as are asked for, all a little different
        .tuft({ h, blades, lean, seed })       grass blades, the tips lit
        .bump({ w, h, seed })                   a clump of leaves rounding the edge of a crown, lit on top, a softer line round it
        .strand({ len, leaves, seed })          a hanging strand of ivy or moss with leaves off it (hangs)
        .spike({ h, seed })                     a needle tip, for pines
        .flower({ h, pal, seed })               a stalk with a flower on it (pal: the flower's palette index)
   K.sprite.set(name, o)    a ready list: 'grass', 'leafy', 'ivy', 'needles', 'meadow' (o.pal for the flowers), o.n how many (6)
   K.sprite.tint(sprites, ramp, band)  the same sprites in colours of their own (a ramp of palette indices, '#' at its step `band`,
        the others steps from there), not the colours of the edge they stand on: moss on a stone wall, ivy hanging from a roof
   K.pixel.edge(mat, o)     the material with sprites along its edges: o.up (on edges that face up: a list of sprites or a set's
        name), o.side (left and right edges, the sprite turned on its side), o.down (edges that face down, for hanging sprites);
        o.every (screen pixels between two places a sprite may stand: 6), o.share (of those, how many have one: 0.7), o.seed.
        Each stands on a point pinned to the surface (K.pixel.anchors: one in a cell of the world, moving with the dab under
        it), drawn in whole screen pixels like a billboard, turned the way its surface faces on the screen, and shown only past
        the edge of its own surface. So it never crawls as the view pans, and as the view turns it sinks behind the edge a pixel
        at a time; drawing back thins the points (the same ones go first), so the sprites stay as far apart on the screen.
   K.pixel.plain(o)         a material with no pattern of its own (its ramp lit as usual), to carry edge sprites */
(function (K) {
  const rnd = s => {
    let x = (s >>> 0) * 2654435761 + 1 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  };
  const MAXW = 7,
    MAXH = 6;
  const KEY = { '#': 0, '+': 1, '*': 2, '-': -1, '=': -2 };
  const art = (text, o) => {
    o = o || {};
    const key = Object.assign({}, KEY, o.key || {});
    let rows = String(text)
      .split('\n')
      .map(r => r.replace(/\s+$/, ''))
      .filter(r => r.trim().length);
    if (!rows.length) throw new Error('K.sprite.art: an empty sprite');
    const ind = Math.min(...rows.map(r => r.match(/^ */)[0].length));
    rows = rows.map(r => r.slice(ind));
    // row 0 is the root: the last line for a sprite that stands, the first for one that hangs
    if (!o.hang) rows.reverse();
    while (rows.length > 1 && !/[^. ]/.test(rows[rows.length - 1])) rows.pop(); // (nothing past the outermost pixel)
    const w = Math.max(...rows.map(r => r.length)),
      h = rows.length;
    if (w > MAXW || h > MAXH) throw new Error(`K.sprite.art: ${w} x ${h} is bigger than ${MAXW} x ${MAXH}`);
    const cells = new Array(w * h).fill(0);
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        const ch = r[x];
        if (ch === '.' || ch === ' ') continue;
        const v = key[ch];
        if (v === undefined) throw new Error(`K.sprite.art: '${ch}' is not in the key`);
        cells[y * w + x] = typeof v === 'object' ? 100 + v.pal : 8 + Math.max(-7, Math.min(7, Math.round(v)));
      }
    });
    return { w, h, ax: o.ax === undefined ? Math.floor((w - 1) / 2) : o.ax, sink: o.sink || 0, hang: !!o.hang, cells };
  };
  // the text a sprite would be written as (to look at one, or to write it out by hand and change it)
  const show = s => {
    const back = { 8: '#', 9: '+', 10: '*', 7: '-', 6: '=' },
      rows = [];
    for (let y = 0; y < s.h; y++) {
      let r = '';
      for (let x = 0; x < s.w; x++) {
        const v = s.cells[y * s.w + x];
        r += v === 0 ? '.' : v >= 100 ? 'o' : back[v] || (v > 8 ? '*' : '=');
      }
      rows.push(r);
    }
    return (s.hang ? rows : rows.reverse()).join('\n');
  };
  const grid = (w, h) => Array.from({ length: h }, () => new Array(w).fill('.'));
  const fromGrid = (g, o) => art(g.map(r => r.join('')).join('\n'), o);
  const gen = {
    // blades from a root: each leans a little, the tip a step lighter, the root a step darker where it meets the ground
    tuft(o) {
      o = o || {};
      const R = rnd(o.seed || 1),
        H = Math.min(MAXH, o.h || 3 + Math.floor(R() * 2)),
        n = o.blades || 2 + Math.floor(R() * 2),
        fan = o.lean === undefined ? 1 : o.lean,
        W = Math.min(MAXW, 2 * Math.ceil(((n - 1) / 2) * 2 * fan + 0.5) + 1),
        g = grid(W, H),
        mid = Math.floor(W / 2);
      // a fan of blades from a narrow root, each leaning out a little more than the last, the middle one the tallest
      for (let b = 0; b < n; b++) {
        const off = b - (n - 1) / 2,
          x0 = mid + Math.round(off * 0.6),
          x1 = Math.max(0, Math.min(W - 1, mid + Math.round(off * 2 * fan + (R() - 0.5) * 0.8))),
          hb = Math.max(2, H - Math.round(Math.abs(off) * 0.8) - (R() < 0.3 ? 1 : 0));
        for (let y = 0; y < hb; y++) {
          const x = Math.round(x0 + ((x1 - x0) * y) / Math.max(1, hb - 1));
          g[H - 1 - y][x] = y === hb - 1 ? '+' : '#';
        }
      }
      return fromGrid(g, { ax: mid });
    },
    // a clump of leaves: a low dome, its outer pixels a step darker (a softer line than the thing's own), lit up and to the left
    bump(o) {
      o = o || {};
      const R = rnd(o.seed || 2),
        W = Math.min(MAXW, o.w || 4 + Math.floor(R() * 2)),
        H = Math.min(MAXH, o.h || 2 + Math.floor(R() * 2)),
        g = grid(W, H + 1),
        cx = (W - 1) / 2;
      for (let y = 0; y <= H; y++)
        for (let x = 0; x < W; x++) {
          const u = (x - cx) / (W / 2),
            v = y / (H + 0.4);
          if (u * u + v * v > 1) continue;
          g[H - y][x] = '#';
        }
      for (let y = 0; y <= H; y++)
        for (let x = 0; x < W; x++) {
          if (g[H - y][x] !== '#') continue;
          const out = (xx, yy) => xx < 0 || xx >= W || yy > H || g[H - yy][xx] === '.';
          if (y > 0 && (out(x, y + 1) || out(x - 1, y) || out(x + 1, y))) g[H - y][x] = '-';
          else if (y > 0 && x < cx && out(x, y + 2)) g[H - y][x] = '+';
        }
      // (the root row lies over the edge of the thing, so its outline does not cut the clump off from it)
      return fromGrid(g, { sink: 1 });
    },
    // a strand that hangs: a stem a step darker, leaves off it to either side
    strand(o) {
      o = o || {};
      const R = rnd(o.seed || 3),
        H = Math.min(MAXH, o.len || 3 + Math.floor(R() * 3)),
        W = 3,
        g = grid(W, H);
      let x = 1;
      for (let y = 0; y < H; y++) {
        g[y][x] = '-';
        if (y > 0 && R() < (o.leaves === undefined ? 0.6 : o.leaves)) g[y][R() < 0.5 ? 0 : 2] = y === H - 1 ? '#' : '+';
      }
      g[H - 1][x] = '#';
      return fromGrid(g, { hang: true, ax: 1 });
    },
    // a needle tip: a spike two or three pixels tall, a step lighter at the very end
    spike(o) {
      o = o || {};
      const R = rnd(o.seed || 4),
        H = Math.min(MAXH, o.h || 2 + Math.floor(R() * 2)),
        g = grid(3, H);
      for (let y = 0; y < H; y++) g[H - 1 - y][1] = y === H - 1 ? '+' : '#';
      if (H > 2) g[H - 1][R() < 0.5 ? 0 : 2] = '#';
      return fromGrid(g, { ax: 1 });
    },
    // a stalk with a flower: the stalk the edge's colour, the head of palette colour o.pal
    flower(o) {
      o = o || {};
      const R = rnd(o.seed || 5),
        H = Math.min(MAXH, o.h || 3 + Math.floor(R() * 2)),
        g = grid(3, H);
      for (let y = 0; y < H - 1; y++) g[H - 1 - y][1] = '#';
      g[0][1] = 'o';
      if (R() < 0.6) g[1][R() < 0.5 ? 0 : 2] = 'o';
      return fromGrid(g, { ax: 1, key: { o: { pal: o.pal === undefined ? 0 : o.pal } } });
    }
  };
  const sets = {
    grass: o => Array.from({ length: o.n || 6 }, (_, i) => gen.tuft({ seed: (o.seed || 11) + i * 7 })),
    leafy: o => Array.from({ length: o.n || 6 }, (_, i) => gen.bump({ seed: (o.seed || 13) + i * 5 })),
    ivy: o => Array.from({ length: o.n || 6 }, (_, i) => gen.strand({ seed: (o.seed || 17) + i * 3 })),
    needles: o => Array.from({ length: o.n || 6 }, (_, i) => gen.spike({ seed: (o.seed || 19) + i * 3 })),
    meadow: o =>
      Array.from({ length: o.n || 6 }, (_, i) =>
        i % 3 === 2 && o.pal !== undefined
          ? gen.flower({ seed: (o.seed || 23) + i, pal: Array.isArray(o.pal) ? o.pal[i % o.pal.length] : o.pal })
          : gen.tuft({ seed: (o.seed || 23) + i * 7 })
      )
  };
  const tint = (list, ramp, band) =>
    (Array.isArray(list) ? list : [list]).map(sp =>
      Object.assign({}, sp, {
        cells: sp.cells.map(v =>
          v === 0 || v >= 100 ? v : 100 + ramp[Math.max(0, Math.min(ramp.length - 1, (band || 0) + v - 8))]
        )
      })
    );
  K.sprite = {
    atlas: AtlasSprites.compile,
    placeAtlas: AtlasSprites.place,
    art,
    show,
    gen,
    tint,
    set(name, o) {
      if (!sets[name]) throw new Error(`K.sprite.set: no set '${name}' (there are ${Object.keys(sets).join(', ')})`);
      return sets[name](o || {});
    },
    MAXW,
    MAXH
  };
  const list = (v, seed) => (!v ? [] : typeof v === 'string' ? K.sprite.set(v, { seed }) : Array.isArray(v) ? v : [v]);
  // a pattern-less material, so a plain ramp can carry edge sprites (and anything else a pattern carries)
  const spec = (kind, o) => ({
    kind,
    o: JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' || k === 'px' || k === 'fl' ? undefined : v)))
  });
  K.pixel.plain = o => {
    const r = o.r;
    return Object.assign({}, o, {
      pat: spec('plain', { r }),
      tex: (x, y, z, ny, t, nx, nz, AA, fp, ramp) => {
        const rr = ramp || r;
        return rr[Math.max(0, Math.min(rr.length - 1, Math.floor(t * rr.length)))];
      }
    });
  };
  K.pixel.edge = (mat, o) => {
    o = o || {};
    // (a material with no pattern gets a plain one, which only carries the sprites: it is coloured as it was)
    const base = mat.pat ? mat : Object.assign({}, mat, { pat: spec('plain', {}) }),
      edge = {
        up: list(o.up, o.seed),
        side: list(o.side, o.seed),
        down: list(o.down, o.seed),
        every: o.every || 6,
        share: o.share === undefined ? 0.7 : o.share,
        seed: o.seed || 1
      };
    for (const s of edge.up.concat(edge.side, edge.down))
      if (!s || !s.cells || s.w > MAXW || s.h > MAXH)
        throw new Error('K.pixel.edge: a sprite is not one K.sprite made');
    return Object.assign({}, base, { pat: Object.assign({}, base.pat, { edge }) });
  };
  /* where the sprites stand: points pinned to the surface, the same for both renderers. Each material with edge sprites gets cells
     of the world half `every` pixels across (at the diorama's own pixel size); in each, the point the cell's hash picks, laid on the
     surface of the dab nearest it and facing as that surface faces. Each point has a rank (0..1, from its cell): the picture keeps
     those under a share that falls as the view draws back, so drawing back takes them away one by one and none ever moves. A sprite
     stands on its point, turned the way the surface faces on the screen (up, to a side, down), and shows only past the edge of its
     own surface: where the point turns away behind the edge its sprite sinks behind it a pixel at a time, rather than going at once.
     -> { n, data: Float32Array(n * 12): x, y, z, dab, nx, ny, nz, rank, pattern, ramp, lit, pick } (null if nothing has sprites) */
  const ahash = (i, j, k, s) => {
    let h = (i * 374761393 + j * 668265263 + k * 1440662683 + s * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    h = Math.imul(h, 2246822519);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  K.pixel.anchors = W => {
    if (W._anchors !== undefined) return W._anchors;
    const pats = W.pats || [],
      px0 = 1 / (W.detail || 12),
      pix = W.pix,
      D = W.data;
    let out = null;
    if (pix && pats.some(p => p && p.edge && p.edge.up.length + p.edge.side.length + p.edge.down.length)) {
      const best = new Map();
      for (let i = 0; i < W.count; i++) {
        const k = pix[i * 8 + 2] - 1;
        if (k < 0 || k >= 32 || !pix[i * 8]) continue;
        const e = pats[k] && pats[k].edge;
        if (!e) continue;
        const G = ((e.every || 6) * px0) / 2,
          x = D[i * 16],
          y = D[i * 16 + 1],
          z = D[i * 16 + 2],
          cx = Math.floor(x / G),
          cy = Math.floor(y / G),
          cz = Math.floor(z / G),
          key = ((k * 4096 + cx + 2048) * 4096 + cy + 2048) * 4096 + cz + 2048,
          hx = (cx + 0.2 + 0.6 * ahash(cx, cy, cz, 1)) * G,
          hy = (cy + 0.2 + 0.6 * ahash(cx, cy, cz, 2)) * G,
          hz = (cz + 0.2 + 0.6 * ahash(cx, cy, cz, 3)) * G,
          d2 = (x - hx) ** 2 + (y - hy) ** 2 + (z - hz) ** 2,
          b = best.get(key);
        if (!b || d2 < b.d2) best.set(key, { i, d2, hx, hy, hz, cx, cy, cz, k });
      }
      const data = new Float32Array(best.size * 12);
      let m = 0;
      for (const { i, hx, hy, hz, cx, cy, cz, k } of best.values()) {
        const nx = pix[i * 8 + 3],
          ny = pix[i * 8 + 4],
          nz = pix[i * 8 + 5],
          x = D[i * 16],
          y = D[i * 16 + 1],
          z = D[i * 16 + 2],
          dd = (hx - x) * nx + (hy - y) * ny + (hz - z) * nz;
        let ax = hx - dd * nx,
          ay = hy - dd * ny,
          az = hz - dd * nz;
        // (a cell the surface only partly covers: its point may lie off the surface's edge, so it takes the dab's own place)
        if ((ax - x) ** 2 + (ay - y) ** 2 + (az - z) ** 2 > px0 * px0) ((ax = x), (ay = y), (az = z));
        data.set(
          [
            ax,
            ay,
            az,
            i,
            nx,
            ny,
            nz,
            ahash(cx, cy, cz, 811 + k),
            k,
            pix[i * 8] - 1,
            pix[i * 8 + 1],
            ahash(cx, cy, cz, 977)
          ],
          m * 12
        );
        m++;
      }
      out = { n: m, data };
    }
    W._anchors = out;
    return out;
  };
  // how many of the points are kept at a size of screen pixel fp (world units): one in four at the diorama's own size, all of
  // them at a quarter of it, fewer drawing back (times the material's share)
  K.pixel.anchorKeep = (W, fp) => Math.min(1, (0.25 * (1 / (W.detail || 12))) / Math.max(1e-6, fp));
  K.pixel.edgeTable = W => {
    const pats = (W.pats || []).slice(0, 32),
      sprites = [],
      ix = new Map(),
      per = new Float32Array(32 * 8);
    // (each list is one run in the table; a list used by two materials is there once)
    const add = arr => {
      if (!arr.length) return [0, 0];
      const key = JSON.stringify(arr);
      if (!ix.has(key)) {
        if (sprites.length + arr.length > 64) return [0, 0];
        ix.set(key, sprites.length);
        sprites.push(...arr);
      }
      return [ix.get(key), arr.length];
    };
    let any = false;
    pats.forEach((pt, k) => {
      const e = pt && pt.edge;
      if (!e) return;
      const u = add(e.up || []),
        s = add(e.side || []),
        d = add(e.down || []);
      per.set([u[0], u[1], s[0], s[1], d[0], d[1], e.every || 6, e.share === undefined ? 0.7 : e.share], k * 8);
      if (u[1] + s[1] + d[1]) any = true;
    });
    return { any, per, sprites: sprites.slice(0, 64) };
  };
})(KIT);
