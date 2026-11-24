const period = 6.4, ticks = 34;
const palette = [0x0c1220, 0x17253a, 0x273a50, 0x38566a, 0x567581, 0x819d9b,
  0x242d45, 0x3c4162, 0x5c5475, 0x827989, 0xa39a9c,
  0x232735, 0x483540, 0x71515a, 0xa67670, 0xd49f7e, 0xf1d1a2,
  0x11303c, 0x245567, 0x417989, 0x67aba3, 0xa8dcc5, 0xe7f5d9];
const steel = { r: [0, 1, 2, 3, 4] }, dark = { r: [0, 0, 1, 11] }, clay = { r: [11, 12, 13, 14] },
  bronze = { r: [12, 13, 14, 15, 16] }, glass = { r: [6, 7, 8, 9] }, pipe = { r: [17, 18, 19, 20] },
  marker = { r: [18, 19, 20, 21], em: true };
const conduit = { r: [0, 1, 2, 18] }, stroke = { r: [11, 12, 13, 12] };
const amber = [1, .72, .37], mint = [.42, .95, .76], ivory = [1, .98, .74];
const lerp = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const raise = (p, z) => [p[0], p[1], p[2] + z];

function studio(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .36, sky: .21, sunK: .78, sun: K.V.norm([-.59, .76, .32]) });
  const box = (p, half, mat, res = .088, rd = .049) => S.box(p, half, mat, { res, rd });
  const trace = (route, radius, mat, res = .059) => S.tube(route, radius, radius, mat, { res });
  function label(value, cx, y, z, width, color) {
    const cols = value.length * 6, glyphs = [...value].map(c => font.get(c));
    sprites.face([cx - width / 2, y, z], [width, 0, 0], [0, width * 7 / cols, 0], cols, 7, (x, v) =>
      glyphs[Math.floor(x / 6)]?.[v * 6 + x % 6] ? color : undefined);
  }
  return { B, S, sprites, box, trace, label };
}

function network(K, set, cells, wires, injections, paintCell, cam) {
  const graph = K.cellular.graph, { B, S, sprites, trace } = set;
  const sim = graph.create({ nodes: cells.map(({ id, type, point }) => ({ id, type, data: { point } })),
    edges: wires.map(({ id, from, to, type, delay, weight }) => ({ id, from, to, type, delay, weight })),
    rule: graph.rules.pulse({ refractory: 7 }) });
  const history = Array.from({ length: ticks }, (_, tick) => {
    if (tick) sim.step();
    if (injections[tick]) sim.edit(injections[tick].map(id => ({ id, state: 1 })));
    return sim.frame();
  });
  for (const { route, type } of wires) trace(route.map(p => raise(p, -.023)), type === 'skybridge' ? .036 : .027, conduit, .045);
  S.bake();
  const atlas = sprites.finish();
  const pulse = K.frameSplats(B, 2200, (draw, _dt, time) => {
    const cursor = (((time % period) + period) % period) * ticks / period;
    const index = Math.min(ticks - 1, Math.floor(cursor + 1e-8)), frame = history[index], fraction = Math.max(0, cursor - index);
    for (const cell of cells) paintCell(draw, cell, frame.get(cell.id), fraction);
    for (const { from, route, delay, tint, type } of wires) for (let age = 0; age < delay; age++) {
      if (frame.get(from, age) !== 1) continue;
      const position = (age + fraction) / delay;
      for (let j = 10; j >= 0; j--) {
        const at = position - j * (type === 'skybridge' ? .029 : .052);
        if (at < 0) continue;
        const fade = (1 - j / 11) ** 1.3, p = raise(K.curve.at(route, at), .067);
        draw.point(p, { width: .019 + fade * (type === 'skybridge' ? .062 : .038), density: fade,
          rgb: lerp(tint, ivory, .37 * fade), emissive: true, depth: true });
      }
    }
  });
  const world = B.finish({ spriteSurfaces: atlas, cam, radius: 7, detail: 24, dither: .065,
    look: { pixelSize: 1, splatCoverage: 'continuous' } });
  const stage = K.stage(world);
  stage.add(pulse);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

function facade(K, set) {
  const { B, S, box, trace, label } = set;
  const cells = [], wires = [], panel = new Map(), xs = [[-3.49, -2.59, -1.69], [1.54, 2.44, 3.34]],
    ys = [[1.29, 2.19, 3.10, 4.01], [1.29, 2.19, 3.10, 4.01, 4.91]];
  const plinth = [0, .18, 0];
  box(plinth, [4.55, .208, 1.68], dark, .155, .147);
  box([0, .39, .10], [4.37, .073, 1.55], steel, .112, .097);
  box([0, .52, 1.61], [1.55, .148, .105], dark, .073, .081);
  label('SKYBRIDGE RELAY', 0, .476, 1.775, 2.72, 0xf1d1a2);
  for (let side = 0; side < 2; side++) {
    const x = xs[side][1], top = side ? 5.57 : 4.68, front = side ? .52 : .63, high = (top + .47) / 2;
    box([x, high, front - .89], [1.32, high - .47, .84], side ? glass : steel, .125, .062);
    box([x, high, front - .095], [1.17, high - .49, .095], side ? clay : dark, .089, .061);
    for (const sideX of [-1.22, 1.22]) box([x + sideX, high, front], [.050, high - .48, .042], bronze, .065, .023);
    for (const y of ys[side]) {
      box([x, y - .31, front + .032], [1.15, .031, .063], steel, .060, .021);
      box([x, y + .29, front + .017], [1.16, .028, .073], side ? glass : steel, .066, .024);
    }
    for (const [col, px] of xs[side].entries()) for (const [row, y] of ys[side].entries()) {
      const id = (side ? 'b' : 'a') + row + col, point = [px, y, front + .19];
      const cell = { id, type: 'panel', point, tint: side ? mint : amber };
      cells.push(cell); panel.set(id, cell);
      box([px, y, front + .067], [.311, .193, .081], bronze, .066, .037);
      box([px, y, front + .146], [.256, .135, .023], dark, .057, .023);
      for (const axis of [-1, 1]) box([px + axis * .253, y, front + .153], [.028, .126, .027], side ? glass : steel, .047, .025);
    }
    box([x, top, front - .32], [1.37, .104, .94], steel, .117, .063);
    box([x, top + .125, front - .47], [side ? .78 : .61, .137, .64], bronze, .095, .067);
    const pole = [x + (side ? .70 : -.72), top + .12, front - .23];
    trace([pole, [pole[0], top + .69, pole[2]]], .025, steel, .051);
    S.ball([pole[0], top + .69, pole[2]], .054, marker, { res: .035 });
    box([x, .72, front + .09], [.78, .115, .098], dark, .068, .053);
    label(side ? 'RELAY B' : 'RELAY A', x, .664, front + .25, 1.11, side ? 0xa8dcc5 : 0xf1d1a2);
  }
  function connect(from, to, delay = 2, type = 'conduit', path) {
    const a = panel.get(from).point, b = panel.get(to).point;
    const route = path ?? [a, raise(lerp(a, b, .3), .127), raise(lerp(a, b, .7), .127), b];
    wires.push({ id: from + '-' + to, from, to, delay, type, route, tint: panel.get(from).tint });
  }
  for (const [a, b] of [['a00','a10'], ['a10','a11'], ['a11','a21'], ['a21','a22'], ['a21','a31'],
    ['a11','a01'], ['a22','a32'], ['b20','b30'], ['b20','b21'], ['b21','b22'], ['b22','b32'],
    ['b21','b11'], ['b30','b40'], ['b40','b41'], ['b11','b12'], ['b12','b02'], ['b32','b42']]) connect(a, b);
  const a = panel.get('a22').point, b = panel.get('b20').point;
  connect('a22', 'b20', 7, 'skybridge', [a, [-1.25, 3.10, 1.03], [-.92, 3.00, 1.21], [.82, 3.00, 1.21], [1.20, 3.10, 1.03], b]);
  box([-.07, 2.728, .44], [1.53, .123, .44], steel, .093, .058);
  box([-.07, 2.89, .83], [1.48, .047, .044], bronze, .061, .025);
  box([-.07, 2.52, .21], [1.44, .036, .065], bronze, .059, .027);
  for (let i = 0; i < 8; i++) {
    const x = -1.37 + i * .365;
    trace([[x, 2.55, .25], [x + .32, 2.74, .82]], .022, steel, .05);
    trace([[x, 2.77, .87], [x, 2.96, .87]], .022, pipe, .048);
    if (i % 2 === 0) box([x, 2.69, .90], [.056, .025, .016], marker, .041, .012);
  }
  for (let i = 0; i < 19; i++) {
    const x = -4.11 + i * .455, v = B.n3(x * 1.6, 1, 1);
    if (Math.abs(x) > 1.15 && v > .29) box([x, .59, 1.06 + .14 * v], [.105 + v * .065, .083 + .10 * v, .12], clay, .073, .049);
  }
  const paint = (draw, { point, tint }, state) => {
    if (!state) return;
    const brightness = state === 1 ? 1 : .79 * (1 - (state - 2) / 7) ** 1.65;
    for (let y = -1; y <= 1; y++) for (let x = -3; x <= 3; x++) {
      draw.point([point[0] + x * .065, point[1] + y * .055, point[2] + .027],
        { width: .048, density: brightness * (y === 0 ? .92 : .75), rgb: lerp(tint, ivory, state === 1 ? .52 : .08),
          emissive: true, depth: true });
    }
  };
  return network(K, set, cells, wires, { 0: ['a00'] }, paint,
    { target: [-.02, 2.91, .02], dist: 12.86, fov: .58, yaw: -.29, pitch: .19, sway: 0 });
}

function loom(K, set) {
  const { S, box, trace, label } = set, cells = [], wires = [], byId = new Map();
  const strokeZ = .59;
  function node(id, type, point, tint, route) {
    const cell = { id, type, point, tint, route };
    cells.push(cell); byId.set(id, cell);
    if (route) trace(route.map(p => raise(p, -.045)), .051, stroke, .054);
    else {
      S.ball(raise(point, -.096), type === 'source' ? .155 : .111, steel, { res: .058 });
      S.ball(raise(point, -.048), type === 'source' ? .092 : .065, pipe, { res: .039 });
    }
  }
  function connect(from, to, delay, weight = 1) {
    const a = byId.get(from), b = byId.get(to), dx = b.point[0] - a.point[0];
    const route = K.curve.bezier(a.point, raise([a.point[0] + dx * .67, a.point[1], a.point[2]], .17),
      raise([b.point[0] - dx * .68, b.point[1], b.point[2]], .13), b.point, 16);
    wires.push({ id: from + '-' + to, from, to, delay, weight, route, tint: a.tint, type: 'conduit' });
  }
  const ringAt = [0, 2.54, -.055];
  const ring = K.curve.circle(ringAt, 1.49, 65, [0, 0, 1]);
  trace(ring, .077, steel, .081);
  trace(K.curve.circle(raise(ringAt, .12), 1.36, 58, [0, 0, 1]), .034, pipe, .062);
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12, x = 1.55 * Math.cos(a), y = 2.54 + 1.55 * Math.sin(a);
    if (i % 3 === 0) S.ball([x, y, .104], .058, bronze, { res: .042 });
    else S.ball([x, y, .071], .026, marker, { res: .031 });
  }
  box([0, .313, -.13], [3.78, .247, 1.08], steel, .122, .15);
  box([0, .59, -.15], [3.52, .095, .81], bronze, .09, .066);
  box([0, .48, .985], [1.61, .146, .097], dark, .070, .062);
  label('GLYPH LOOM', 0, .410, 1.119, 2.34, 0xf1d1a2);
  box([0, .852, -.125], [.31, .262, .32], steel, .095, .057);
  const strokes = [
    { id: 'crest', tint: amber, path: [[-.65, 3.09], [-.53, 3.40], [-.13, 3.63], [.28, 3.57], [.55, 3.31]] },
    { id: 'keel', tint: mint, path: [[.67, 2.08], [.43, 1.78], [.07, 1.64], [-.34, 1.78], [-.67, 2.05]] },
    { id: 'spine', tint: ivory, path: [[-.56, 2.24], [-.31, 2.62], [.13, 2.91], [.61, 3.02]] },
    { id: 'eye', tint: ivory, path: [[-.14, 2.38], [.23, 2.66], [.54, 2.44], [.28, 2.18], [-.14, 2.38]] }
  ];
  for (const { id, tint, path } of strokes) {
    const route = K.curve.spline(path.map(([x, y]) => [x, y, strokeZ]), 5);
    node(id, 'stroke', K.curve.at(route, .5), tint, route);
  }
  for (const [side, sign, tint] of [['a', -1, amber], ['b', 1, mint]]) {
    node(side, 'source', [sign * 3.12, 1.44, .57], tint);
    node(side + 'fork', 'junction', [sign * 2.52, 2.49, .44], tint);
    node(side + 'upper', 'junction', [sign * 1.79, 3.57, .25], tint);
    node(side + 'lower', 'junction', [sign * 1.96, 1.87, .36], tint);
    box([sign * 3.12, 1.03, .25], [.221, .35, .22], side === 'a' ? bronze : pipe, .073, .046);
    label(side.toUpperCase(), sign * 3.12, .979, .58, .226, side === 'a' ? 0xf1d1a2 : 0xa8dcc5);
    for (const y of [1.16, 3.56]) trace([[sign * 2.47, .68, -.49], [sign * 2.58, y, -.30]], .045, steel, .063);
    connect(side, side + 'fork', 3);
    connect(side + 'fork', side + 'lower', 3);
    connect(side + 'fork', side + 'upper', 3);
    connect(side + 'upper', 'spine', 4, .5);
    connect(side + 'lower', 'eye', 3, .5);
    connect(side + (side === 'a' ? 'upper' : 'lower'), side === 'a' ? 'crest' : 'keel', 2);
  }
  const paint = (draw, { point, type, route, tint }, state, phase) => {
    if (!state) return;
    const intensity = state === 1 ? .87 + .13 * phase : .82 * (1 - (state - 2) / 7) ** 1.6;
    if (type === 'stroke') {
      const samples = Math.ceil(K.curve.length(route) / .044);
      for (let i = 0; i <= samples; i++) draw.point(raise(K.curve.at(route, i / samples), .046),
        { width: .036 + intensity * .031, density: intensity * (.76 + .17 * Math.sin(i * .29 + 1)),
          rgb: lerp(tint, ivory, .34 * intensity), emissive: true, depth: true });
    } else draw.point(point, { width: type === 'source' ? .108 : .078, density: intensity,
      rgb: lerp(tint, ivory, .5 * intensity), emissive: true, depth: true });
  };
  return network(K, set, cells, wires, { 0: ['a'], 15: ['a', 'b'] }, paint,
    { target: [-.04, 1.98, .02], dist: 9.55, fov: .62, yaw: -.20, pitch: .12, sway: 0 });
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'graph-automata-studies', name: 'Skybridge Relay and Glyph Loom', seed: 49,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'facade';
    if (!['facade', 'glyphs'].includes(study)) throw new RangeError('Choose facade or glyphs');
    const set = studio(K, makeBuilder, makeSculpt, SpriteSurface, seed);
    return (study === 'facade' ? facade : loom)(K, set);
  }
});
