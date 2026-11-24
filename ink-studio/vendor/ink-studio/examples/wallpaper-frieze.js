const { motif } = require('./ornament-pattern.json');
const palette = [
  0x131e29, 0x263b49, 0x395562, 0x587981, 0x7c9b9b, 0xb0c5b5,
  0x6b403a, 0xa76243, 0xda9864, 0xffca7f, 0xffebaf,
  0x2e655e, 0x45a697, 0x9de1c9
];
const metal = { r: [0, 1, 2, 3, 4] }, brass = { r: [6, 7, 8, 9, 10] };
const lamp = { r: [8, 9, 10], em: true };
const rgb = (r, g, b) => r * 65536 + g * 256 + b;

function gallery(K, S, B, SpriteSurface) {
  const stages = [
    { x: -4.60, y: 3.97, w: 2.88, h: 2.52, group: 'p1', caption: 'MOTIF', min: [.045, .0], max: [.455, .337] },
    { x: -1.54, y: 3.97, w: 2.88, h: 2.52, group: 'pgg', caption: 'PGG', min: [-.15, 0], max: [2.9, 2.1] },
    { x: 1.54, y: 3.97, w: 2.88, h: 2.52, group: 'p4g', caption: 'P4G', min: [0, 0], max: [3, 2.07] },
    { x: 4.60, y: 3.97, w: 2.88, h: 2.52, group: 'p6m', caption: 'P6M', min: [-.16, 0], max: [2.85, 2.07] },
    { x: 0, y: 1.45, w: 12.08, h: 2.18, group: 'p11g', caption: 'P11G GLIDE FRIEZE',
      min: [0, 0], max: [7.4, 1], kind: 'frieze' }
  ];
  const surfaces = SpriteSurface.make(736), font = K.inspection.font({});
  const box = (at, half, material, res = .09, rd = .03) => S.box(at, half, material, { res, rd });
  box([0, 3.04, -.27], [6.23, 3.01, .27], metal, .13, .13);
  box([0, 5.60, .02], [6.01, .26, .26], brass, .12, .058);
  for (const x of [-5.82, 5.82]) S.ball([x, 5.60, .33], [.095, .045, .031], lamp, { res: .04 });
  function textPlate(text, w, h, scale, color, background) {
    const glyphs = [...text].map(letter => font.get(letter)), ox = Math.round((w - text.length * 6 * scale + scale) / 2);
    const oy = Math.round((h - 7 * scale) / 2);
    return (x, y) => {
      if (x < ox || y < oy || y >= oy + 7 * scale) return background;
      const col = Math.floor((x - ox) / scale), row = Math.floor((y - oy) / scale);
      return glyphs[Math.floor(col / 6)]?.[row * 6 + col % 6] ? color : background;
    };
  }
  surfaces.face([-5.53, 5.40, .396], [11.06, 0, 0], [0, .40, 0],
    440, 18, textPlate('WALLPAPER AND FRIEZE', 440, 18, 2, 0xffdb98, 0x2c333a));
  for (const { x, y, w, h, group, min, max, caption, kind } of stages) {
    const pattern = K.procedural.ornament.compile({ kind, group, motif });
    box([x, y, .02], [w * .5, h * .5, .22], metal, .11, .064);
    const ww = Math.round(w * 42), hh = Math.round(h * 42);
    const strip = 22, gap = 3, dw = ww - 2 * gap, dh = hh - gap - strip;
    const art = pattern.raster({ w: dw, h: dh, space: 'plane', bounds: { min, max }, samples: 2, background: '#203540' });
    const label = textPlate(caption, ww, strip, 2, 0x9fe0cf, 0x142730);
    surfaces.face([x - w * .5 + .057, y - h * .5 + .057, .43], [w - .114, 0, 0], [0, h - .114, 0],
      ww, hh, (u, v) => {
        if (u === 0 || v === 0 || u === ww - 1 || v === hh - 1 || v === hh - strip) return 0x536e75;
        if (v > hh - strip) return label(u, v - (hh - strip));
        if (u < gap || u >= ww - gap || v < gap) return 0x142730;
        const i = 4 * ((v - gap) * art.w + u - gap);
        return rgb(art.rgba[i], art.rgba[i + 1], art.rgba[i + 2]);
      });
  }
  S.bake();
  return B.finish({ spriteSurfaces: surfaces.finish(),
    cam: { target: [0, 3.06, .16], dist: 15.3, fov: .54, yaw: -.012, pitch: .021 },
    radius: 7.6, detail: 24, dither: .12, look: { pixelSize: 2, splatCoverage: 'continuous' } });
}

function ceramics(K, S, B, SpriteSurface, TexturedSurface) {
  const unit = 1.24, center = .62;
  const pattern = K.procedural.ornament.compile({ group: 'p4g', cell: [unit, unit], motif });
  const surfaces = SpriteSurface.make(460);
  const base = [.68, .45, .30], interior = [.15, .229, .24];
  const clamp = x => Math.max(0, Math.min(1, x)), smooth = x => clamp(x) ** 2 * (3 - 2 * clamp(x));
  const sun = K.V.norm([-.68, .62, .43]);
  S.box([0, -.08, center], [2.67, .22, 2.06], metal, { res: .107, rd: .13 });
  S.box([0, .123, center], [2.56, .078, 1.96], brass, { res: .090, rd: .04 });
  S.box([0, .181, center], [2.55, .055, 1.95], metal, { res: .090, rd: .048 });
  for (const tile of pattern.tiles({ min: [-2, -1], max: [2, 2] })) {
    const [[x, z], , [right, south]] = tile.corners, gap = .036, span = unit - 2 * gap;
    const x0 = x + gap, z0 = z + gap;
    S.box([(x + right) / 2, .249, (z + south) / 2], [span * .5, .042, span * .5],
      { r: [6, 7, 8] }, { res: .054, rd: .022 });
    const position = (u, v) => [x0 + u * span, z0 + v * span];
    function top(u, v) {
      const edge = Math.min(u, v, 1 - u, 1 - v), bevel = smooth(edge / .035);
      const recess = smooth(.54 - pattern.distance(...position(u, v)) / .034);
      return .285 + bevel * (.110 - recess * .091);
    }
    const chart = TexturedSurface.grid({ segments: [48, 48], flip: true, point(u, v) {
      const [px, pz] = position(u, v);
      return [px, top(u, v), pz];
    } });
    const tint = ((tile.cell[0] * 7 + tile.cell[1] * 11) % 7) * .012;
    surfaces.mesh(chart, 70, 70, (u, v) => {
      const sx = u / 69, sz = v / 69;
      const { normal } = chart.sample(sx, sz);
      const pos = position(sx, sz), reach = pattern.distance(...pos);
      const dug = smooth(.43 - reach / .034), ink = pattern.ink(...pos);
      const edge = Math.min(sx, sz, 1 - sx, 1 - sz), rim = .62 + .38 * smooth(edge / .043);
      const light = rim * (.52 + .58 * Math.max(0, K.V.dot(normal, sun)));
      const grain = ((Math.imul(u + tile.cell[0] * 71, 23) ^ Math.imul(v + tile.cell[1] * 71, 53)) & 15) * .0028;
      const shade = base.map((c, i) => Math.round(clamp(
        ((c + tint + grain) * (1 - dug) + (ink ? interior[i] * .73 + .11 * ink[i] / 255 : interior[i]) * dug) * light
      ) * 255));
      return rgb(...shade);
    });
  }
  S.bake();
  const world = B.finish({ spriteSurfaces: surfaces.finish(),
    cam: { target: [0, .16, center], yaw: -.22, pitch: .62, dist: 8.2, fov: .62 },
    radius: 5.5, detail: 25, dither: .12, look: { pixelSize: 2, splatCoverage: 'continuous' } });
  const duration = 5;
  const arch = { type: 'archimedeanSpiral', startRadius: 6.5, endRadius: 6.3, turns: .12,
    phase: -1.94, height: -.88, origin: [0, 5.46, center] };
  return K.cameraRig.bind(world, K.cameraRig.compile({
    rails: { survey: { family: arch } },
    shots: { tiles: { target: [0, .16, center], rail: 'survey', fov: .68,
      progress: [{ time: 0, value: 0 }, { time: duration / 2, value: 1, ease: 'smooth' },
        { time: duration, value: 0, ease: 'smooth' }] } }, duration
  }));
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface }) => ({
  id: 'wallpaper-frieze',
  name: 'Wallpaper and Frieze',
  seed: 89,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'gallery';
    if (!['gallery', 'ceramics'].includes(study)) throw new RangeError('Use gallery or ceramics');
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .37, sky: .24, sun: K.V.norm([-.65, .69, .43]), sunK: .82 });
    return study === 'gallery' ? gallery(K, S, B, SpriteSurface) : ceramics(K, S, B, SpriteSurface, TexturedSurface);
  }
});
