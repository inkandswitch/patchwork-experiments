const duration = 6.4, count = 64;
const palette = [0x101725, 0x1f2d40, 0x314357, 0x506575, 0x829a9c,
  0x362a35, 0x584048, 0x8d6559, 0xc89973, 0xf3cc92, 0xffecb8,
  0x1b3340, 0x245664, 0x448685, 0x7db9ab, 0xc2ecd5,
  0x322c43, 0x514266, 0x7c6992, 0xa18bb0];
const steel = { r: [0, 1, 2, 3, 4] }, dark = { r: [0, 0, 1, 11] }, bronze = { r: [5, 6, 7, 8, 9] },
  jade = { r: [11, 12, 13, 14] }, signal = { r: [12, 13, 14, 15], em: true };
const clamp = v => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * clamp(t));
const darkInk = [12, 22, 34];

function instrument(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .36, sky: .22, sunK: .77, sun: K.V.norm([-.53, .73, .41]) });
  const box = (p, half, mat, res = .082, rd = .057) => S.box(p, half, mat, { res, rd });
  function title(text, x, y, z, width, color) {
    const cols = text.length * 6, glyphs = [...text].map(c => font.get(c));
    sprites.face([x - width / 2, y, z], [width, 0, 0], [0, width * 7 / cols, 0], cols, 7, (i, j) =>
      glyphs[Math.floor(i / 6)]?.[j * 6 + i % 6] ? color : undefined);
  }
  function screen(x, y, span, rise, z, width, height) {
    const id = sprites.reserve(width, height);
    sprites.faceRegion([x - span / 2, y - rise / 2, z], [span, 0, 0], [0, rise, 0], id);
    return id;
  }
  return { B, S, sprites, font, box, title, screen };
}

function raster(w, h, color) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) rgba.set(color(x, y), i);
  return { w, h, rgba };
}
const opaque = c => [...c, 255];

function status(font, text) {
  const w = 205, h = 11, shift = Math.floor((w - text.length * 6) / 2), chars = [...text].map(c => font.get(c));
  return raster(w, h, (x, y) => {
    const i = x - shift, j = y - 2;
    const on = i >= 0 && j >= 0 && j < 7 && chars[Math.floor(i / 6)]?.[j * 6 + i % 6];
    return on ? [208, 229, 192, 255] : [13, 21, 33, 255];
  });
}

function finish(K, SpriteSurface, gadget, cam, update, emit = () => {}) {
  const { B, S, sprites } = gadget;
  S.bake();
  const atlas = sprites.finish();
  const write = (region, image) => SpriteSurface.update(atlas, region, image);
  let previous = -1;
  const system = K.frameSplats(B, 600, (draw, _dt, time) => {
    const at = ((time % duration) + duration) % duration;
    const i = Math.min(count - 1, Math.floor(at * 10 + 1e-7));
    if (i !== previous) { update(write, i); previous = i; }
    emit(draw, i);
  });
  const world = B.finish({ spriteSurfaces: atlas, cam, detail: 23, radius: 6.4, dither: .071,
    look: { pixelSize: 1, splatCoverage: 'continuous' } });
  const stage = K.stage(world);
  stage.add(system);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

const size = 85, center = 42;
const drains = [[18, 18], [66, 18], [18, 66], [66, 66]];
const outside = (x, y) => Math.abs(x - center) + Math.abs(y - center) > 68 ||
  drains.some(([a, b]) => (x - a) ** 2 + (y - b) ** 2 <= 4);
function sealImage({ grains, topplings, last, tick, stable }) {
  return raster(size * 2, size * 2, (px, py) => {
    const x = px >> 1, y = py >> 1, i = size * y + x;
    if (outside(x, y)) return [0, 0, 0, 0];
    const amount = topplings[i], h = Math.log1p(amount) / 6.3, d = Math.min(grains[i], 4) / 4;
    const neighbors = [x + 1 < size ? topplings[i + 1] : amount, y + 1 < size ? topplings[i + size] : amount];
    const grade = Math.floor(h * 12) / 12;
    const contour = amount > 0 && neighbors.some(n => Math.floor(h * 12) !== Math.floor(Math.log1p(n) / 6.3 * 12));
    const notch = (px & 1) === 0 && (py & 1) === 0;
    const alloy = mix([23, 39, 48], [83, 146, 137], grade * .93);
    let ink = mix(alloy, [227, 189, 121], (contour ? .28 : .0) + d * (notch ? .31 : .17) * (amount ? 1 : .33));
    if (amount) ink = mix(ink, [12, 22, 26], notch ? .02 : .27 * d);
    const fresh = !stable && last[i] > 0 ? clamp(1 - (tick - last[i]) / 8) : 0;
    const heat = fresh * (notch ? .90 : .26);
    return opaque(mix(ink, [255, 229, 165], heat));
  });
}

function avalanche(K, SpriteSurface, gadget) {
  const { S, box, title, screen, font } = gadget, X = 0, Y = 2.77, span = 4.16, z = .31;
  const pile = K.cellular.sandpile.create({ width: size, height: size, initial: 1, mask: ({ x, y }) => !outside(x, y) });
  pile.add([{ x: center, y: center, grains: 4600 }, ...[[26, 26], [58, 26], [26, 58], [58, 58]].map(([x, y]) => ({ x, y, grains: 350 }))]);
  const frames = Array.from({ length: count }, (_, i) => {
    const target = Math.round(3 + 4750 * (i / 56) ** 1.56);
    if (pile.tick < target && !pile.frame().stable) pile.step(target - pile.tick);
    const frame = pile.frame();
    return { tick: frame.tick, stable: frame.stable, mass: frame.mass,
      grains: frame.data(), topplings: frame.data('topplings'), last: frame.data('lastToppled') };
  });
  box([X, 2.69, -.39], [3.10, 2.59, .28], steel, .131, .224);
  box([X, 2.77, -.07], [2.83, 2.20, .198], dark, .108, .199);
  box([X, 5.05, -.026], [2.73, .193, .13], bronze, .086, .093);
  box([X, 5.047, .105], [2.45, .148, .086], dark, .080, .067);
  title('AVALANCHE SEAL', X, 5.008, .359, 2.83, 0xffecb8);
  const cut = .74, h = span / 2, boundary = [[-h + cut, h], [h - cut, h], [h, h - cut], [h, -h + cut],
    [h - cut, -h], [-h + cut, -h], [-h, -h + cut], [-h, h - cut], [-h + cut, h]];
  const contour = scale => boundary.map(([x, y]) => [X + scale * x, Y + scale * y, .186]);
  S.tube(contour(1.027), .087, .087, bronze, { res: .062 });
  S.tube(contour(1.077), .022, .022, jade, { res: .051 });
  for (const [dx, dy] of [[-2.6, -1.67], [-2.6, 1.67], [2.6, -1.67], [2.6, 1.67]]) {
    S.ball([dx, Y + dy, .196], [.079, .079, .055], bronze, { res: .04 });
    for (let j = 1; j <= 4; j++) box([dx - Math.sign(dx) * .50 + j * Math.sign(dx) * .09, Y + dy, .134], [.019, .040, .017],
      j === 4 ? jade : steel, .040, .013);
  }
  box([X, .392, .029], [2.51, .153, .12], dark, .077, .054);
  const stamp = screen(X, Y, span, span, z, size * 2, size * 2);
  const readout = screen(X, .386, 4.24, .232, .218, 205, 11);
  for (const [x, y] of drains) {
    const dx = ((x + .5) / size - .5) * span, dy = ((y + .5) / size - .5) * span;
    S.tube(K.curve.circle([dx, Y - dy, z + .027], .100, 16, [0, 0, 1]), .021, .021, bronze, { res: .035 });
  }
  const update = (write, i) => {
    const frame = frames[i];
    write(stamp, sealImage(frame));
    const tick = 'WAVE ' + String(frame.tick).padStart(4, '0');
    const drained = 'DRAIN ' + String(frame.mass.lost);
    write(readout, status(font, `${tick}   ${drained}${frame.stable ? '  SET' : ''}`));
  };
  const sparks = (draw, i) => {
    const frame = frames[i];
    if (frame.stable) return;
    for (let j = 0; j < size * size; j += 11) {
      const age = frame.tick - frame.last[j];
      if (!frame.last[j] || age > 1 || frame.topplings[j] < 2) continue;
      const [u, v] = [j % size, Math.floor(j / size)];
      draw.point([X + ((u + .5) / size - .5) * span, Y - ((v + .5) / size - .5) * span, z + .043 + age * .013],
        { width: .016, density: .46 - .16 * age, rgb: [1, .78, .46], emissive: true, depth: true });
    }
  };
  return finish(K, SpriteSurface, gadget,
    { target: [0, 2.72, -.03], dist: 10.18, fov: .59, yaw: -.16, pitch: .10, sway: 0 }, update, sparks);
}

function waves(K, SpriteSurface, gadget) {
  const { S, box, title, screen, font } = gadget, C = K.cellular;
  const spiralRule = C.rules.excitable({ refractory: 14 });
  const spiral = C.create({ width: 118, height: 72, lattice: 'hex', rule: spiralRule,
    initial: ({ x, y }) => {
      const dx = x - 59, dy = y - 36;
      if (dx < -5 && dx > -33 && dy >= -7 && dy <= 7) return dy + 8;
      if (dx > 5 && dx < 34 && dy <= 7 && dy >= -7) return 8 - dy;
      return 0;
    } });
  const collisionRule = C.rules.excitable({ threshold: 2, refractory: 7, recovery: 4 });
  const collision = C.create({ width: 57, height: 49, rule: collisionRule,
    initial: ({ x, y }) => Math.min(Math.hypot(x - 15, y - 24), Math.hypot(x - 41, y - 24)) < 3.4 ? collisionRule.firing : 0 });
  const record = (grid, end) => Array.from({ length: count }, (_, i) => {
    const target = Math.floor(i * end / (count - 1));
    if (target > grid.tick) grid.step(target - grid.tick);
    return grid.snapshot();
  });
  const big = { x: -1.61, y: 2.76, w: 4.90, h: 3.18, z: .265 }, small = { x: 2.57, y: 2.67, w: 2.85, h: 2.45, z: .266 };
  function scope(view, grid, rule, steps, highlight, titleText) {
    const { x, y, z, w, h } = view, width = grid.width, height = grid.height;
    box([x, y, .03], [w / 2 + .086, h / 2 + .093, .178], bronze, .078, .083);
    const tile = screen(x, y, w, h, z, width * 2, height * 2);
    title(titleText, x, y - h / 2 - .274, .303, Math.min(.58 * w, 2.08), 0xc2ecd5);
    const colors = Array.from({ length: rule.states }, (_, n) => {
      const entry = rule.describe(n);
      if (entry.phase === 'firing') return highlight;
      if (entry.phase === 'charging') return [180, 127, 77];
      if (entry.phase === 'recovering') return mix([16, 30, 39], [39, 105, 115], entry.remaining / 4);
      if (entry.phase === 'refractory') return mix([26, 37, 57], [116, 74, 112], (entry.remaining / (rule.states - rule.firing)) ** .63);
      return darkInk;
    });
    return { tile, colors, frames: record(grid, steps), width, height };
  }
  box([0, 2.58, -.43], [4.42, 2.42, .30], steel, .126, .193);
  box([0, 2.59, -.102], [4.24, 2.26, .171], dark, .095, .158);
  box([0, 4.71, .034], [4.19, .199, .107], steel, .086, .080);
  title('EXCITABLE SLATE', -.61, 4.594, .181, 3.10, 0xffecb8);
  const views = [scope(big, spiral, spiralRule, 88, [255, 236, 163], 'SPIRAL FRONTS'),
    scope(small, collision, collisionRule, 52, [188, 248, 200], 'COLLISION')];
  box([2.57, 1.34, .064], [1.48, .088, .093], dark, .070, .049);
  box([0, .57, .015], [4.14, .172, .113], steel, .085, .086);
  box([-1.25, .568, .113], [2.71, .099, .054], dark, .065, .039);
  title('CHARGE', -3.29, .502, .224, .79, 0xdca872);
  title('FIRING', -2.15, .502, .224, .79, 0xffdf9d);
  title('REFRACTORY', -.79, .502, .224, 1.24, 0xb1a4bd);
  title('RECOVERY', .61, .502, .224, 1.02, 0x85b8c7);
  const panel = screen(2.63, .571, 2.56, .184, .198, 205, 11);
  for (const x of [-4.11, 4.04]) for (const y of [.59, 4.71]) S.ball([x, y, .223], .062, bronze, { res: .036 });
  for (let j = 0; j < 8; j++) box([1.41 + .31 * j, 4.712, .181], [.075, .029, .026], j % 3 ? dark : signal, .043, .015);
  const update = (write, i) => {
    for (const view of views) {
      const { width, height, frames, colors, tile } = view;
      const field = frames[i].cells;
      write(tile, raster(width * 2, height * 2, (x, y) => {
        const col = x >> 1, row = y >> 1, k = field[row * width + col];
        const p = colors[k];
        const grid = !k && col % 8 === 0 && row % 8 === 0 && (x & 1) === 0 && (y & 1) === 0;
        return opaque(grid ? mix(p, [54, 76, 94], .6) : p);
      }));
    }
    const frame = views[1].frames[i];
    const text = frame.cells.some(value => value === collisionRule.firing) ? 'FRONTS ACTIVE' :
      frame.cells.some(Boolean) ? 'RECOVERING' : 'AT REST';
    write(panel, status(font, text));
  };
  return finish(K, SpriteSurface, gadget,
    { target: [-.23, 2.56, -.02], dist: 10.72, fov: .57, yaw: -.135, pitch: .07, sway: 0 }, update);
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'sandpiles-excitable-studies', name: 'Avalanche Seal and Excitable Slate', seed: 43,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'sandpile';
    if (!['sandpile', 'waves'].includes(study)) throw new RangeError('Choose sandpile or waves');
    const setup = instrument(K, makeBuilder, makeSculpt, SpriteSurface, seed);
    return (study === 'sandpile' ? avalanche : waves)(K, SpriteSurface, setup);
  }
});
