const palette = [
  0x111925, 0x1c2b38, 0x2d4051, 0x466373, 0x638794, 0x93abad,
  0x4a3036, 0x715048, 0xa17752, 0xc99b61, 0xeac789, 0xffe8ad,
  0x713c42, 0xb35e4b, 0xda8c59, 0xf5bd75,
  0x392f54, 0x603b63, 0x9c587f, 0xd183a4, 0xf4bbca,
  0x1b3a41, 0x285563, 0x377681, 0x55a3a2, 0x8ed2bb, 0xc4f1d0,
  0x1d352f, 0x355745, 0x5d8960, 0x88bb7c, 0xc5e5a4,
  0x142129, 0x152a32, 0x25414c, 0x355663
];
const hex = rgb => '#' + rgb.toString(16).padStart(6, '0');
const styles = [
  { type: 'koch', title: 'KOCH', generation: 4, ramp: [0xb35e4b, 0xda8c59, 0xf5bd75, 0xffe8ad] },
  { type: 'dragon', title: 'DRAGON', generation: 9, ramp: [0x603b63, 0x9c587f, 0xd183a4, 0xf4bbca] },
  { type: 'hilbert', title: 'HILBERT', generation: 4, ramp: [0x285563, 0x377681, 0x55a3a2, 0xc4f1d0] },
  { type: 'peano', title: 'PEANO', generation: 3, ramp: [0x355745, 0x5d8960, 0x88bb7c, 0xc5e5a4] }
];

function lettering(font, sprites, x, y, z, width, message, ink) {
  const glyphs = [...message].map(c => font.get(c)), w = message.length * 6 + 4;
  sprites.face([x - width / 2, y, z], [width, 0, 0], [0, width * 10 / w, 0], w, 10, (u, v) => {
    const c = u - 2, r = v - 1;
    if (c >= 0 && r >= 0 && r < 7 && glyphs[Math.floor(c / 6)]?.[r * 6 + c % 6]) return ink;
  });
}

function raster(K, w, h, draw) {
  const plan = K.frameComposite.prepare({ layers: [{ draw }] }, w, h);
  return K.frameComposite.layers(plan, {}, 0)[0].data;
}

function atlasPlot(K, curve, style, w, h) {
  const bounds = K.procedural.spatial.boxOf(curve.points),
    scale = Math.min((w - 44) / (bounds.max[0] - bounds.min[0]), (h - 38) / (bounds.max[1] - bounds.min[1])),
    cx = (bounds.min[0] + bounds.max[0]) / 2, cy = (bounds.min[1] + bounds.max[1]) / 2,
    at = ([x, y]) => [w / 2 + (x - cx) * scale, h / 2 - (y - cy) * scale];
  const draw = [{ type: 'rect', rect: [0, 0, w, h], color: '#142129' }];
  for (let x = w / 2 % 19; x < w; x += 19) for (let y = h / 2 % 19; y < h; y += 19)
    draw.push({ type: 'rect', rect: [x, y, 1, 1], color: '#355663' });
  const points = curve.points.map(at), count = points.length - 1;
  draw.push({ type: 'path', points, color: '#25414c', width: 4.2 });
  for (const { from, to, generation } of curve.segments) {
    const level = curve.cells.length ? Math.min(3, Math.max(1, 5 - generation)) : Math.min(3, Math.floor(from / count * 4));
    draw.push({ type: 'path', points: [points[from], points[to]], color: hex(style.ramp[level]),
      width: curve.cells.length ? 2.06 + .3 * level : 2.9 });
  }
  for (const [x, y] of [points[0], points.at(-1)])
    draw.push({ type: 'rect', rect: [x - 2, y - 2, 4, 4], color: '#ffe8ad' });
  const data = raster(K, w, h, draw);
  return (x, y) => {
    const i = (y * w + x) * 4;
    return data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
  };
}

function atlas(K, B, S, sprites, font) {
  const steel = { r: [0, 1, 2, 3, 4] }, bronze = { r: [6, 7, 8, 9, 10] };
  S.box([0, 3.53, -.29], [4.83, 3.48, .22], steel, { res: .117, rd: .095 });
  S.box([0, 6.69, -.023], [4.66, .255, .12], steel, { res: .088, rd: .065 });
  lettering(font, sprites, 0, 6.584, .151, 3.70, 'RECURSIVE CURVES', 0xffe8ad);
  for (const [i, style] of styles.entries()) {
    const x = i % 2 ? 2.31 : -2.31, y = i < 2 ? 3.68 : .49, span = 4.28, height = 2.55;
    S.box([x, y + height / 2, -.042], [span / 2 + .065, height / 2 + .059, .152], bronze, { res: .077, rd: .039 });
    const curve = K.curve.create({ type: style.type, generation: style.generation, axis: [0, 0, 1] });
    sprites.face([x - span / 2, y, .15], [span, 0, 0], [0, height, 0], 432, 258, atlasPlot(K, curve, style, 432, 258));
    for (const side of [-1, 1])
      S.ball([x + side * 2.05, y - .231, .12], .030, bronze, { res: .035 });
    lettering(font, sprites, x - .92, y - .37, .175, style.title.length * .167 + .09, style.title, 0xffe8ad);
    const caption = 'GEN ' + curve.generation + ' / ' + curve.segments.length + ' EDGES';
    lettering(font, sprites, x + .77, y - .345, .175, 1.84, caption, style.ramp.at(-1));
  }
  S.bake();
  return B.finish({ spriteSurfaces: sprites.finish(),
    cam: { target: [0, 3.54, -.08], dist: 13.78, pitch: .019, yaw: -.014, fov: .57 },
    radius: 6.2, detail: 25, dither: .06, look: { pixelSize: 1, splatCoverage: 'continuous' }
  });
}

function circuit(K, B, S, sprites, font, SpriteSurface) {
  const period = 6, size = 450, span = 4.38, middle = 2.80, face = .574, pad = .26;
  const model = K.curve.recursive({ type: 'hilbert', generation: 5, axis: [0, 0, 1],
    scale: span - 2 * pad, origin: [0, middle, face] });
  const metal = { r: [0, 1, 2, 3, 4] }, brass = { r: [6, 7, 8, 9, 10] },
    aqua = { r: [21, 22, 23, 24, 25], em: true };
  const box = (p, h, mat, res = .081, rd = .044) => S.box(p, h, mat, { res, rd });
  box([0, 2.81, -.056], [2.67, 2.82, .38], metal, .12, .106);
  box([0, middle, .30], [2.32, 2.32, .16], brass, .095, .069);
  box([0, middle, .445], [2.255, 2.255, .085], metal, .078, .039);
  box([0, 5.31, .337], [2.38, .158, .14], metal, .081, .043);
  box([0, .282, .335], [2.36, .198, .149], metal, .078, .037);
  lettering(font, sprites, 0, 5.19, .529, 3.01, 'UNFOLDING CIRCUIT', 0xffe8ad);
  lettering(font, sprites, -.82, .192, .532, 1.81, 'HILBERT / GENERATION', 0x93abad);
  for (const side of [-1, 1]) {
    box([side * 2.50, middle, .14], [.047, 2.31, .12], brass, .073, .028);
    for (const y of [.397, 5.28])
      S.ball([side * 2.46, y, .47], .05, brass, { res: .037 });
    for (let i = 0; i < 11; i++) {
      const y = .91 + i * .365;
      box([side * 2.404, y, .351], [.063, .023, .044], i % 5 === 0 ? aqua : metal, .042, .011);
    }
  }
  const region = sprites.reserve(size, size);
  sprites.faceRegion([-span / 2, middle - span / 2, face], [span, 0, 0], [0, span, 0], region);
  const layers = [
    { type: 'rect', rect: [0, 0, size, size], color: '#142129' },
    { type: 'grid', origin: [26, 26], counts: [16, 16], step: 24.875,
      width: .6, color: '#152a32', majorEvery: 4, majorColor: '#25414c', majorWidth: .85 }
  ];
  const map = ([x, y]) => [size * (.5 + x / span), size * (.5 - (y - middle) / span)];
  const baseline = model.level(0), terminals = baseline.points.map(map);
  for (const [x, y] of terminals) {
    layers.push({ type: 'rect', rect: [x - 7, y - 7, 14, 14], color: '#715048' },
      { type: 'rect', rect: [x - 4, y - 4, 8, 8], color: '#c99b61' });
  }
  const atlas = sprites.finish();
  let paintedGeneration, rail;
  function view(time) {
    const phase = ((time % period) + period) % period, generation = K.clamp(Math.min((phase - .25) / 3.4, (5.73 - phase) / 1.21), 0, 1) * 5;
    if (paintedGeneration === generation) return { phase, generation, rail };
    const from = Math.min(4, Math.floor(generation)), t = generation - from, eased = t * t * (3 - 2 * t),
      path = model.morph(from, eased);
    rail = K.curve.path(path.points, { closed: false });
    const ink = rail.points.map(map);
    const structural = path.segments.flatMap(({ generation: depth, from: a, to: b }) => {
      const delta = K.V.dist(path.points[a], path.points[b]);
      if (depth > 2 || delta < .045) return [];
      const [x, y] = map(K.V.lerp(path.points[a], path.points[b], .5));
      return [{ type: 'rect', rect: [x - 2.35, y - 2.35, 4.7, 4.7], color: '#eac789' }];
    });
    SpriteSurface.update(atlas, region, { w: size, h: size, rgba: raster(K, size, size, [
      ...layers,
      { type: 'path', points: ink, width: 7.2, color: '#1b3a41' },
      { type: 'path', points: ink, width: 3.05, color: '#55a3a2' },
      { type: 'path', points: ink, width: 1.15, color: '#8ed2bb' },
      ...structural
    ]) });
    paintedGeneration = generation;
    return { phase, generation, rail };
  }

  S.bake();
  const charge = K.frameSplats(B, 69, (draw, _dt, time) => {
    const { rail, phase, generation } = view(time);
    const forward = (phase * baseline.length * 1.5 / rail.length) % 1,
      burst = K.clamp((rail.length - 9) / 7, 0, 1), offset = .056;
    for (let stream = 0; stream < 3; stream++) {
      const gain = stream ? burst : 1;
      if (!gain) continue;
      const p = ((forward + stream / 3) % 1) * rail.length, run = Math.min(1.06, rail.length * .16);
      const [x, y, z] = rail.at(p).p;
      draw.point([x, y, z + offset], { width: .036, rgb: [1, .9, .66], density: 1.18 * gain });
      for (let j = 0; j < 20; j++) {
        const keep = p - j / 20 * run;
        if (keep <= 0) break;
        const a = rail.at(Math.max(0, keep - run * .062)).p, b = rail.at(keep).p;
        draw.streak([a[0], a[1], a[2] + offset], [b[0], b[1], b[2] + offset],
          { rgb: [1, .81, .42], width: .012 + (1 - j / 20) * .010, density: (1 - j / 20) * .9 * gain });
      }
    }
    for (let i = 0; i < 6; i++) {
      const active = i <= generation + .001;
      draw.point([.42 + i * .248, .248, .541],
        { width: .026, rgb: active ? [.68, 1, .84] : [.28, .45, .48], density: active ? 1.42 : .79 });
    }
  });
  view(0);
  const world = B.finish({ spriteSurfaces: atlas,
    cam: { target: [0, 2.78, .21], dist: 11.3, fov: .58, yaw: -.095, pitch: .09 },
    radius: 5.15, detail: 25, dither: .07, look: { pixelSize: 1, splatCoverage: 'continuous' }
  });
  const stage = K.stage(world);
  stage.add(charge);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'recursive-curve-studies',
  name: 'Recursive Curves and Unfolding Circuit',
  seed: 64,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'atlas';
    if (!['atlas', 'circuit'].includes(study)) throw new RangeError('Use atlas or circuit');
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .39, sky: .23, sunK: .75, sun: K.V.norm([-.52, .76, .60]) });
    const sprites = SpriteSurface.make(1024), font = K.inspection.font({});
    return study === 'atlas' ? atlas(K, B, S, sprites, font) : circuit(K, B, S, sprites, font, SpriteSurface);
  }
});
