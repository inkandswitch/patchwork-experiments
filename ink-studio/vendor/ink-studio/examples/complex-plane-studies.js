const palette = [
  0x111825, 0x1a2637, 0x26364a, 0x3d5261, 0x64777d,
  0x482b32, 0x704237, 0xa16e47, 0xce9c67, 0xf0c88b
];
const paper = [0x14172e, 0x273153, 0x394b74, 0x457779, 0x77aaaa, 0xc9d4ac, 0xf4da9b, 0xb96053];
const enamel = [0x151930, 0x312243, 0x62304c, 0xa4515a, 0xd79c67, 0xffd3a0, 0x8cc1af, 0x326b75];
const basins = [[0xd88d5d, 0xffca88], [0x4e9a96, 0xa0dbbd], [0x826b9b, 0xc2a9dc]];
const finishes = [
  0x12152b, 0x292246, 0x26434a, 0x357676, 0x6eb1a5, 0xadf2ce,
  0x463453, 0x6b4565, 0x977d9f, 0xceabd2, 0xffe5b5,
  0x551e50, 0x822a53, 0xb94465, 0xca695b, 0x7f351c, 0x885b1f, 0xb78229,
  0x1b443e, 0x23714f, 0x3a9757, 0x81a446, 0x37609a, 0x273777, 0x563ba5
];
const trapSpan = 3.28;
const cap = x => Math.max(0, Math.min(1, x));
const rgb = (r, g, b) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
const channel = (color, shift) => color >> shift & 255;
const blend = (a, b, t) => rgb(...[16, 8, 0].map(s => channel(a, s) * (1 - t) + channel(b, s) * t));
function ramp(colors, t) {
  const q = cap(t) * (colors.length - 1), i = Math.min(colors.length - 2, Math.floor(q));
  return blend(colors[i], colors[i + 1], q - i);
}

function label(font, sprite, x, y, z, text, width, ink) {
  const glyphs = [...text].map(ch => font.get(ch)), w = glyphs.length * 6 + 6;
  sprite.face([x - width / 2, y, z], [width, 0, 0], [0, width * 11 / w, 0], w, 11, (u, v) => {
    const i = u - 3, j = v - 2;
    if (i >= 0 && j >= 0 && j < 7 && glyphs[Math.floor(i / 6)]?.[j * 6 + i % 6]) return ink;
  });
}

function atlas(C, paint) {
  const m = C.compile({ iterations: 160, escapeRadius: 64 });
  const n = C.compile({ family: 'newton', iterations: 42 });
  const views = [
    ['MANDELBROT', 'ESCAPE TIME', (u, v) => {
      const t = m.sample(-.68 + 2.76 * (u - .5), 2.76 * (.5 - v)).escapeTime;
      return t === null ? 0x111425 : ramp(paper, (Math.sin(5.15 * Math.log1p(t) - 2.1) + 1) * .4 + .045 * Math.log1p(t));
    }],
    ['JULIA', 'ORBIT TRAP', paint],
    ['NEWTON', 'BASIN ID', (u, v) => {
      const s = n.sample(3.5 * (u - .5), 3.5 * (.5 - v));
      if (s.basinId === null) return 0x14172c;
      const [body, shade] = basins[s.basinId], t = s.iterations;
      return blend(blend(body, shade, .22 + .14 * Math.cos(t * 1.8)), 0x121324, cap((t - 2) / 28));
    }],
    ['NEWTON', 'DOMAIN COLOR', (u, v) => n.domain(3.5 * (u - .5), 3.5 * (.5 - v)).rgb]
  ];
  return views.map(([name, role, sample]) => ({ name, role, sample }));
}

function buildPress(P, trap, paint) {
  const half = trapSpan / 2, level = .035, detail = 320;
  const iso = [.015, level, .068, .115];
  const at = (u, v) => trap((u - .5) * trapSpan, (.5 - v) * trapSpan);
  const valley = d => iso.reduce((best, level) => Math.min(best, Math.abs(level - d)), Infinity);
  const paths = P.contours.march(trap, { bounds: { min: [-half, -half], max: [half, half] }, iso: level, cell: .012 });
  const engraving = (u, v, i, j) => {
    const d = at(u, v), step = 1 / detail;
    const height = (x, y) => Math.exp(-valley(at(x, y)) * 235);
    const left = height(u - step, v - step), right = height(u + step, v + step),
      shadow = Math.exp(-valley(d) * 220), grain = ((Math.imul(i, 12413) ^ Math.imul(j, 7757)) & 15) / 225;
    const tone = cap(.55 + .64 * (right - left) - .39 * shadow + grain);
    return ramp([0x251c29, 0x5e3c41, 0xa36b4d, 0xd69c67, 0xffe4b2], tone);
  };
  const mask = (u, v) => {
    const d = at(u, v), line = Math.exp(-Math.abs(level - d) * 185);
    return blend(0x13152b, 0x347a78, cap(.15 * Math.exp(-d * 6) + .90 * line));
  };
  return {
    relief: (u, v) => .042 * Math.exp(-valley(at(u, v)) * 115),
    paths,
    views: [
      { name: 'PIGMENT', role: 'TRAP DISTANCE', sample: paint },
      { name: 'ENGRAVING', role: 'DISTANCE LEVELS', sample: engraving, engraved: true },
      { name: 'EMISSION', role: 'DISTANCE MASK', sample: mask }
    ]
  };
}

module.exports = ({ KIT: K, SpriteSurface, TexturedSurface, makeBuilder, makeSculpt }) => ({
  id: 'complex-plane-studies',
  name: 'Complex Plane Atlas and Orbit Press',
  seed: 47,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'atlas';
    if (!['atlas', 'press'].includes(study)) throw new RangeError('Use atlas or press');
    const P = K.procedural, C = P.complexPlane, B = makeBuilder(seed, [...new Set([...palette, ...paper, ...enamel, ...basins.flat(), ...finishes])]), S = K.sculpt(makeSculpt(B));
    const julia = C.compile({ family: 'julia', constant: [-.78, .136], iterations: 80,
      traps: [{ id: 'ring', type: 'circle', center: [.14, .12], radius: .42 }] });
    const trap = julia.field('trap', 'ring');
    const paint = (u, v) => {
      const d = trap((u - .5) * trapSpan, (.5 - v) * trapSpan), t = Math.exp(-d * 6.8);
      return ramp(enamel, t * .86 + .10 * t * Math.cos(61 * d));
    };
    const press = study === 'press' ? buildPress(P, trap, paint) : null;
    const views = press ? press.views : atlas(C, paint);
    const span = press ? 2.71 : 2.26, pitch = span + .25, count = views.length, overall = (count - 1) * pitch + span;
    const mid = 2.21, bottom = mid - span / 2, z = .55, texels = 320;
    const sprite = SpriteSurface.make(1024), font = K.inspection.font({});
    Object.assign(S, { pixel: true, amb: .41, sky: .23, sun: K.V.norm([-.58, .73, .49]), sunK: .68 });
    const metal = { r: [0, 1, 2, 3, 4] }, bronze = { r: [5, 6, 7, 8, 9] };
    const box = (p, h, mat, res = .075, rd = .036) => S.box(p, h, mat, { res, rd });
    box([0, mid + .012, -.13], [overall / 2 + .36, span / 2 + .78, .31], metal, .105, .13);
    box([0, bottom + span + .43, .21], [overall / 2 + .21, .242, .185], metal);
    box([0, bottom - .44, .17], [overall / 2 + .22, .198, .152], metal);
    for (const side of [-1, 1]) {
      const x = overall / 2 + .226;
      box([side * x, mid, .22], [.070, span / 2 + .58, .11], bronze);
      for (const y of [bottom - .35, bottom + span + .48])
        S.ball([side * (x - .16), y, .42], .049, bronze, { res: .037 });
    }
    label(font, sprite, 0, bottom + span + .37, .48, press ? 'ORBIT PRESS' : 'COMPLEX PLANE ATLAS',
      press ? 2.07 : 3.05, 0xffdca4);
    if (press) label(font, sprite, 0, bottom - .636, .49, 'JULIA   /   CIRCLE TRAP', 3.11, 0x9baab0);

    views.forEach(({ name, role, sample, engraved }, i) => {
      const cx = (i - (count - 1) / 2) * pitch, x = cx - span / 2;
      box([cx, mid, .247], [span / 2 + .064, span / 2 + .066, .193], bronze, .077, .046);
      const color = (i, j) => sample((i + .5) / texels, (j + .5) / texels, i, j);
      if (engraved) {
        const surface = TexturedSurface.grid({ segments: [116, 116], flip: true, point: (u, v) =>
          [x + u * span, bottom + (1 - v) * span, z - press.relief(u, v)]
        });
        sprite.mesh(surface, texels, texels, color);
      } else {
        sprite.face([x, bottom, z], [span, 0, 0], [0, span, 0], texels, texels, color);
      }
      label(font, sprite, cx, bottom - .322, .51, name, name.length * .153 + .15, 0xffd49a);
      label(font, sprite, cx, bottom - .462, .51, role, role.length * .106 + .10, 0x94a9b0);
    });

    S.bake();
    let emission;
    if (press) {
      const scale = span / trapSpan;
      const segments = press.paths.filter(path => path.points.length >= 4).flatMap(({ points }) =>
        points.slice(1).map(([x, y], i) => {
          const a = [pitch + points[i][0] * scale, mid + points[i][1] * scale, z + .018];
          const b = [pitch + x * scale, mid + y * scale, z + .018];
          return { a, b, phase: (x + y * .67) * 4.9 };
        })
      );
      emission = K.frameSplats(B, segments.length, (draw, _dt, time) => {
        const angle = Math.PI * 2 * (time % 5) / 5;
        for (const { a, b, phase } of segments) {
          const t = Math.max(0, Math.cos(phase - angle)) ** 8;
          if (t < .055) continue;
          draw.streak(a, b, { rgb: [.4 + .54 * t, .93, .65 + .25 * t], width: .010 + .013 * t, density: .25 + 1.34 * t });
        }
      });
    }
    const world = B.finish({
      spriteSurfaces: sprite.finish(),
      cam: { target: [0, mid + .045, .11], dist: press ? 10.84 : 10.98, yaw: -.035, pitch: .05, fov: .52 },
      radius: 6, detail: 24, dither: .10, look: { pixelSize: 1, splatCoverage: 'continuous' }
    });
    if (emission) K.stage(world).add(emission);
    return world;
  }
});
