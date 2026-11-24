const DURATION = 6.4, FPS = 10, FRAME_COUNT = Math.round(FPS * DURATION);
const palette = [0x0b1521, 0x16283b, 0x263e52, 0x466173, 0x7d939a,
  0x261c29, 0x553743, 0x885746, 0xc18c59, 0xeac58a,
  0x0d343c, 0x1f5360, 0x37938c, 0xa1d5bb];
const slate = { r: [0, 1, 2, 3, 4] }, iron = { r: [0, 0, 1, 2] }, stone = { r: [0, 1, 2, 3] };
const bronze = { r: [5, 6, 7, 8, 9] }, jade = { r: [10, 11, 12, 13] };
const lamp = { r: [11, 12, 13], em: true };
const clamp = n => Math.min(1, Math.max(0, n));

function setup(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .32, sky: .20, sunK: .82, sun: K.V.norm([-.52, .78, .34]) });
  const box = (p, half, mat, res = .091, rd = .068) => S.box(p, half, mat, { res, rd });
  function label(text, x, y, z, span, color) {
    const cols = text.length * 6, letters = [...text].map(c => font.get(c));
    sprites.face([x - span / 2, y, z], [span, 0, 0], [0, 0, -span * 7 / cols], cols, 7,
      (u, v) => letters[Math.floor(u / 6)]?.[v * 6 + u % 6] ? color : undefined);
  }
  function finish(camera, drawFrame) {
    S.bake();
    const atlas = sprites.finish();
    const world = B.finish({ spriteSurfaces: atlas, cam: camera, radius: 7, detail: 23, dither: .045,
      look: { pixelSize: 1, splatCoverage: 'continuous' } });
    let last = -1;
    const stage = K.stage(world);
    stage.add({ update(_dt, time) {
      const t = ((time % DURATION) + DURATION) % DURATION;
      const index = Math.min(FRAME_COUNT - 1, Math.floor(t * FPS + 1e-7));
      if (index === last) return;
      drawFrame((id, image) => SpriteSurface.update(atlas, id, image), index);
      last = index;
    } });
    stage.stateful = false;
    stage.update(0, 0);
    return world;
  }
  return { S, sprites, box, label, finish };
}

function floor(sprites, wave, y, zOffset, source, paint) {
  const { width, height, bounds } = wave, { min, max } = bounds;
  const region = sprites.reserve(width, height), images = [];
  sprites.faceRegion([min[0], y, max[1] + zOffset], [max[0] - min[0], 0, 0], [0, 0, min[1] - max[1]], region);
  const mask = wave.frame().mask();
  for (let i = 0; i < FRAME_COUNT; i++) {
    const count = Math.round(i / (FPS * wave.dt)) - wave.tick;
    if (count) wave.step(count, { source });
    const frame = wave.frame(), p = frame.data('pressure'), e = frame.data('energy');
    const rgba = new Uint8Array(width * height * 4), color = [0, 0, 0];
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const cell = z * width + x, pixel = ((height - 1 - z) * width + x) * 4;
      if (!mask[cell]) continue;
      paint(color, x, z, p[cell], e[cell]);
      rgba.set(color, pixel);
      rgba[pixel + 3] = 255;
    }
    images.push({ w: width, h: height, rgba });
  }
  return (write, i) => write(region, images[i]);
}

const warm = [255, 157, 76], cool = [72, 218, 211], crest = [255, 236, 175], trough = [205, 255, 235];
function ink(rgb, value, energy, scale, tile) {
  const tone = value >= 0 ? warm : cool, highlight = value >= 0 ? crest : trough;
  const amplitude = Math.sqrt(Math.abs(value) * scale);
  const glow = clamp(1.10 * amplitude + .044 * Math.sqrt(energy) * scale);
  const peak = clamp((amplitude - .59) * 1.65);
  for (let c = 0; c < 3; c++) {
    rgb[c] = tile[c] + (tone[c] - tile[c]) * glow * (1 - peak) + (highlight[c] - tile[c]) * peak;
  }
}

function doorway(K, set) {
  const { S, sprites, box, label } = set;
  const width = 164, height = 98, cell = .057, opening = .51, wall = .142, bellX = -2.38, bellZ = -.22;
  const edgeX = width * cell / 2, edgeZ = height * cell / 2, floorY = .335;
  const wave = K.procedural.motion.scalarWave({ width, height, cell, origin: [-edgeX, -edgeZ],
    speed: 2.72, damping: .11, boundary: 'absorb', sponge: { cells: 12 },
    mask: (x, z) => Math.abs(x) > wall || Math.abs(z) < opening });
  function strike(x, z, t) {
    const d = ((x - bellX) ** 2 + (z - bellZ) ** 2) / .50 ** 2;
    if (d >= 1) return 0;
    const phase = t < 3 ? t - .25 : t - 3.30;
    if (Math.abs(phase) > .23) return 0;
    const q = (Math.PI * 2.5 * phase) ** 2;
    return (t < 3 ? 215 : 150) * (1 - 2 * q) * Math.exp(-q) * (1 - d) ** 2;
  }
  const flagstone = [14, 23, 34], slateTile = [18, 30, 42], grout = [9, 15, 23];
  const lightFloor = floor(sprites, wave, floorY, 0, strike, (rgb, x, z, p, e) => {
    const stagger = Math.floor(z / 9) * 5, course = Math.floor((x + stagger) / 12);
    const tile = z % 9 === 0 || (x + stagger) % 12 === 0 ? grout : (course + Math.floor(z / 9) * 3) % 4 ? flagstone : slateTile;
    ink(rgb, p, e, 5.3, tile);
  });
  box([0, -.038, .09], [edgeX + .27, .224, edgeZ + .50], slate, .126, .115);
  box([0, .202, .03], [edgeX + .23, .058, edgeZ + .43], iron, .094, .084);
  for (const side of [-1, 1]) {
    box([side * (edgeX + .107), .347, .04], [.116, .077, edgeZ + .39], stone);
    box([0, .344, side * (edgeZ + .075)], [edgeX + .04, .077, .105], stone);
    const run = (edgeZ - opening) / 2;
    box([0, .50, side * (opening + run)], [wall, .238, run], stone, .073, .060);
    for (let j = 0; j < 6; j++) {
      const end = opening + (j + .5) * 2 * run / 6;
      box([0, .751, side * end], [wall + .037, .050, run / 6 - .026], j % 3 ? slate : bronze, .059, .052);
    }
    box([0, .68, side * (opening + .056)], [wall + .04, .360, .094], bronze, .061, .058);
    for (let i = 0; i < 9; i++) {
      box([side * (edgeX + .11), .459, -edgeZ + .30 + i * (2 * edgeZ - .60) / 8],
        [.055, .017, .025], i % 4 ? bronze : lamp, .041, .031);
    }
  }
  const arch = Array.from({ length: 25 }, (_, i) => {
    const a = i * Math.PI / 24;
    return [0, 1.035 + .41 * Math.sin(a), (opening + .054) * Math.cos(a)];
  });
  S.tube(arch, .12, .12, bronze, { res: .060 });
  S.tube(arch.map(([x, y, z]) => [x + .102, y, z]), .045, .045, jade, { res: .048 });
  S.ball([.137, 1.446, 0], .059, lamp, { res: .045 });

  for (const side of [-1, 1]) {
    box([bellX, .73, bellZ + side * .55], [.075, .43, .073], iron, .066, .060);
    box([bellX, .366, bellZ + side * .55], [.135, .046, .139], bronze, .058, .057);
  }
  box([bellX, 1.155, bellZ], [.066, .071, .63], bronze, .060, .054);
  S.lathe([bellX, .789, bellZ], .287, [.316, .297, .210, .161, .111], bronze, { res: .050 });
  S.tube(K.curve.circle([bellX, .650, bellZ], .303, 34, [0, 1, 0]), .043, .043, bronze, { res: .052 });
  S.ball([bellX, .598, bellZ], .074, lamp, { res: .043 });
  box([0, .33, edgeZ + .262], [1.22, .076, .181], iron);
  label('BELL GATE', 0, .500, edgeZ + .380, 1.86, 0xffdfa3);
  label('BELL CHAMBER', -2.54, .492, edgeZ + .267, 1.47, 0xd3ac78);
  label('TRANSMITTED WAVE', 2.55, .492, edgeZ + .267, 1.80, 0xa0d8c9);
  return set.finish({ target: [0, .25, .43], dist: 14.55, fov: .56, yaw: -.12, pitch: 1.01, sway: 0 }, lightFloor);
}

function echo(K, set) {
  const { sprites, box, label } = set;
  const width = 148, height = 39, cell = .049, speed = 2.52, layer = 22;
  const edgeX = width * cell / 2, edgeZ = height * cell / 2;
  const trays = [{ z: -1.30, edge: 'reflect', label: 'REFLECTING', mat: bronze, color: 0xffd58d },
    { z: 1.30, edge: 'absorb', label: 'ABSORBING', mat: jade, color: 0xa3e7cd }];
  box([0, -.115, .05], [4.23, .211, 2.96], slate, .132, .110);
  box([0, .135, .07], [4.13, .061, 2.84], iron, .093, .100);
  for (const tray of trays) {
    const wave = K.procedural.motion.scalarWave({ width, height, cell, origin: [-edgeX, -edgeZ], speed,
      damping: .075, boundary: { xMin: 'absorb', xMax: tray.edge }, sponge: { cells: layer },
      initial(x) {
        const d = x + 2.23, r = .42, k = 8.4, envelope = .77 * Math.exp(-((d / r) ** 2));
        const carrier = Math.cos(k * d);
        return { pressure: envelope * carrier, velocity: speed * envelope * (2 * d * carrier / (r * r) + k * Math.sin(k * d)) };
      } });
    const tiles = [[13, 22, 34], [17, 30, 44], [20, 44, 48], [28, 65, 67]];
    tray.paint = floor(sprites, wave, .387, tray.z, undefined, (rgb, x, z, p, e) => {
      const guide = x % 12 === 0 || z === 19;
      const absorber = tray.edge === 'absorb' && width - x <= layer;
      ink(rgb, p, e, 1.59, tiles[(absorber ? 2 : 0) + Number(guide)]);
    });
    box([0, .231, tray.z], [edgeX + .134, .052, edgeZ + .172], slate, .090, .067);
    for (const sign of [-1, 1]) {
      box([0, .35, tray.z + sign * (edgeZ + .051)], [edgeX + .078, .069, .061], stone, .071, .062);
      for (let i = 0; i < 15; i++) {
        const x = -edgeX + .17 + (2 * edgeX - .34) * i / 14;
        box([x, .438, tray.z + sign * (edgeZ + .046)], [.022, .016, .044],
          i % 4 ? slate : tray.mat, .034, .025);
      }
    }
    box([-edgeX - .082, .355, tray.z], [.082, .087, edgeZ + .107], iron, .064, .054);
    box([edgeX + .098, .425, tray.z], [.126, .188, edgeZ + .147], tray.mat, .075, .063);
    for (let i = 0; i < 8; i++) box([edgeX + .102, .630, tray.z + .235 * (i - 3.5)],
      [.089, .023, .059], tray.edge === 'absorb' ? lamp : slate, .042, .041);
    box([-2.62, .311, tray.z + edgeZ + .208], [1.10, .066, .127], iron, .069, .060);
    label(tray.label, -2.62, .464, tray.z + edgeZ + .295, 1.63, tray.color);
  }
  box([.99, .290, 2.590], [1.21, .061, .207], iron, .078, .068);
  label('ECHO BENCH', .99, .430, 2.728, 1.80, 0xffdfaa);
  return set.finish({ target: [0, .22, .31], dist: 13.43, fov: .55, yaw: -.12, pitch: .99, sway: 0 },
    (write, i) => trays.forEach(tray => tray.paint(write, i)));
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'wave-propagation-studies', name: 'Bell Gate and Echo Bench', seed: 61, duration: DURATION,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'doorway';
    if (!['doorway', 'echo'].includes(study)) throw new RangeError('Choose doorway or echo');
    const set = setup(K, makeBuilder, makeSculpt, SpriteSurface, seed);
    return (study === 'doorway' ? doorway : echo)(K, set);
  }
});
