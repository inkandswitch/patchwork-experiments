const W = 128, H = 64, duration = 6;
const palette = [0x0d1220, 0x182033, 0x29364a, 0x43586b, 0x68848f, 0x9bb8ba,
  0x39293d, 0x644247, 0x99665a, 0xd29872, 0xffc58e, 0xffe8b5,
  0x182f43, 0x26526a, 0x397d84, 0x61b0a6, 0xa5e0ce, 0xd8f9df,
  0x44345b, 0x6c5688, 0xa68abb, 0xf6d0ef];
const dark = [13, 22, 32], voidInk = [8, 13, 23], brass = { r: [6, 7, 8, 9, 10] },
  steel = { r: [0, 1, 2, 3, 4] }, insulator = { r: [0, 0, 1, 12] }, glass = { r: [13, 14, 15, 16], em: true };
const clamp = n => Math.max(0, Math.min(1, n));
const blend = (a, b, t) => a.map((n, i) => Math.round(n + (b[i] - n) * clamp(t)));
const color = rgb => [rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255];
const pastEdge = (x, y) => x < 3 || x > 124 || y < 3 || y > 60 ||
  Math.min(x - 3, 124 - x) + Math.min(y - 3, 60 - y) < 5;

function culture(x, y, patches) {
  let strength = 0;
  for (const [cx, cy, angle, radius, thickness, skew] of patches) {
    const dx = x - cx, dy = y - cy, u = dx * Math.cos(angle) + dy * Math.sin(angle),
      v = -dx * Math.sin(angle) + dy * Math.cos(angle), d = (Math.hypot(u * 1.06, v * .95) - radius) / thickness;
    const profile = .7 * (1 + skew * Math.cos(Math.atan2(v, u) + .5));
    strength = Math.max(strength, profile * Math.exp(-.5 * d * d));
  }
  return Math.min(1, strength);
}

function simulate(C, study) {
  const lenia = study === 'lenia';
  const base = lenia ? C.presets.lenia() : C.presets.smoothLife({ radius: 10 });
  const domains = lenia ? {
    channels: ['life', 'trail'], neighborhoods: {
      ...base.neighborhoods, spread: { channel: 'trail', kernel: C.kernel({ radius: 3, weight: (_x, _y, r) => (1 - r) ** 2 }) }
    },
    rule(context) {
      const { state, fields } = context;
      const { life } = base.rule({ ...context, fields: { potential: fields.potential - .00015 * fields.spread } });
      return { life, trail: .90 * state.trail + .048 * fields.spread + .20 * state.life };
    }
  } : {};
  const patches = lenia ? [[99, 39, -.45, 7, 1.4, .5], [30, 27, 2.6, 7, 1.4, .23]]
    : [[38, 43, -1.1, 7, 2.9, .78], [91, 27, 2.1, 6, 2.9, .78]];
  const sim = C.create({ ...base, ...domains, width: W, height: H, boundary: 'empty',
    mask: ({ x, y }) => Number(!pastEdge(x, y)), initial: { life: ({ x, y }) => culture(x, y, patches) } });
  const names = lenia ? ['potential', 'trail'] : ['inside', 'ring'];
  const frames = [], start = lenia ? 7 : 0, end = lenia ? 77 : 30, injection = lenia ? -1 : 11;
  if (start) sim.step(start);
  for (let tick = start; tick <= end; tick++) {
    if (tick === injection) sim.inject({ at: [72, 49], radius: 8.5, values: { life: .92 } });
    const frame = sim.frame();
    frames.push({ tick, life: frame.data('life'), maps: names.map(name => frame.data(name)) });
    if (tick < end) sim.step();
  }
  return { frames, injection };
}

function type(font, sprites, { text, x, y, z = .30, width, tint }) {
  const columns = text.length * 6, glyphs = [...text].map(c => font.get(c));
  sprites.face([x, y, z], [width, 0, 0], [0, width * 7 / columns, 0], columns, 7, (u, v) =>
    glyphs[Math.floor(u / 6)]?.[v * 6 + u % 6] ? tint : undefined);
}

function gridRaster(paint) {
  const w = W, h = H, rgba = new Uint8Array(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const rgb = paint(x, y, y * w + x);
    rgba.set(rgb, i);
    rgba[i + 3] = 255;
  }
  return { w, h, rgba };
}

function engraved(v, distance, band) {
  const phase = v / band, edge = Math.abs(phase - Math.round(phase));
  return v > .024 ? clamp(1 - edge / Math.min(.35, Math.max(.07, distance / band))) : 0;
}

function specimen(frame, lenia) {
  const [a, b] = frame.maps;
  const water = lenia ? [54, 119, 119] : [65, 103, 116], middle = lenia ? [192, 95, 66] : [135, 94, 176],
    bright = lenia ? [255, 224, 163] : [229, 248, 216];
  return gridRaster((x, y, i) => {
    if (pastEdge(x, y)) return voidInk;
    const value = frame.life[i], field = lenia ? a[i] : b[i], after = lenia ? b[i] : a[i];
    const other = i + (x < W - 1 ? 1 : 0), below = i + (y < H - 1 ? W : 0);
    const pressure = lenia ? a : b;
    const delta = Math.hypot(pressure[other] - field, pressure[below] - field);
    const etch = engraved(field, delta, lenia ? .05 : .11);
    const grid = x % 8 === 0 || y % 8 === 0 ? ((x + y) % 8 === 0 ? .095 : .032) : 0;
    const wash = blend(dark, water, .43 * after + .26 * field + .27 * etch + grid);
    const rim = blend(middle, bright, Math.floor(clamp(value) * 8) / 8);
    return blend(wash, rim, Math.sqrt(value) * .97);
  });
}

function diagnostic(data, tint, gain) {
  const rgb = color(tint);
  return gridRaster((x, y, i) => {
    if (pastEdge(x, y)) return voidInk;
    const v = clamp(data[i] * gain), contour = engraved(v, .1, .18);
    return blend(dark, rgb, .77 * v ** .6 + .14 * contour + ((x % 16 === 0 && y % 8 === 0) ? .10 : 0));
  });
}

function telemetry(font, message, accent) {
  const glyphs = [...message].map(c => font.get(c)), w = 130, h = 10, rgba = new Uint8Array(w * h * 4);
  const rgb = color(accent), x0 = Math.floor((w - glyphs.length * 6) / 2);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const k = x - x0, j = y - 1;
    rgba.set(k >= 0 && j >= 0 && j < 7 && glyphs[Math.floor(k / 6)]?.[j * 6 + k % 6] ? rgb : voidInk, i);
    rgba[i + 3] = 255;
  }
  return { w, h, rgba };
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'continuous-cellular-studies', name: 'Culture Chamber: Lenia and SmoothLife', seed: 26,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'lenia';
    if (!['lenia', 'smoothlife'].includes(study)) throw new RangeError('Choose lenia or smoothlife');
    const lenia = study === 'lenia', light = lenia ? 0xffe8b5 : 0xd8f9df;
    const { frames, injection } = simulate(K.cellular.continuous, study);
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
    const font = K.inspection.font({}), add = spec => type(font, sprites, spec);
    Object.assign(S, { pixel: true, amb: .37, sky: .19, sunK: .76, sun: K.V.norm([-.52, .77, .36]) });
    const box = (origin, extent, material, res = .086, rd = .063) => S.box(origin, extent, material, { res, rd });
    box([0, 2.47, -.44], [4.39, 2.24, .40], steel, .126, .237);
    box([0, 2.49, -.09], [4.22, 2.09, .16], insulator, .103, .146);
    box([0, 4.31, .071], [4.16, .292, .096], steel, .089, .097);
    box([0, .73, .07], [4.14, .253, .098], steel, .081, .086);
    const view = { x: -3.91, y: 1.13, w: 5.33, h: 2.665, z: .275 };
    function window({ x, y, w, h, z }, mat) {
      box([x + w / 2, y + h / 2, z - .158], [w / 2 + .074, h / 2 + .07, .130], mat, .080, .079);
      const tile = sprites.reserve(W, H);
      sprites.faceRegion([x, y, z], [w, 0, 0], [0, h, 0], tile);
      return tile;
    }
    const main = window(view, brass), right = { x: 1.85, w: 2.0, h: 1.0, z: .276 };
    const scopes = [window({ ...right, y: 2.75 }, steel), window({ ...right, y: 1.27 }, steel)];
    const badge = sprites.reserve(130, 10);
    sprites.faceRegion([1.79, .622, .25], [2.16, 0, 0], [0, .175, 0], badge);
    add({ text: lenia ? 'LENIA' : 'SMOOTHLIFE', x: -3.83, y: 4.135, width: lenia ? 1.54 : 3.06, tint: light });
    add({ text: lenia ? 'COUPLED CULTURE' : 'DISC / ANNULUS RULE', x: lenia ? .42 : .52,
      y: 4.207, width: lenia ? 3.23 : 3.29, tint: 0x9bb8ba });
    add({ text: 'ACTIVITY', x: -3.78, y: .677, width: 1.07, tint: light });
    add({ text: lenia ? 'POTENTIAL' : 'INNER DISC', x: 1.88, y: 2.476, width: 1.50, tint: 0xa5e0ce });
    add({ text: lenia ? 'PIGMENT TRAIL' : 'OUTER RING', x: 1.88, y: 1.033, width: 1.68, tint: lenia ? 0xffc58e : 0xf6d0ef });
    for (const x of [-4.10, 4.07]) for (const y of [.765, 4.322])
      S.ball([x, y, .233], .062, brass, { res: .041 });
    for (let i = 0; i < 15; i++) box([-2.36 + i * .17, .737, .189], [.049, .023, .018],
      i % 4 ? insulator : glass, .042, .013);
    for (const x of [-3.59, 3.59]) {
      box([x, .23, -.32], [.36, .185, .33], steel, .085, .087);
      box([x, .16, .036], [.25, .07, .028], brass, .063, .024);
    }
    S.bake();
    const atlas = sprites.finish();
    let previous = -1;
    const emit = K.frameSplats(B, 850, (draw, _dt, time) => {
      const t = ((time % duration) + duration) % duration, index = Math.min(frames.length - 1, Math.floor(t * frames.length / duration + 1e-7));
      const frame = frames[index];
      if (index !== previous) {
        SpriteSurface.update(atlas, main, specimen(frame, lenia));
        SpriteSurface.update(atlas, scopes[0], diagnostic(frame.maps[0], 0x80d0b6, lenia ? 3.3 : 1.25));
        SpriteSurface.update(atlas, scopes[1], diagnostic(frame.maps[1], lenia ? 0xe99973 : 0xbaa2e5, lenia ? 1.2 : 1.9));
        const stamp = frame.tick >= injection && frame.tick < injection + 4 && !lenia ? 'PULSE  ' : 'TICK   ';
        SpriteSurface.update(atlas, badge, telemetry(font, stamp + String(frame.tick).padStart(3, '0'), light));
        previous = index;
      }
      const secondary = frame.maps[1];
      for (let y = 0; y < H; y++) for (let x = (y + index % 3) % 3; x < W; x += 3) {
        const i = y * W + x, value = frame.life[i];
        if (value < .40 || (lenia ? secondary[i] < .12 : secondary[i] > .46)) continue;
        const hot = clamp(value * .78 + .22 * secondary[i]);
        draw.point([view.x + (x + .5) * view.w / W, view.y + (H - y - .5) * view.h / H, view.z + .017 + hot * .05],
          { width: .014 + .009 * hot, density: .29 * hot, rgb: lenia ? [1, .76, .42] : [.62, .91, .8],
            emissive: true, depth: true });
      }
    });
    const world = B.finish({ spriteSurfaces: atlas, detail: 23, radius: 6, dither: .064,
      look: { pixelSize: 1, splatCoverage: 'continuous' },
      cam: { target: [-.33, 2.37, -.04], dist: 10.44, fov: .55, pitch: .12, yaw: -.18, sway: 0 } });
    const stage = K.stage(world);
    stage.add(emit);
    stage.stateful = false;
    stage.update(0, 0);
    return world;
  }
});
