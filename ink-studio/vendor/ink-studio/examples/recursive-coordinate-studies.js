const studio = require('..');
const palette = [
  0x121722, 0x1c2535, 0x2a374a, 0x40566b, 0x5f7d89, 0x88a2a4, 0xb1c8c5,
  0x392833, 0x594044, 0x815c4d, 0xa87b55, 0xc39765, 0xe4b678, 0xffe4a3,
  0x173340, 0x23545a, 0x327779, 0x4b9a93, 0x74bca7, 0xb4e3be,
  0x33283f, 0x563650, 0x84516a, 0xb87988, 0xecaba0, 0xffd6b4,
  0x171e31, 0x263e55, 0x3d6280, 0x5283a3, 0x84a9be, 0xb9d9da
];
const black = [0x12, 0x17, 0x22, 255], tau = Math.PI * 2;

function text(font, sprites, x, y, z, width, value, ink) {
  const glyphs = [...value].map(c => font.get(c)), w = value.length * 6 + 4;
  sprites.face([x - width / 2, y, z], [width, 0, 0], [0, width * 10 / w, 0], w, 10, (u, v) => {
    const a = u - 2, b = v - 1;
    if (a >= 0 && b >= 0 && b < 7 && glyphs[Math.floor(a / 6)]?.[b * 6 + a % 6]) return ink;
  });
}

function motif(K, size) {
  const draw = [
    { type: 'rect', rect: [0, 0, size, size], color: '#172334' },
    { type: 'grid', origin: [0, 0], counts: [12, 12], step: size / 12, color: '#304e61',
      majorEvery: 3, majorColor: '#466879', width: .78, majorWidth: 1.2 },
    { type: 'path', points: [[2, 2], [size - 2, 2], [size - 2, size - 2], [2, size - 2]],
      closed: true, width: 2.3, color: '#6b9b9e' }
  ];
  const center = size / 2;
  const at = (r, theta) => [center + center * r * Math.cos(theta), center + center * r * Math.sin(theta)];
  function ring(r, shift = 0, arc = tau, wave = 0) {
    return Array.from({ length: 161 }, (_, i) => {
      const a = shift + i * arc / 160;
      return at(r + wave * Math.sin(5 * a + .55), a);
    });
  }
  for (const r of [.26, .47, .74, .97]) {
    draw.push({ type: 'path', points: ring(r), width: 1.2, color: '#518080' });
  }
  draw.push({ type: 'path', points: ring(.63, -.55, tau, .145), width: 10, color: '#327779' },
    { type: 'path', points: ring(.63, -.55, tau, .145), width: 2.6, color: '#b4e3be' },
    { type: 'path', points: ring(.88, .52, 1.9), width: 7, color: '#a87b55' },
    { type: 'path', points: ring(.88, .52, 1.9), width: 2, color: '#ffe4a3' },
    { type: 'path', points: [at(.18, -2.37), at(.94, -2.37)], width: 4, color: '#b87988' },
    { type: 'path', points: [at(.18, .76), at(.99, .76)], width: 4, color: '#e4b678' });
  for (let i = 0; i < 40; i++) {
    const a = i * tau / 40;
    draw.push({ type: 'path', points: [at(i % 5 ? .90 : .84, a), at(.95, a)], width: i % 5 ? 1.1 : 2.4,
      color: i % 5 ? '#6f9391' : '#e4b678' });
  }
  const composed = K.frameComposite.prepare({ layers: [{ draw }] }, size, size);
  return { w: size, h: size, rgba: K.frameComposite.layers(composed, {}, 0)[0].data };
}

function modules(K, B, S, sprites, font, TexturedSurface, SpriteSurface) {
  const W = K.procedural.coordinateTransforms, size = 390, image = motif(K, size);
  const metal = { r: [0, 1, 2, 3, 4] }, bronze = { r: [7, 8, 9, 10, 11] };
  S.box([0, 2.39, -.35], [5.36, 2.24, .25], metal, { res: .118, rd: .096 });
  S.box([0, 4.33, -.04], [5.08, .24, .12], metal, { res: .104, rd: .058 });
  text(font, sprites, 0, 4.237, .13, 4.09, 'RECURSIVE COORDINATES', 0xffe4a3);
  const grid = TexturedSurface.grid({ segments: [40, 40], flip: true,
    point: (u, v) => [2 * u - 1, 1 - 2 * v, 0] });
  const geometry = W.mesh(grid, W.repeat(W.mobius({ a: [1, .06], c: [.105, -.075] }), 3));
  const inverted = W.mesh(grid, W.inversion({ center: [-.29, .52], radius: .625 }), { target: 'uv', outside: 'clamp' });
  const repeated = W.droste({ ratio: .416, angle: .52, twist: .94, depth: 6, radius: .979 });
  const extent = { min: [-1, -1], max: [1, 1] };
  const spiral = W.image(image, { map: repeated, extent, sourceExtent: extent, filter: 'linear', background: [23, 30, 49, 255] });
  const stations = [
    { material: image, mesh: geometry, title: 'MOBIUS', channel: 'GEOMETRY', accent: 0xb4e3be },
    { material: image, mesh: inverted, title: 'INVERSION', channel: 'UV MAP', accent: 0xecaba0 },
    { material: spiral, title: 'DROSTE', channel: 'RASTER', accent: 0xffe4a3 }
  ];
  for (const [i, { material, mesh, title, channel, accent }] of stations.entries()) {
    const x = (i - 1) * 3.43, y = 2.37, span = 3.11, face = .251;
    S.box([x, y, -.027], [span / 2 + .083, span / 2 + .084, .175], bronze, { res: .085, rd: .064 });
    const region = sprites.reserve(size, size);
    if (mesh) {
      const pairs = Array.from({ length: mesh.points.length / 3 }, (_, j) => [mesh.points[j * 3], mesh.points[j * 3 + 1], 0]);
      const { min, max } = K.procedural.spatial.boxOf(pairs);
      const inset = i === 0 ? .916 : 1, ratio = inset * span / Math.max(max[0] - min[0], max[1] - min[1]);
      const center = K.V.lerp(min, max, .5);
      for (const [j, p] of pairs.entries()) mesh.points.set([x + (p[0] - center[0]) * ratio,
        y + (p[1] - center[1]) * ratio, face + .043], j * 3);
      if (i === 0) sprites.face([x - span / 2, y - span / 2, face], [span, 0, 0], [0, span, 0], 96, 96,
        (u, v) => u % 12 === 0 && v % 12 === 0 ? 0x40566b : 0x171e31);
      sprites.meshRegion(mesh, region);
    } else sprites.faceRegion([x - span / 2, y - span / 2, face], [span, 0, 0], [0, span, 0], region);
    stations[i].region = region;
    text(font, sprites, x, .415, .172, 1.36, title, 0xffe4a3);
    text(font, sprites, x, .228, .172, 1.24, channel, accent);
  }
  S.bake();
  const pixels = sprites.finish();
  for (const row of stations) SpriteSurface.update(pixels, row.region, row.material);
  return B.finish({ spriteSurfaces: pixels,
    cam: { target: [0, 2.38, -.04], dist: 10.64, fov: .56, pitch: .034, yaw: -.045 },
    radius: 6, detail: 22, dither: .076, look: { pixelSize: 1, splatCoverage: 'continuous' }
  });
}

function room(K, B, S, sprites, font, SpriteSurface, feeds) {
  const W = K.procedural.coordinateTransforms, period = 5, w = 204, h = 250, levels = 4;
  const stack = W.droste({ center: [.5, .5], ratio: .89, angle: -.095, depth: levels });
  const metal = { r: [0, 1, 2, 3, 4, 5] }, slate = { r: [0, 1, 2, 3, 4] },
    brass = { r: [7, 8, 9, 10, 11, 12] }, green = { r: [14, 15, 16, 17, 18] },
    amber = { r: [10, 11, 12, 13], em: true }, mint = { r: [16, 17, 18, 19], em: true };
  const box = (p, r, mat, res = .109, rd = .062) => S.box(p, r, mat, { res, rd });
  box([0, -.14, -1.11], [4.52, .185, 4.8], slate, .148, .098);
  box([0, 2.43, -4.39], [4.34, 2.50, .30], metal);
  box([0, 4.79, -1.4], [4.26, .16, 2.82], slate, .159, .077);
  for (const s of [-1, 1]) {
    box([s * 4.26, 2.43, -1.1], [.195, 2.48, 3.29], metal, .144, .077);
    box([s * 2.97, 2.44, -4.033], [.298, 2.35, .14], brass, .102);
    box([s * 3.33, 2.50, -3.77], [.105, 2.09, .08], green, .087);
    box([s * 2.48, 1.09, -3.95], [.395, 1.04, .155], slate, .101);
    box([s * 2.48, 2.24, -3.93], [.348, .082, .191], brass, .076);
    S.tube([[s * 3.15, 1.98, -3.65], [s * 3.15, 3.38, -3.65]], .063, .063, s < 0 ? mint : amber, { res: .057 });
    box([s * 3.15, 2.69, -3.55], [.081, .78, .040], s < 0 ? mint : amber, .07, .02);
    for (const y of [1.82, 3.51]) box([s * 3.15, y, -3.63], [.17, .091, .16], brass, .078);
    for (let i = 0; i < 9; i++) {
      const z = -.01 - i * .39;
      box([s * (1.82 + (i % 2) * .025), .039, z], [.036, .021, .175], i % 3 ? green : mint, .056, .017);
    }
    for (const yy of [3.94, .38]) box([s * 2.55, yy, -3.88], [.32, .050, .065], s < 0 ? mint : amber, .071, .018);
  }
  for (let j = 0; j < 7; j++) {
    const z = .88 - .70 * j;
    box([0, .038, z], [1.56, .019, .017], brass, .082, .01);
    for (const s of [-1, 1]) box([s * 1.18, .04, z - .16], [.024, .019, .16], green, .07, .011);
  }

  const span = 2.75, rise = 3.37, left = -span / 2, bottom = .465, front = -3.609;
  box([0, bottom + rise / 2, -3.91], [span / 2 + .18, rise / 2 + .152, .205], brass, .081, .084);
  box([0, bottom + rise / 2, -3.798], [span / 2 + .064, rise / 2 + .06, .066], slate, .076, .03);
  for (const x of [-span / 2 - .10, span / 2 + .10]) {
    box([x, bottom + rise / 2, -3.607], [.036, rise / 2 - .091, .042], mint, .063, .014);
    for (const y of [bottom + .16, bottom + rise - .16]) S.ball([x, y, -3.56], .057, amber, { res: .046 });
  }
  for (const x of [-1.76, 1.76]) {
    box([x, 2.16, -3.90], [.095, .41, .113], green, .070);
    box([x, 2.16, -3.753], [.039, .312, .029], x < 0 ? mint : amber, .056, .011);
  }
  box([0, 4.25, -3.973], [1.17, .148, .095], metal, .069);
  text(font, sprites, 0, 4.178, -3.856, 1.92, 'ROOM WITHIN', 0xffe4a3);
  const region = sprites.reserve(w, h);
  sprites.faceRegion([left, bottom, front], [span, 0, 0], [0, rise, 0], region);
  const pixels = sprites.finish();
  const blank = motif(K, 256);
  const fallback = W.image(blank, { map: W.droste({ center: [.5, .5], radius: .48, ratio: .42, angle: .38, twist: .85 }),
    w, h, filter: 'linear', background: black });
  let atlas;
  function inset(raster) {
    SpriteSurface.update(pixels, region, W.image(raster, { map: stack.levels[1].map, w, h, filter: 'linear', background: black }));
  }
  atlas = studio.createCameraAtlas({
    width: levels * w, height: h, maxViewsPerFrame: levels, maxPixelsPerFrame: levels * w * h,
    views: stack.levels.slice(1).reverse().map(level => ({
      id: 'depth-' + level.index, rect: [(level.index - 1) * w, 0, w, h], fps: 10,
      frame({ time }) {
        if (level.index === levels) SpriteSurface.update(pixels, region, fallback);
        else inset(atlas.read('depth-' + (level.index + 1)));
        const t = time * tau / period;
        return { camera: { target: [0, 2.14, -3.04], dist: 7.27 - level.scale * .31,
          pitch: .073 + .013 * Math.cos(t - level.angle * 2), yaw: .111 * Math.sin(t + level.angle * 2.4), fov: .58 } };
      }
    }))
  });
  const layers = [];
  if (feeds) {
    const size = [74, 90], [sw, sh] = size, top = 543;
    for (let i = 0; i < levels; i++) {
      const left = 461 + i * 82;
      layers.push({ draw: [{ type: 'rect', rect: [left - 2, top - 2, sw + 4, sh + 4], color: '#815c4d' },
        { type: 'text', at: [left + sw / 2, top + sh + 12], text: 'DEPTH ' + (i + 1), size: 6, width: 1, color: '#e4b678' }] },
      atlas.layer('depth-' + (i + 1), { rect: [left, top, sw, sh] }));
    }
  }
  S.bake();
  const world = B.finish({ spriteSurfaces: pixels,
    cam: { target: [0, 2.41, -3.03], dist: 10.91, fov: .59, pitch: .077, yaw: -.033 },
    radius: 8, detail: 22, dither: .072, look: { pixelSize: 1, splatCoverage: 'continuous', ...(feeds && { composite: { layers } }) }
  });
  const stage = K.stage(world);
  let last = -1;
  stage.add({
    update(_dt, time) {
      const tick = ((Math.floor(time * 10 + 1e-7) % (period * 10)) + period * 10) % (period * 10);
      if (tick === last) return;
      atlas.capture(world, { time: tick / 10 });
      inset(atlas.read('depth-1'));
      last = tick;
    }
  });
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface }) => ({
  id: 'recursive-coordinate-studies',
  name: 'Recursive Coordinates and Room Within',
  seed: 88,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'coordinates';
    if (!['coordinates', 'room'].includes(study)) throw new RangeError('Use coordinates or room');
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)),
      sprites = SpriteSurface.make(1024), font = K.inspection.font({});
    Object.assign(S, { pixel: true, amb: .36, sky: .22, sunK: .67, sun: K.V.norm([-.54, .70, .55]) });
    return study === 'room' ? room(K, B, S, sprites, font, SpriteSurface, controls?.feeds)
      : modules(K, B, S, sprites, font, TexturedSurface, SpriteSurface);
  }
});
