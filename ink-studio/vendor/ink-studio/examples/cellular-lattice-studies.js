const palette = [
  0x121827, 0x1e293b, 0x2c3e52, 0x40586c, 0x607b86, 0x97b1ac,
  0x422e39, 0x66454a, 0x92634f, 0xbc8c61, 0xe3bc82, 0xffe5a5,
  0x1c3349, 0x24556b, 0x348b93, 0x70beb1, 0xbbefd0,
  0x65394f, 0xa85269, 0xdc7880, 0xffab91, 0xffd2a9,
  0x34304f, 0x51406c, 0x74528c, 0xa16da8, 0xd29ac9,
  0x28483f, 0x3c7459, 0x62a578, 0x94ce8b, 0xc8eaa3,
  0x182b3c, 0x253c50, 0x112732, 0x24483e, 0xfab870, 0xb87a55
];
const cycle = [0x51406c, 0x74528c, 0xa16da8, 0xa85269, 0xdc7880, 0xffab91,
  0xe3bc82, 0x94ce8b, 0x62a578, 0x348b93, 0x24556b];
const ink = [0x12, 0x18, 0x27, 255];
const hex = rgb => '#' + rgb.toString(16).padStart(6, '0');
const unpack = rgb => [rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255, 255];
const phase = (t, period, frames) => ((Math.floor(t * frames / period + 1e-7) % frames) + frames) % frames;

function lettering(font, sprites, x, y, z, width, value, color) {
  const count = value.length * 6 + 4, glyphs = [...value].map(c => font.get(c));
  sprites.face([x - width / 2, y, z], [width, 0, 0], [0, width * 10 / count, 0], count, 10, (u, v) => {
    const i = u - 2, j = v - 1;
    if (i >= 0 && j >= 0 && j < 7 && glyphs[Math.floor(i / 6)]?.[j * 6 + i % 6]) return color;
  });
}

function raster(w, h, paint) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) rgba.set(paint(x, y), i);
  return { w, h, rgba };
}

function record(grid, count) {
  return Array.from({ length: count }, (_, i) => {
    if (i) grid.step();
    return grid.snapshot();
  });
}

function display(S, sprites) {
  const steel = { r: [0, 1, 2, 3, 4] }, bronze = { r: [6, 7, 8, 9, 10] },
    dark = { r: [0, 1, 2, 12] }, signal = { r: [13, 14, 15, 16], em: true };
  const box = (p, r, mat, res = .084, rd = .049) => S.box(p, r, mat, { res, rd });
  function panel(x, y, span, height, w, h) {
    const z = .19;
    box([x, y, -.06], [span / 2 + .078, height / 2 + .067, .18], bronze);
    const tile = sprites.reserve(w, h);
    sprites.faceRegion([x - span / 2, y - height / 2, z], [span, 0, 0], [0, height, 0], tile);
    return tile;
  }
  return { steel, bronze, dark, signal, box, panel };
}

const look = { pixelSize: 1, splatCoverage: 'continuous' };

function rules(K, B, S, sprites, font, SpriteSurface) {
  const C = K.cellular, { steel, box, panel } = display(S, sprites), span = 2.94, rise = 3.20, w = 279, h = 129;
  const samples = [
    { number: 30, dark: 0xbc8c61, light: 0xffe5a5, seed: 139 },
    { number: 90, dark: 0x348b93, light: 0xbbefd0, seed: 139 },
    { number: 110, dark: 0xa85269, light: 0xffd2a9, seed: 204 }
  ];
  box([0, 2.39, -.31], [5.10, 2.29, .25], steel, .118, .11);
  box([0, 4.37, -.03], [4.91, .21, .108], steel, .094);
  lettering(font, sprites, 0, 4.257, .128, 3.03, 'ELEMENTARY RULES', 0xffe5a5);
  const renders = samples.map(({ number, dark, light, seed }, i) => {
    const cx = (i - 1) * 3.26, tile = panel(cx, 2.33, span, rise, w, h),
      grid = C.create({ width: w, rule: C.rules.elementary(number), initial: ({ x }) => Number(x === seed) }),
      draw = K.glyphGrid.paint({ mode: 'pixel', tiles: [{ color: hex(0x182b3c) }, { color: hex(dark) }, { color: hex(light) }] });
    const snapshots = record(grid, h);
    const cells = Uint8Array.from({ length: w * h }, (_, i) => {
      const y = Math.floor(i / w), x = i % w;
      const current = snapshots[y].cells[x];
      return current ? 1 + Number(y < 13 || (y > 35 && snapshots[y - 1].cells[x] === 0)) : 0;
    });
    lettering(font, sprites, cx, .353, .151, 1.58, 'RULE ' + number, light);
    return { tile, image: draw.raster({ width: w, height: h, states: 3, cells }) };
  });
  S.bake();
  const surfaces = sprites.finish();
  for (const { tile, image } of renders) SpriteSurface.update(surfaces, tile, image);
  return B.finish({ spriteSurfaces: surfaces,
    cam: { target: [0, 2.42, 0], dist: 9.91, fov: .56, pitch: .033, yaw: -.036 },
    look, detail: 24, radius: 6, dither: .062
  });
}

function nearestHex(x, y) {
  const r = y / (Math.sqrt(3) / 2), q = x - r / 2, s = -q - r;
  let iq = Math.round(q), ir = Math.round(r);
  const dq = Math.abs(iq - q), dr = Math.abs(ir - r), ds = Math.abs(Math.round(s) - s);
  if (dq > dr && dq > ds) iq = -ir - Math.round(s);
  else if (dr > ds) ir = -iq - Math.round(s);
  return [iq, ir];
}

function cyclicPanel(grid, frame, w, h) {
  const colors = cycle.map(unpack), isHex = grid.lattice === 'hex';
  const limit = grid.position(grid.width - 1, grid.height - 1), step = Math.min(
    (w - 14) / (limit[0] + 1), (h - 11) / (limit[1] + 1));
  const [cx, cy] = [(w - limit[0] * step) / 2, (h - limit[1] * step) / 2];
  return raster(w, h, (u, v) => {
    const x = (u + .5 - cx) / step, y = (v + .5 - cy) / step;
    const [q, r] = isHex ? nearestHex(x, y) : [Math.round(x), Math.round(y)];
    if (q < 0 || r < 0 || q >= grid.width || r >= grid.height) return ink;
    const dx = x - (isHex ? q + .5 * r : q), dy = y - (isHex ? Math.sqrt(3) / 2 * r : r),
      edge = isHex ? Math.max(Math.abs(dx), Math.abs(.5 * dx + Math.sqrt(3) / 2 * dy),
        Math.abs(.5 * dx - Math.sqrt(3) / 2 * dy)) : Math.max(Math.abs(dx), Math.abs(dy));
    return edge > .45 ? ink : colors[frame.cells[r * grid.width + q]];
  });
}

function lattices(K, B, S, sprites, font, SpriteSurface) {
  const C = K.cellular, period = 5, frames = 40, w = 290, h = 158, side = 18, x = -2.23;
  const { steel, bronze, dark, signal, box, panel } = display(S, sprites);
  box([-2.23, 2.56, -.27], [1.86, 2.41, .206], steel, .110, .092);
  lettering(font, sprites, x, 4.627, .052, 2.02, 'CYCLIC WAVES', 0xffe5a5);
  const views = ['square', 'hex'].map((lattice, i) => {
    const y = i ? 1.35 : 3.43, tile = panel(x, y, 3.12, 1.70, w, h);
    const grid = C.create({ width: 40, height: 26, lattice, neighborhood: i ? 'hex' : 'cardinal',
      boundary: 'wrap', rule: C.rules.cyclic({ states: 11 }), seed: 73, initial: ({ random }) => Math.floor(random() * 11) });
    grid.step(94);
    const framesData = record(grid, frames);
    lettering(font, sprites, x, y - 1.105, .196, 1.93, i ? 'HEX / 6 NEIGHBORS' : 'SQUARE / 4 NEIGHBORS', 0x97b1ac);
    return { grid, framesData, tile };
  });

  const center = 2.02, half = 1.57;
  box([center, .33, 0], [1.81, .257, 1.60], steel, .100, .079);
  box([center, .59, 0], [1.69, .076, 1.48], bronze, .089);
  box([center, .685, 0], [1.56, .045, 1.35], dark, .077);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const at = [center + a * half, .716, b * 1.33];
    box(at, [.084, .082, .084], bronze, .049, .016);
    S.tube([at, [at[0], 4.15, at[2]]], .025, .025, steel, { res: .054 });
    box([at[0], 4.152, at[2]], [.070, .076, .062], signal, .045, .018);
    if (b === 1) for (let j = 0; j < 8; j++) {
      const y = 1.02 + j * .41;
      box([at[0] - a * .032, y, at[2] + .03], [.070, .018, .025], j % 3 ? bronze : signal, .041, .012);
    }
  }
  box([center, .34, 1.63], [1.37, .14, .075], dark, .062, .029);
  lettering(font, sprites, center, .319, 1.738, 1.72, "BRIAN'S BRAIN", 0xffe5a5);
  lettering(font, sprites, center, .210, 1.738, 1.82, 'VOXEL / 18 NEIGHBORS', 0x97b1ac);
  const voxel = C.create({ width: side, height: side, depth: side, lattice: 'voxel', neighborhood: 'edges',
    rule: C.rules.briansBrain(), seed: 19, initial: ({ x, y, z, random }) =>
      Number(Math.hypot(x - 8.5, y - 8.5, z - 8.5) < 5.85 && random() < .19) });
  const points = [], pins = [];
  for (let z = 0; z < side; z++) for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const p = voxel.position(x, y, z).map(n => n - 8.5);
    if (Math.hypot(...p) > 7.92) pins.push({ x, y, z, locked: true });
    points.push([center + p[0] * .181, 2.46 + p[1] * .196, p[2] * .174]);
  }
  voxel.edit(pins);
  const voxelFrames = record(voxel, frames);

  S.bake();
  const atlas = sprites.finish();
  let last = -1;
  const pulse = K.frameSplats(B, side ** 3, (draw, _dt, time) => {
    const tick = phase(time, period, frames);
    if (tick !== last) for (const { grid, framesData, tile } of views)
      SpriteSurface.update(atlas, tile, cyclicPanel(grid, framesData[tick], w, h));
    last = tick;
    voxelFrames[tick].cells.forEach((state, i) => {
      if (!state) return;
      draw.point(points[i], state === 1 ? { width: .034, rgb: [1, .76, .35], density: .83, depth: true }
        : { width: .027, rgb: [.24, .73, .71], density: .40, depth: true });
    });
  });
  const world = B.finish({ spriteSurfaces: atlas, look,
    cam: { target: [-.01, 2.50, .03], dist: 11.45, fov: .58, yaw: -.19, pitch: .14 },
    radius: 6.1, detail: 23, dither: .075
  });
  const stage = K.stage(world);
  stage.add(pulse);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

function status(font, value, color, w, h) {
  const characters = [...value].map(c => font.get(c)), left = Math.floor((w - characters.length * 6) / 2),
    top = Math.floor((h - 7) / 2), fg = unpack(color);
  return raster(w, h, (x, y) => {
    const i = x - left, j = y - top;
    return i >= 0 && j >= 0 && j < 7 && characters[Math.floor(i / 6)]?.[j * 6 + i % 6] ? fg : ink;
  });
}

function reversible(K, B, S, sprites, font, SpriteSurface) {
  const C = K.cellular, period = 6, deadline = 25, W = 60, H = 42, scale = 6, w = W * scale, h = H * scale;
  const grid = C.create({ width: W, height: H, boundary: 'wrap', rule: C.rules.blockGas(), seed: 28,
    initial: ({ x, y, random }) => {
      const r = Math.hypot(x - 29.5, (y - 20.5) * 1.16), bar = Math.abs(x - 29.5) < 22 && Math.abs(y - 20.5) < 1.6;
      return Number((r > 8 && r < 13 || bar) && random() < .67);
    } });
  const images = record(grid, deadline + 1);
  for (let i = 0; i < deadline; i++) { grid.back(); images.push(grid.snapshot()); }
  if (!images.at(-1).cells.every((v, i) => v === images[0].cells[i]))
    throw new Error('Reversible block demo failed to recover its initial state');
  const { steel, bronze, dark, box, panel } = display(S, sprites);
  box([0, 2.56, -.28], [3.01, 2.50, .264], steel, .115, .096);
  box([0, 4.79, -.016], [2.81, .193, .144], steel, .091, .071);
  lettering(font, sprites, 0, 4.680, .165, 3.17, 'REVERSIBLE BLOCKS', 0xffe5a5);
  const screen = panel(0, 2.59, 5.28, 3.70, w, h);
  box([0, .418, .071], [1.66, .148, .095], dark, .070);
  const badge = sprites.reserve(154, 15);
  sprites.faceRegion([-1.42, .295, .218], [2.84, 0, 0], [0, .29, 0], badge);
  for (const side of [-1, 1]) {
    const x = side * 2.79;
    for (const y of [.49, 4.77]) S.ball([x, y, .21], .047, bronze, { res: .036 });
    box([side * 2.31, .43, .076], [.29, .023, .055], bronze, .064, .012);
  }
  const dim = unpack(0x182b3c), deep = unpack(0x121827), join = unpack(0x253c50);
  const colors = [unpack(0xe3bc82), unpack(0x70beb1)], bright = [unpack(0xffe5a5), unpack(0xbbefd0)];
  const atlas = sprites.finish();
  let last = -1;
  const stageSystem = { update(_dt, time) {
    const i = K.clamp(phase(time, period, 60) - 4, 0, deadline * 2);
    if (i === last) return;
    last = i;
    const frame = images[i], backward = i > deadline, shift = (frame.tick - Number(backward)) & 1;
    SpriteSurface.update(atlas, screen, raster(w, h, (u, v) => {
      const x = Math.floor(u / scale), y = Math.floor(v / scale), a = u % scale, b = v % scale,
        major = !((x - shift) & 1) && a === 0 || !((y - shift) & 1) && b === 0;
      if (major) return join;
      if (!frame.cells[y * W + x]) return a === 0 || b === 0 ? deep : dim;
      return a > 1 && a < 5 && b > 1 && b < 5 ? bright[Number(backward)] : colors[Number(backward)];
    }));
    SpriteSurface.update(atlas, badge, status(font,
      (backward ? 'REVERSE' : 'FORWARD') + ' / TICK ' + String(frame.tick).padStart(2, '0'),
      backward ? 0xbbefd0 : 0xffe5a5, 154, 15));
  } };
  S.bake();
  const world = B.finish({ spriteSurfaces: atlas, look,
    cam: { target: [0, 2.58, .02], dist: 10.19, fov: .58, yaw: -.077, pitch: .061 },
    radius: 5.4, detail: 24, dither: .065
  });
  const stage = K.stage(world);
  stage.add(stageSystem);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'cellular-lattice-studies',
  name: 'Elementary Rules, Lattice Lab, and Reversible Blocks',
  seed: 62,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'rules', cases = { rules, lattices, reversible };
    if (typeof study !== 'string' || !Object.hasOwn(cases, study)) throw new RangeError('Use rules, lattices, or reversible');
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)),
      sprites = SpriteSurface.make(1024), font = K.inspection.font({});
    Object.assign(S, { pixel: true, amb: .39, sky: .21, sunK: .71, sun: K.V.norm([-.51, .72, .55]) });
    return cases[study](K, B, S, sprites, font, SpriteSurface);
  }
});
