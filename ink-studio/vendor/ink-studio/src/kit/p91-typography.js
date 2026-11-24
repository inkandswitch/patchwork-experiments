// Typography shares native SDF solids, rig ownership, atlas surfaces and materialisation.
(function (K) {
  const T = Typography,
    { V, M } = K;
  let sansFont, bitmap;
  const polygon = points => [['M', ...points[0]], ...points.slice(1).map(p => ['L', ...p]), ['Z']];
  const rect = (x, y, w, h) =>
    polygon([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h]
    ]);
  const round = (x, y, w, h, r) => [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['Q', x + w, y, x + w, y + r],
    ['L', x + w, y + h - r],
    ['Q', x + w, y + h, x + w - r, y + h],
    ['L', x + r, y + h],
    ['Q', x, y + h, x, y + h - r],
    ['L', x, y + r],
    ['Q', x, y, x + r, y],
    ['Z']
  ];
  function bitmapFont() {
    return (bitmap ??= T.bitmapFont(TargetInspection.font(K.ascii.atlas())));
  }
  function sans() {
    if (sansFont) return sansFont;
    // Original Ink Sans outlines, in a 600 × 700 design grid. Assets remain package-free.
    const w = 580,
      t = 110,
      g = {},
      put = (ch, cs, advance = 680) => (g[ch] = { advance, commands: cs }),
      poly = (ch, p, holes = []) => put(ch, [...polygon(p), ...holes.flatMap(polygon)]);
    put(' ', [], 330);
    poly(
      'A',
      [
        [0, 0],
        [230, 700],
        [350, 700],
        [580, 0],
        [460, 0],
        [410, 160],
        [170, 160],
        [120, 0]
      ],
      [
        [
          [200, 265],
          [380, 265],
          [290, 555]
        ]
      ]
    );
    put('B', [...round(0, 0, w, 700, 170), ...round(t, t, 345, 195, 65), ...round(t, 405, 345, 185, 65)]);
    const cee = [
      ['M', 580, 545],
      ['Q', 535, 700, 320, 700],
      ['Q', 0, 700, 0, 350],
      ['Q', 0, 0, 320, 0],
      ['Q', 535, 0, 580, 155],
      ['L', 470, 195],
      ['Q', 440, 110, 320, 110],
      ['Q', 115, 110, 115, 350],
      ['Q', 115, 590, 320, 590],
      ['Q', 440, 590, 470, 505],
      ['Z']
    ];
    put('C', cee);
    put('D', [...round(0, 0, w, 700, 250), ...round(t, t, 345, 480, 150)]);
    poly('E', [
      [0, 0],
      [0, 700],
      [560, 700],
      [560, 590],
      [110, 590],
      [110, 410],
      [490, 410],
      [490, 300],
      [110, 300],
      [110, 110],
      [560, 110],
      [560, 0]
    ]);
    poly('F', [
      [0, 0],
      [0, 700],
      [560, 700],
      [560, 590],
      [110, 590],
      [110, 410],
      [480, 410],
      [480, 300],
      [110, 300],
      [110, 0]
    ]);
    put('G', [
      ['M', 580, 545],
      ['Q', 535, 700, 320, 700],
      ['Q', 0, 700, 0, 350],
      ['Q', 0, 0, 320, 0],
      ['Q', 485, 0, 580, 90],
      ['L', 580, 365],
      ['L', 315, 365],
      ['L', 315, 260],
      ['L', 470, 260],
      ['L', 470, 155],
      ['Q', 410, 110, 320, 110],
      ['Q', 115, 110, 115, 350],
      ['Q', 115, 590, 320, 590],
      ['Q', 440, 590, 470, 505],
      ['Z']
    ]);
    poly('H', [
      [0, 0],
      [0, 700],
      [110, 700],
      [110, 410],
      [470, 410],
      [470, 700],
      [580, 700],
      [580, 0],
      [470, 0],
      [470, 300],
      [110, 300],
      [110, 0]
    ]);
    put('I', rect(0, 0, 110, 700), 230);
    put('J', [
      ['M', 470, 700],
      ['L', 580, 700],
      ['L', 580, 210],
      ['Q', 580, 0, 300, 0],
      ['Q', 0, 0, 0, 230],
      ['L', 110, 230],
      ['Q', 110, 110, 300, 110],
      ['Q', 470, 110, 470, 230],
      ['Z']
    ]);
    poly('K', [
      [0, 0],
      [0, 700],
      [110, 700],
      [110, 360],
      [430, 700],
      [580, 700],
      [300, 400],
      [600, 0],
      [455, 0],
      [220, 315],
      [110, 200],
      [110, 0]
    ]);
    poly('L', [
      [0, 0],
      [0, 700],
      [110, 700],
      [110, 110],
      [560, 110],
      [560, 0]
    ]);
    poly('M', [
      [0, 0],
      [0, 700],
      [120, 700],
      [310, 335],
      [500, 700],
      [620, 700],
      [620, 0],
      [510, 0],
      [510, 485],
      [310, 125],
      [110, 485],
      [110, 0]
    ]);
    g.M.advance = 720;
    poly('N', [
      [0, 0],
      [0, 700],
      [120, 700],
      [470, 190],
      [470, 700],
      [580, 700],
      [580, 0],
      [460, 0],
      [110, 510],
      [110, 0]
    ]);
    put('O', [...round(0, 0, w, 700, 260), ...round(115, 110, 350, 480, 160)]);
    put('P', [
      ...polygon([
        [0, 0],
        [0, 700],
        [380, 700],
        [580, 590],
        [580, 400],
        [380, 290],
        [110, 290],
        [110, 0]
      ]),
      ...round(110, 400, 350, 190, 60)
    ]);
    put('Q', [
      ...round(0, 0, w, 700, 260),
      ...round(115, 110, 350, 480, 160),
      ...polygon([
        [360, 160],
        [460, 170],
        [635, -100],
        [510, -100]
      ])
    ]);
    put('R', [
      ...polygon([
        [0, 0],
        [0, 700],
        [380, 700],
        [580, 590],
        [580, 400],
        [385, 290],
        [610, 0],
        [470, 0],
        [250, 290],
        [110, 290],
        [110, 0]
      ]),
      ...round(110, 400, 350, 190, 60)
    ]);
    put('S', [
      ['M', 570, 550],
      ['Q', 550, 700, 300, 700],
      ['Q', 0, 700, 0, 500],
      ['Q', 0, 350, 270, 300],
      ['Q', 470, 265, 470, 200],
      ['Q', 470, 105, 290, 105],
      ['Q', 115, 105, 110, 215],
      ['L', 0, 215],
      ['Q', 0, 0, 290, 0],
      ['Q', 580, 0, 580, 205],
      ['Q', 580, 365, 300, 410],
      ['Q', 110, 440, 110, 510],
      ['Q', 110, 595, 300, 595],
      ['Q', 450, 595, 460, 550],
      ['Z']
    ]);
    poly('T', [
      [0, 590],
      [0, 700],
      [600, 700],
      [600, 590],
      [355, 590],
      [355, 0],
      [245, 0],
      [245, 590]
    ]);
    put('U', [
      ['M', 0, 700],
      ['L', 110, 700],
      ['L', 110, 230],
      ['Q', 110, 110, 290, 110],
      ['Q', 470, 110, 470, 230],
      ['L', 470, 700],
      ['L', 580, 700],
      ['L', 580, 230],
      ['Q', 580, 0, 290, 0],
      ['Q', 0, 0, 0, 230],
      ['Z']
    ]);
    poly('V', [
      [0, 700],
      [120, 700],
      [290, 155],
      [460, 700],
      [580, 700],
      [350, 0],
      [230, 0]
    ]);
    poly('W', [
      [0, 700],
      [115, 700],
      [225, 180],
      [355, 700],
      [465, 700],
      [595, 180],
      [705, 700],
      [820, 700],
      [650, 0],
      [535, 0],
      [410, 510],
      [285, 0],
      [170, 0]
    ]);
    g.W.advance = 920;
    poly('X', [
      [0, 0],
      [220, 350],
      [0, 700],
      [135, 700],
      [290, 445],
      [445, 700],
      [580, 700],
      [360, 350],
      [580, 0],
      [445, 0],
      [290, 255],
      [135, 0]
    ]);
    poly('Y', [
      [0, 700],
      [130, 700],
      [300, 405],
      [470, 700],
      [600, 700],
      [355, 290],
      [355, 0],
      [245, 0],
      [245, 290]
    ]);
    poly('Z', [
      [0, 0],
      [0, 95],
      [430, 590],
      [0, 590],
      [0, 700],
      [580, 700],
      [580, 605],
      [150, 110],
      [580, 110],
      [580, 0]
    ]);
    put('-', rect(0, 290, 360, 100), 460);
    put('.', rect(0, 0, 110, 110), 230);
    put(':', [...rect(0, 0, 110, 110), ...rect(0, 390, 110, 110)], 230);
    put(
      '/',
      polygon([
        [0, -60],
        [115, -60],
        [480, 760],
        [365, 760]
      ]),
      560
    );
    const pairs = {
      'A,V': -95,
      'A,W': -70,
      'A,Y': -95,
      'V,A': -95,
      'W,A': -70,
      'Y,A': -95,
      'T,A': -55,
      'L,T': -65,
      'L,V': -75,
      'L,Y': -80,
      'F,A': -35
    };
    sansFont = T.font({
      name: 'Ink Sans',
      unitsPerEm: 1000,
      ascender: 750,
      descender: -150,
      lineGap: 150,
      glyphs: ch =>
        g[ch.toUpperCase()] ??
        (() => {
          const b = bitmapFont().glyph(ch);
          return { advance: b.advance * 110, commands: b.commands.map(c => [c[0], ...c.slice(1).map(n => n * 100)]) };
        })(),
      kerning: pairs
    });
    return sansFont;
  }
  function validateFrames(frames, count) {
    const v = (a, n) => a && a.length === n && Array.from(a).every(Number.isFinite);
    if (
      !Array.isArray(frames) ||
      frames.length !== count ||
      frames.some(
        (f, i) =>
          !f ||
          f.index !== i ||
          typeof f.char !== 'string' ||
          [...f.char].length !== 1 ||
          !v(f.position, 3) ||
          !v(f.matrix, 9) ||
          !Number.isFinite(f.progress) ||
          f.progress < 0 ||
          f.progress > 1 ||
          !Number.isFinite(f.opacity) ||
          f.opacity < 0 ||
          f.opacity > 1 ||
          !Number.isFinite(f.scale) ||
          f.scale <= 0
      )
    )
      throw new RangeError('Text animation must return one finite, ordered pose per glyph');
  }
  let serial = 0;
  function extrude(
    B,
    S,
    run,
    {
      id = 'type-' + serial++,
      depth = run.size * 0.18,
      res = run.size / 38,
      material,
      position = [0, 0, 0],
      rig,
      tolerance
    } = {}
  ) {
    if (
      !rig ||
      !Array.isArray(position) ||
      position.length !== 3 ||
      !position.every(Number.isFinite) ||
      !(depth > 0) ||
      !Number.isFinite(depth) ||
      !(res > 0) ||
      !Number.isFinite(res) ||
      material === undefined
    )
      throw new RangeError('Text extrusion needs a native rig, material, positive depth/resolution and a position');
    const parts = run.glyphs.map(g => {
      const tag = id + '/' + g.index,
        part = rig.part(tag),
        origin = [g.x + position[0], g.y + position[1], position[2]],
        loops = T.outline(run.font, g.char, { tolerance }).map(l => l.map(p => p.map(v => v * g.scale)));
      if (loops.length)
        S.extrude(loops, origin, depth, typeof material === 'function' ? material(g) : material, { res, tag });
      return { tag, part, origin, loops, glyph: g };
    });
    let bound = null,
      bakedIds;
    const text = {
      layout: run,
      parts,
      get ids() {
        if (!rig.list) throw new Error('Bake the text and bind its rig before reading splat IDs');
        return (bakedIds ??= Object.freeze(parts.flatMap(p => Array.from(rig.list[p.part] ?? []))));
      },
      bind(stage, { sample = t => T.pose(run, t, { position }) } = {}) {
        if (bound || rig.st !== stage) throw new Error('Text must bind once to its baked rig stage');
        const ids = text.ids,
          coverage = new Float32Array(stage.N),
          samples = parts.map(p => Array.from(rig.list[p.part] ?? []));
        const owner = new Map();
        // Precompute contour-distance coordinates. Runtime write-on never rebakes glyph geometry.
        for (const p of parts) {
          let length = 0;
          const edges = [];
          for (const loop of p.loops)
            for (let i = 0; i < loop.length; i++) {
              const a = loop[i],
                b = loop[(i + 1) % loop.length],
                len = Math.hypot(b[0] - a[0], b[1] - a[1]);
              edges.push({ a, b, len, start: length });
              length += len;
            }
          for (const i of samples[p.glyph.index]) {
            owner.set(i, p.glyph.index);
            const o = i * 16,
              x = stage.base[o] - p.origin[0],
              y = stage.base[o + 1] - p.origin[1];
            let distance = Infinity,
              at = 0;
            for (const e of edges) {
              const dx = e.b[0] - e.a[0],
                dy = e.b[1] - e.a[1],
                u = K.clamp(((x - e.a[0]) * dx + (y - e.a[1]) * dy) / (e.len ** 2 || 1), 0, 1),
                d = (x - e.a[0] - u * dx) ** 2 + (y - e.a[1] - u * dy) ** 2;
              if (d < distance) {
                distance = d;
                at = e.start + u * e.len;
              }
            }
            coverage[i] = length ? at / length : 0;
          }
        }
        let frames = T.pose(run, 0, { position });
        bound = {
          update(dt, time) {
            const previous = frames;
            frames = sample(time);
            validateFrames(frames, parts.length);
            for (const p of parts) {
              const f = frames[p.glyph.index];
              if (f.char !== p.glyph.char)
                throw new Error('Use sprite text for scrambling; baked SDF glyph topology is fixed');
              rig.set(p.part, f.matrix, p.origin, f.position);
              if (f.progress !== previous[p.glyph.index].progress || f.opacity !== previous[p.glyph.index].opacity)
                stage.repaintAll(samples[p.glyph.index]);
            }
            rig.apply();
          },
          paint(i, rgba) {
            const glyph = owner.get(i);
            if (glyph === undefined) return;
            const f = frames[glyph],
              u = f.progress === 1 ? 1 : f.progress === 0 ? 0 : T.smooth((f.progress - coverage[i]) / 0.025);
            rgba[3] *= u * f.opacity;
          },
          inspect: () => frames,
          materialise(options = {}) {
            return K.materialisation.bind(stage, { ...options, id: options.id ?? id + '/matter', ids });
          }
        };
        return bound;
      }
    };
    return text;
  }
  function sprites(
    builder,
    run,
    { pixelsPerEm = 32, color = 0xffffff, position = [0, 0, 0], scrambleChars = '', padding = 1 } = {}
  ) {
    const cache = new Map(),
      first = builder.finish().vertices.length / 5,
      chars = new Set([...run.text.replace(/[\r\n\t]/g, ' '), ...scrambleChars]);
    for (const ch of chars) {
      const image = T.raster(run.font, ch, { pixelsPerEm, padding, color });
      const region = builder.reserve(image.width, image.height, (x, y) =>
        image.rgba[(y * image.width + x) * 4 + 3] ? color : null
      );
      cache.set(ch, { image, region });
    }
    const initial = T.pose(run, 0, { position }),
      slots = [];
    for (const g of run.glyphs) {
      const entry = cache.get(g.char === '\t' ? ' ' : g.char);
      slots.push(entry);
      const [x0, y0, x1, y1] = entry.image.bounds.map(v => v * g.scale),
        f = initial[g.index];
      builder.faceRegion(
        T.transform(f, [x0, y0, 0]),
        M.app(f.matrix, [x1 - x0, 0, 0]),
        M.app(f.matrix, [0, y1 - y0, 0]),
        entry.region
      );
    }
    let bound = false;
    return {
      layout: run,
      first,
      count: run.glyphs.length * 6,
      bind(atlas, { sample = t => T.pose(run, t, { position }) } = {}) {
        if (bound || !atlas?.vertices || atlas.vertices.length < (first + slots.length * 6) * 5)
          throw new Error('Bind sprite text once after finishing its atlas');
        bound = true;
        return {
          update(dt, time) {
            const frames = sample(time);
            validateFrames(frames, slots.length);
            let changed = false;
            for (const f of frames)
              if (!cache.has(f.char === '\t' ? ' ' : f.char))
                throw new Error('Reserve every scramble character in sprites({scrambleChars})');
            for (const f of frames) {
              const entry = cache.get(f.char === '\t' ? ' ' : f.char);
              if (!entry) throw new Error('Reserve every scramble character in sprites({scrambleChars})');
              const [x0, y0, x1, y1] = entry.image.bounds.map(v => v * f.scale),
                r = entry.region,
                progress = f.opacity > 0 ? f.progress : 0;
              for (let j = 0; j < 6; j++) {
                const [u, v] = [
                    [0, 0],
                    [1, 0],
                    [0, 1],
                    [0, 1],
                    [1, 0],
                    [1, 1]
                  ][j],
                  point = T.transform(f, [x0 + (x1 - x0) * u * progress, y1 + (y0 - y1) * v, 0]),
                  values = [...point, r.x + 0.5 + (r.width - 1) * u * progress, r.y + 0.5 + (r.height - 1) * v],
                  at = (first + f.index * 6 + j) * 5;
                for (let k = 0; k < 5; k++) {
                  if (Math.abs(atlas.vertices[at + k] - values[k]) > 1e-6) {
                    atlas.vertices[at + k] = values[k];
                    changed = true;
                  }
                }
              }
            }
            if (changed && slots.length) SpriteSurface.markGeometryDirty(atlas, { first, count: slots.length * 6 });
          }
        };
      }
    };
  }
  function outlineStrokes(run, time, options = {}) {
    return T.pose(run, time, options).map(f => ({
      glyph: f,
      strokes: T.strokes(T.outline(run.font, f.char), f.opacity > 0 ? f.progress : 0).map(l =>
        l.map(p => T.transform(f, [p[0] * f.scale, p[1] * f.scale, 0]))
      )
    }));
  }
  K.typography = Object.freeze({
    ...T,
    fonts: Object.freeze({ sans, bitmap: bitmapFont }),
    layout: (text, { font = sans(), ...options } = {}) => T.layout(text, font, options),
    extrude,
    sprites,
    outlineStrokes
  });
})(KIT);
