const weights = require('./learned-harbor-mark.json');
const length = 23, period = 6.4, frames = 64;
const palette = [0x0e1725, 0x1e3046, 0x324d5d, 0x4d6e78, 0x80a49b,
  0x382a39, 0x60424a, 0x986859, 0xc8916a, 0xf3c487, 0xffe9ae,
  0x153443, 0x286671, 0x4b9292, 0x83b8aa, 0xcef0c8];
const frameMat = { r: [0, 1, 2, 3, 4] }, well = { r: [0, 0, 1, 11] }, brass = { r: [5, 6, 7, 8, 9] },
  lamp = { r: [11, 12, 13, 14, 15], em: true };
const clamp = n => Math.max(0, Math.min(1, n));
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * clamp(t));
const channels = ['red', 'green', 'blue', 'alpha', 'latent-1'];
const blank = [12, 23, 35];

function shop(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .39, sky: .20, sunK: .76, sun: K.V.norm([-.51, .76, .40]) });
  const box = (p, half, material, res = .08, rd = .064) => S.box(p, half, material, { res, rd });
  function label(text, x, y, z, width, color) {
    const cols = text.length * 6, letters = [...text].map(c => font.get(c));
    sprites.face([x - width / 2, y, z], [width, 0, 0], [0, width * 7 / cols, 0], cols, 7, (u, v) =>
      letters[Math.floor(u / 6)]?.[v * 6 + u % 6] ? color : undefined);
  }
  function display(x, y, width, height, z, pixels, rows = pixels) {
    const tile = sprites.reserve(pixels, rows);
    sprites.faceRegion([x - width / 2, y - height / 2, z], [width, 0, 0], [0, height, 0], tile);
    return tile;
  }
  function tray(x, y, width, z, size) {
    box([x, y, z - .158], [width / 2 + .087, width / 2 + .087, .137], brass, .079, .077);
    return display(x, y, width, width, z, length * size);
  }
  return { B, S, sprites, font, box, label, display, tray };
}

function raster(w, h, pixel) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    rgba.set(pixel(x, y), i);
    rgba[i + 3] = 255;
  }
  return { w, h, rgba };
}

function specimen(frame, scale, mode) {
  const [red, green, blue, alpha, latent] = frame.values, dark = [17, 32, 44];
  const rgb = [red, green, blue];
  return raster(length * scale, length * scale, (x, y) => {
    const col = Math.floor(x / scale), row = Math.floor(y / scale), i = row * length + col;
    const a = alpha[i], active = clamp((a - .18) / .62);
    const grid = (col + row) % 2 ? dark : blank;
    if (mode === 'alpha') return mix(grid, [165, 231, 210], Math.floor(clamp(a) * 12) / 12);
    if (mode === 'latent') return mix(grid, latent[i] > 0 ? [115, 224, 214] : [245, 142, 102], clamp(Math.abs(latent[i]) * .55));
    const pigment = rgb.map(plane => 255 * clamp(plane[i] / Math.max(.26, a)) ** .82);
    const base = mix(grid, pigment, active * .98);
    const rim = active > .14 && (x % scale === scale - 1 || y % scale === scale - 1);
    return rim ? mix(base, [21, 28, 38], .15 * active) : base;
  });
}

function displayText(font, text, width = 168, height = 10) {
  const shift = Math.floor((width - text.length * 6) / 2), letters = [...text].map(c => font.get(c));
  return raster(width, height, (x, y) => {
    const i = x - shift, j = y - 1;
    const on = i >= 0 && j >= 0 && j < 7 && letters[Math.floor(i / 6)]?.[j * 6 + i % 6];
    return on ? [232, 216, 157] : blank;
  });
}

function snap(sim) {
  const frame = sim.frame();
  return { tick: frame.tick, values: channels.map(name => frame.data(name)) };
}

function timeline(sim, end) {
  return Array.from({ length: frames }, (_, i) => {
    const tick = Math.floor(Math.min(1, i / 56) ** 1.28 * end);
    if (tick > sim.tick) sim.step(tick - sim.tick);
    return snap(sim);
  });
}

function finish(K, SpriteSurface, set, camera, update, drawTrace = () => {}) {
  const { B, S, sprites } = set;
  S.bake();
  const atlas = sprites.finish(), upload = (id, image) => SpriteSurface.update(atlas, id, image);
  let previous = -1;
  const light = K.frameSplats(B, 350, (draw, _dt, time) => {
    const phase = ((time % period) + period) % period, i = Math.min(frames - 1, Math.floor(phase * 10 + 1e-7));
    if (i !== previous) { update(upload, i); previous = i; }
    drawTrace(draw, i);
  });
  const world = B.finish({ spriteSurfaces: atlas, cam: camera, radius: 6.7, detail: 23, dither: .066,
    look: { pixelSize: 1, splatCoverage: 'continuous' } });
  const stage = K.stage(world);
  stage.add(light);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

function grow(K, SpriteSurface, set, rule) {
  const { S, box, label, display, tray, font } = set;
  const sim = K.cellular.learned.create({ model: rule, width: length, height: length, seed: 12 });
  sim.seedAt(11, 11);
  const readings = timeline(sim, 120);
  box([0, 2.77, -.45], [4.13, 2.58, .31], frameMat, .121, .211);
  box([0, 2.74, -.103], [3.93, 2.29, .17], well, .096, .173);
  box([0, 5.02, .027], [3.91, .182, .116], frameMat, .081, .077);
  label('HARBOR MARK', -1.14, 4.908, .190, 2.92, 0xffe9ae);
  label('SEED GROWTH', 2.29, 4.985, .192, 2.06, 0xcef0c8);
  const main = tray(-1.30, 2.64, 3.96, .283, 10);
  const alpha = tray(2.29, 3.56, 1.63, .281, 5), hidden = tray(2.29, 1.52, 1.63, .281, 5);
  label('OPACITY', 2.29, 2.498, .314, 1.12, 0xcef0c8);
  label('LATENT 1', 2.29, .435, .308, 1.13, 0xf3c487);
  box([-1.3, .391, .021], [1.82, .131, .127], well, .068, .054);
  const status = display(-1.30, .388, 3.44, .212, .221, 168, 10);
  for (const x of [-3.86, 3.78]) for (const y of [.492, 5.035]) S.ball([x, y, .153], .065, brass, { res: .041 });
  for (let i = 0; i < 5; i++) box([3.51, 1.22 + i * .65, .126], [.035, .122, .023], i % 2 ? lamp : frameMat, .042, .020);
  const update = (put, i) => {
    const current = readings[i];
    put(main, specimen(current, 10, 'pigment'));
    put(alpha, specimen(current, 5, 'alpha'));
    put(hidden, specimen(current, 5, 'latent'));
    put(status, displayText(font, 'TICK ' + String(current.tick).padStart(3, '0')));
  };
  const trace = (draw, i) => {
    if (i > 9) return;
    const a = clamp(1 - i / 10);
    draw.point([-1.30, 2.64, .329], { width: .024 + .043 * a, density: a, rgb: [1, .84, .50], depth: true, emissive: true });
  };
  return finish(K, SpriteSurface, set, { target: [-.17, 2.71, .01], dist: 10.85, fov: .57, yaw: -.172, pitch: .095, sway: 0 }, update, trace);
}

function repair(K, SpriteSurface, set, rule) {
  const { S, box, label, display, tray, font } = set, L = K.cellular.learned;
  const settings = { model: rule, width: length, height: length, seed: 12 };
  const baseline = L.create(settings);
  baseline.seedAt(11, 11);
  baseline.step(109);
  const mature = baseline.checkpoint(), cutAt = 10, resumeAt = 17;
  const wounds = [{ at: [13.3, 6.8], radius: 4.1 }, { at: [6.4, 13.2], radius: 4.0 }];
  const studies = wounds.map(wound => {
    const sim = L.create(settings);
    sim.restore(mature);
    return Array.from({ length: frames }, (_, i) => {
      if (i === cutAt) sim.erase(wound);
      if (i >= resumeAt) {
        const tick = mature.tick + Math.floor(Math.min(1, (i - resumeAt + 1) / 41) * 80);
        if (tick > sim.tick) sim.step(tick - sim.tick);
      }
      return snap(sim);
    });
  });
  box([0, 2.68, -.40], [4.40, 2.39, .34], frameMat, .122, .205);
  box([0, 2.68, -.074], [4.23, 2.20, .155], well, .096, .164);
  box([0, 4.82, .045], [4.16, .183, .123], frameMat, .088, .080);
  label('HARBOR MARK / REPAIR', -.46, 4.708, .209, 4.39, 0xffe9ae);
  const xs = [-2.054, 2.054], width = 3.41, y = 2.655, z = .286;
  const tiles = xs.map(x => tray(x, y, width, z, 10));
  const labels = xs.map((x, i) => {
    box([x, .474, .035], [1.68, .134, .144], well, .068, .052);
    label(i ? 'FLANK CUT' : 'CREST CUT', x, .636, .238, 1.34, i ? 0xcef0c8 : 0xf3c487);
    return display(x, .45, 2.97, .165, .225, 168, 10);
  });
  for (const x of [-4.08, 4.08]) for (const h of [.54, 4.80]) S.ball([x, h, .196], .065, brass, { res: .038 });
  for (let i = 0; i < 5; i++) box([0, 1.23 + .54 * i, .134], [.027, .09, .028], i % 2 ? frameMat : lamp, .044, .016);
  const update = (put, i) => {
    for (let view = 0; view < tiles.length; view++) {
      put(tiles[view], specimen(studies[view][i], 10, 'pigment'));
      const elapsed = studies[view][i].tick - mature.tick;
      const stage = i < cutAt ? 'BEFORE' : i < resumeAt ? 'CLEARED' : 'REPAIR +' + String(elapsed).padStart(2, '0');
      put(labels[view], displayText(font, stage));
    }
  };
  const trace = (draw, i) => {
    if (i < cutAt || i > 22) return;
    const opacity = clamp((22 - i) / 8);
    for (const [j, { at, radius }] of wounds.entries()) for (let s = 0; s < 28; s++) {
      if (s % 3 === 2) continue;
      const angle = s * Math.PI / 14;
      const px = xs[j] + ((at[0] + .5 + radius * Math.cos(angle)) / length - .5) * width;
      const py = y - ((at[1] + .5 + radius * Math.sin(angle)) / length - .5) * width;
      draw.point([px, py, z + .045], { width: .019, rgb: [1, .52, .33], density: .82 * opacity, depth: true, emissive: true });
    }
  };
  return finish(K, SpriteSurface, set, { target: [-.24, 2.61, .01], dist: 10.84, fov: .60, yaw: -.147, pitch: .097, sway: 0 }, update, trace);
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'learned-cellular-growth', name: 'Harbor Mark: Seed Growth and Repair', seed: 37,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'growth';
    if (!['growth', 'repair'].includes(study)) throw new RangeError('Choose growth or repair');
    const set = shop(K, makeBuilder, makeSculpt, SpriteSurface, seed), model = K.cellular.learned.compile(weights);
    return (study === 'growth' ? grow : repair)(K, SpriteSurface, set, model);
  }
});
