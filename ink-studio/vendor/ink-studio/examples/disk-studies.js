const tau = Math.PI * 2, side = 440, size = side / 2;
const hex = rgb => '#' + rgb.toString(16).padStart(6, '0');
const palette = [
  0x101825, 0x223047, 0x374e64, 0x567483, 0x88a4a6,
  0x552f39, 0x8f5348, 0xc98255, 0xf7b870, 0xffe2a0,
  0x22555b, 0x31848d, 0x65c9b9, 0xb7f1d0
];

function mosaic(K) {
  const { tiles } = K.procedural.tiles.hyperbolic({ p: 5, q: 4, depth: 8, minEdge: .0014,
    edgeSegments: 9, rotation: Math.PI / 2 });
  const ramps = [
    [0x226d78, 0x358b8b, 0x449c97, 0x61b7a5],
    [0x355378, 0x446389, 0x557696, 0x6589a4],
    [0x683f66, 0x805278, 0x9c6a87, 0xb48399]
  ];
  const draw = [{ type: 'rect', rect: [0, 0, side, side], color: '#11283d' }];
  for (const { id, depth, center, outline, vertices } of tiles) {
    const [x, y] = center, h = K.procedural.data.hash(id, 85), r = Math.hypot(x, y);
    const ramp = ramps[depth <= 1 ? 0 : r < .83 ? 1 : 2];
    const color = h % 13 === 0 && depth > 0 ? 0xb57959 : ramp[h % ramp.length];
    const xy = outline.map(([u, v]) => [(1 + u) * size, (1 - v) * size]);
    const edge = Math.max(...vertices.map((v, i) => Math.hypot(v[0] - vertices[(i + 1) % 5][0], v[1] - vertices[(i + 1) % 5][1])));
    const width = Math.max(.45, Math.min(1.6, size * edge * .021));
    draw.push({ type: 'polygon', points: xy, fill: hex(color), stroke: '#16263d', width });
    if (depth <= 2) {
      const centerPx = [(1 + x) * size, (1 - y) * size];
      const inset = xy.map(p => p.map((v, i) => centerPx[i] + .78 * (v - centerPx[i])));
      draw.push({ type: 'polygon', points: inset, fill: false, stroke: depth ? '#8eaea7' : '#e1ba81', width: depth ? .56 : 1 });
    }
  }
  const plan = K.frameComposite.prepare({ layers: [{ draw }] }, side, side);
  return K.frameComposite.layers(plan, {}, 0)[0].data;
}

function seal(K, seed) {
  const { circles } = K.procedural.packing.apollonian({ depth: 8, minRadius: .0025, rotation: Math.PI / 2 });
  const data = new Uint8Array(side * side * 4), colors = [
    [46, 139, 129], [151, 83, 98], [55, 105, 153], [165, 107, 62], [88, 130, 153]
  ];
  for (let i = 0; i < data.length; i += 4) data.set([13, 24, 39, 255], i);
  for (const { id, center: [u, v], radius, depth } of circles) {
    const x = (1 + u) * size, y = (1 - v) * size, r = radius * size;
    const h = K.procedural.data.hash(id, seed), color = depth ? colors[h % colors.length] : colors[Number(id.at(-1))];
    for (let row = Math.max(0, Math.floor(y - r)); row < Math.min(side, Math.ceil(y + r)); row++)
      for (let col = Math.max(0, Math.floor(x - r)); col < Math.min(side, Math.ceil(x + r)); col++) {
        const dx = (col + .5 - x) / r, dy = (row + .5 - y) / r, d = Math.hypot(dx, dy);
        if (d >= 1) continue;
        const i = 4 * (row * side + col), z = Math.sqrt(1 - d * d);
        if (1 - d < Math.min(.19, .55 / r + .015)) {
          data.set(dy < .2 ? [226, 172, 105, 255] : [127, 89, 75, 255], i);
          continue;
        }
        const light = Math.max(0, -.43 * dx - .51 * dy + .68 * z);
        const fleck = ((Math.imul(col, 11) ^ Math.imul(row, 17) ^ h) & 7) * .023;
        const shine = Math.max(0, light - .73) * 45;
        for (let j = 0; j < 3; j++) data[i + j] = Math.min(255, Math.round(color[j] * (.51 + .80 * light + fleck) + shine));
      }
  }
  return data;
}

function lensFrame(source, rgba, dx, dy) {
  // The inverse disk translation keeps the rim fixed and changes magnification toward it.
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const x = (i + .5) / size - 1, y = (j + .5) / size - 1;
    if (x * x + y * y > 1) continue;
    const a = 1 - dx * x - dy * y, b = dy * x - dx * y;
    const d = a * a + b * b, u = ((x - dx) * a + (y - dy) * b) / d;
    const v = ((y - dy) * a - (x - dx) * b) / d;
    const src = 4 * (Math.floor((1 + v) * size) * side + Math.floor((1 + u) * size));
    const dst = 4 * (j * side + i);
    rgba[dst] = source[src];
    rgba[dst + 1] = source[src + 1];
    rgba[dst + 2] = source[src + 2];
    rgba[dst + 3] = 255;
  }
}

module.exports = ({ KIT: K, SpriteSurface, makeBuilder, makeSculpt }) => ({
  id: 'disk-studies',
  name: 'Disk Gate and Apollonian Seal',
  seed: 23,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'gate';
    if (!['gate', 'seal'].includes(study)) throw new RangeError('Use gate or seal');
    const gate = study === 'gate', B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .33, sky: .27, sun: K.V.norm([-.67, .72, .44]), sunK: .80 });
    const metal = { r: [0, 1, 2, 3, 4] }, bronze = { r: [5, 6, 7, 8] };
    const amber = { r: [7, 8, 9], em: true }, mint = { r: [11, 12, 13], em: true };
    const axis = [[1, 0, 0], [0, 0, 1], [0, 1, 0]], Y = 2.59, r = 1.86, z = .704;
    const box = (at, half, mat, res = .087, rd = .041) => S.box(at, half, mat, { res, rd });
    box([0, -.08, .03], [2.60, .22, 1.02], metal, .13, .095);
    box([0, .118, .12], [2.48, .092, .90], bronze, .113, .052);
    box([0, .205, .08], [2.38, .085, .82], metal, .108, .051);
    S.ball([0, Y, -.005], [2.095, 2.095, .29], { r: [0, 1, 2] }, { res: .097 });
    S.torus([0, Y, .369], 1.991, .156, metal, { ax: axis, res: .073 });
    S.torus([0, Y, .552], 1.976, .092, bronze, { ax: axis, res: .067 });
    S.torus([0, Y, .659], 1.911, .032, bronze, { ax: axis, res: .060 });
    for (let i = 0; i < 20; i++) {
      const a = (i + .5) * tau / 20, cos = Math.cos(a), sin = Math.sin(a), p = [2.028 * cos, Y + 2.028 * sin, .659];
      S.ball(p, .042, i % 5 ? bronze : gate ? mint : amber, { res: .039 });
    }
    for (const side of [-1, 1]) {
      const p = x => x * side;
      box([p(1.84), .47, .10], [.26, .25, .27], metal, .09);
      S.tube([[p(1.91), .49, .26], [p(1.82), .91, .23], [p(1.67), 1.27, .26]],
        .077, .060, bronze, { res: .064 });
      box([p(2.24), .342, .59], [.093, .045, .162], gate ? mint : amber, .053, .016);
    }
    const sprite = SpriteSurface.make(640), region = sprite.reserve(side, side);
    sprite.faceRegion([-r, Y - r, z], [2 * r, 0, 0], [0, 2 * r, 0], region);
    const font = K.inspection.font({}), title = gate ? 'DISK GATE' : 'APOLLONIAN SEAL';
    const glyphs = [...title].map(ch => font.get(ch)), w = 205, h = 23, ox = Math.floor((w - 12 * glyphs.length) / 2);
    box([0, .295, .848], [1.45, .117, .156], bronze, .083, .031);
    sprite.face([-1.36, .197, 1.094], [2.72, 0, 0], [0, .197, 0], w, h, (u, v) => {
      const dx = Math.floor((u - ox) / 2), dy = Math.floor((v - 4) / 2);
      if (u === 2 || u === w - 3 || v === 2 || v === h - 3) return 0x9c7659;
      return dx >= 0 && dy >= 0 && dy < 7 && glyphs[Math.floor(dx / 6)]?.[dy * 6 + dx % 6] ? 0xf9d39b : 0x213143;
    });
    S.bake();
    const surfaces = sprite.finish();
    const original = gate ? mosaic(K) : seal(K, seed), rgba = new Uint8Array(side * side * 4);
    let tick = -1;
    function refresh(time) {
      const frame = Math.floor(time * 24 + 1e-7);
      if (frame === tick) return;
      tick = frame;
      const t = tau * frame / (5 * 24);
      lensFrame(original, rgba, gate ? .32 * Math.sin(t) : 0, gate ? .27 * (1 - Math.cos(t)) / 2 : 0);
      SpriteSurface.update(surfaces, region, { w: side, h: side, rgba });
    }
    refresh(0);
    const world = B.finish({ spriteSurfaces: surfaces,
      cam: { target: [0, 2.13, .41], dist: 10.38, yaw: -.085, pitch: .12, fov: .56 },
      radius: 5.4, detail: 24, dither: .13, look: { pixelSize: 2, splatCoverage: 'continuous' }
    });
    if (gate) K.stage(world).add({ update(_dt, time) { refresh(time); } });
    return world;
  }
});
