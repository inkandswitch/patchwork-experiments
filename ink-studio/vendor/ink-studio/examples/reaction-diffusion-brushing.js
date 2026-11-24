const duration = 6, count = 60;
const palette = [0x101724, 0x202e3c, 0x35475a, 0x566b75, 0x839f9d,
  0x44303b, 0x76505a, 0xb68473, 0xd7ad82, 0xf4dbab,
  0x17313d, 0x275563, 0x3d7f85, 0x77b4a9, 0xb4ded0,
  0x292544, 0x504367, 0x765f82, 0xb597a0, 0xe5bcc3];
const steel = { r: [0, 1, 2, 3, 4] }, stone = { r: [0, 1, 2, 10] }, brass = { r: [5, 6, 7, 8, 9] }, teal = { r: [10, 11, 12, 13] };
const spectra = {
  garden: [[14, 33, 42], [38, 119, 116], [157, 206, 168], [255, 238, 172]],
  glaze: [[27, 29, 46], [110, 67, 98], [213, 151, 141], [255, 227, 177]],
  water: [[12, 33, 46], [27, 115, 123], [128, 205, 168], [245, 237, 185]]
};
const clamp = x => Math.max(0, Math.min(1, x));
const colorMix = (a, b, at) => a.map((value, i) => Math.max(0, Math.min(255, value + (b[i] - value) * at)));

function paint(frame, shades, tick, moving) {
  const w = frame.width * 2, h = frame.height * 2, rgba = new Uint8Array(w * h * 4);
  for (let y = 0, at = 0; y < h; y++) for (let x = 0; x < w; x++, at += 4) {
    const u = (x + .5) / w, v = (y + .5) / h;
    const c = frame.sample('v', u, v), feed = frame.sample('feed', u, v);
    const dx = Math.min(1, u + 1 / w), dy = Math.min(1, v + 1 / h);
    const gradient = c * 2 - frame.sample('v', dx, v) - frame.sample('v', u, dy);
    const etched = Math.abs(x % 16 - 8) === 0 && Math.abs(y % 16 - 8) === 0 ? .065 : 0;
    const d = clamp((c - .035) / .37), n = Math.floor(d * 24) / 24;
    const wave = moving ? .028 * Math.max(0, Math.cos(u * 25 - v * 22 + .17 * Math.sin(u * 27) - tick * .037)) ** 12 : 0;
    const base = colorMix(shades[0], shades[1], .09 + .7 * feed + etched + wave);
    const outline = clamp(.3 + gradient * 6) * Math.sin(Math.PI * d) ** 2;
    const pigment = colorMix(shades[1], shades[2], clamp(n * 1.6 + outline * .25));
    const t = clamp(n ** .78 + .17 * outline);
    const tint = colorMix(colorMix(base, pigment, t), shades[3], clamp((d - .54) * .92 + outline * .20));
    rgba.set(tint, at);
    rgba[at + 3] = 255;
  }
  return { w, h, rgba };
}

function label(font, sprites, text, origin, width, up, color) {
  const cols = text.length * 6, glyphs = [...text].map(c => font.get(c));
  sprites.face(origin, [width, 0, 0], up.map(value => value * width * 7 / cols), cols, 7, (u, v) =>
    glyphs[Math.floor(u / 6)]?.[v * 6 + u % 6] ? color : undefined);
}

function setup(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .39, sky: .23, sunK: .74, sun: K.V.norm([-.51, .75, .42]) });
  const box = (point, half, material, res = .091, rd = .058) => S.box(point, half, material, { res, rd });
  return { B, S, sprites, font, box };
}

function finish(K, SpriteSurface, { B, S, sprites }, views, frames, cam, light) {
  S.bake();
  const atlas = sprites.finish();
  let previous = -1;
  const move = K.frameSplats(B, 360, (draw, _dt, time) => {
    const at = ((time % duration) + duration) % duration;
    const i = Math.min(count - 1, Math.floor(at / duration * count + 1e-7)), frame = frames[i];
    if (i !== previous) {
      for (let j = 0; j < views.length; j++) {
        const { tile, colors, moving } = views[j];
        SpriteSurface.update(atlas, tile, paint(frame.fields[j], colors, frame.tick, moving));
      }
      previous = i;
    }
    light(draw, frame, i);
  });
  const world = B.finish({ spriteSurfaces: atlas, cam, detail: 24, radius: 6, dither: .062,
    look: { pixelSize: 1, splatCoverage: 'continuous' } });
  const stage = K.stage(world);
  stage.add(move);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

function glazeGarden(K, SpriteSurface, set) {
  const { S, sprites, font, box } = set, P = K.procedural, width = 56, height = 62;
  const seam = [0, 4.22, .60], rise = 3.53, down = [0, -rise, 0];
  const left = [-2.87, 4.22, -.10];
  const a = P.surface.plane({ id: 'upper-feed', origin: left, u: [2.87, 0, .70], v: down });
  const b = P.surface.plane({ id: 'lower-kill', origin: seam, u: [2.87, 0, -.70], v: down });
  const charts = [{ id: 'upper-feed', width, height, carrier: a }, { id: 'lower-kill', width, height, carrier: b }];
  const sim = P.growth.grayScott.create({ charts, seams: [{ a: ['upper-feed', 'u1'], b: ['lower-kill', 'u0'] }],
    feed: ({ chart, uv: [, v] }) => chart === 'upper-feed' ? .032 + .008 * v : .021 + .007 * v,
    kill: ({ chart, uv: [u] }) => chart === 'upper-feed' ? .058 + .005 * u : .051 + .007 * u });
  const dab = (at, radius) => sim.brush({ chart: 'upper-feed', at, radius, falloff: 'flat', values: { u: .47, v: .29 } });
  dab([.23, .68], 3.4); dab([.63, .24], 3.1);
  sim.step(180);
  const stampAt = tick => [.70 + .215 * tick / 44, .69 - .14 * tick / 44 + .022 * Math.sin(tick * .135)];
  const frames = [];
  for (let i = 0, age = 0; i < count; i++) {
    const goal = Math.round(i * 650 / (count - 1));
    while (age < goal) {
      sim.step(age < 44 ? 1 : goal - age);
      age = sim.tick - 180;
      if (age <= 44 && age % 4 === 0) {
        sim.brush({ chart: 'upper-feed', at: stampAt(age), radius: 3.2, falloff: 'flat',
          values: { u: .52, v: .27, feed: .036, kill: .060 } });
      }
    }
    frames.push({ tick: age, fields: charts.map(chart => sim.frame(chart.id)) });
  }
  const views = [a, b].map((chart, j) => {
    const bottom = chart.sample([0, 1]).p, far = chart.sample([1, 1]).p;
    const horizontal = K.V.sub(far, bottom), span = K.V.len(horizontal), axis = K.V.norm(horizontal);
    const center = chart.sample([.5, .5]).p;
    const normal = K.V.norm(K.V.cross(axis, [0, 1, 0]));
    S.box(K.V.mad(center, normal, -.157), [span / 2 + .106, rise / 2 + .136, .105], j ? brass : teal,
      { ax: [axis, [0, 1, 0], normal], res: .081, rd: .085 });
    const tile = sprites.reserve(width * 2, height * 2);
    sprites.faceRegion(bottom, horizontal, [0, rise, 0], tile);
    return { tile, colors: j ? spectra.glaze : spectra.garden };
  });
  box([0, .38, .07], [3.14, .255, .63], steel, .111, .128);
  box([0, .47, .62], [2.78, .147, .13], stone, .080, .058);
  box([0, 4.59, .04], [2.99, .263, .38], steel, .108, .119);
  box([0, 4.57, .411], [2.68, .187, .071], stone, .075, .054);
  label(font, sprites, 'SEAM GARDEN', [-1.49, 4.43, .508], 2.95, [0, 1, 0], 0xf4dbab);
  label(font, sprites, 'HIGHER FEED', [-2.33, .404, .786], 1.86, [0, 1, 0], 0xb4ded0);
  label(font, sprites, 'LOWER KILL', [.63, .404, .786], 1.66, [0, 1, 0], 0xe5bcc3);
  for (const x of [-2.83, 2.83]) for (const y of [.44, 4.57]) S.ball([x, y, y < 1 ? .73 : .421], .076, brass, { res: .042 });
  for (const y of [.85, 4.11]) S.ball([0, y, .624], [.078, .097, .044], brass, { res: .04 });
  const light = (draw, frame) => {
    if (frame.tick > 55) return;
    const p = a.sample(stampAt(Math.min(44, frame.tick))).p, alpha = clamp((57 - frame.tick) / 12);
    draw.point(K.V.add(p, [0, 0, .073]), { width: .035, rgb: [1, .94, .64], density: alpha, emissive: true, depth: true });
    for (let i = 0; i < 20; i++) {
      const angle = i * Math.PI / 10, q = a.sample(stampAt(Math.min(44, frame.tick)).map((u, j) =>
        u + (j ? Math.sin(angle) : Math.cos(angle)) * .048)).p;
      draw.point(K.V.add(q, [0, 0, .043]), { width: .015, rgb: [.69, .91, .83], density: alpha * .72, emissive: true, depth: true });
    }
  };
  return finish(K, SpriteSurface, set, views, frames,
    { target: [-.12, 2.49, .07], dist: 10.62, fov: .54, yaw: -.23, pitch: .12, sway: 0 }, light);
}

function shearFlume(K, SpriteSurface, set) {
  const { S, sprites, font, box } = set, P = K.procedural, width = 60, height = 50;
  const w = 3.48, h = 2.90, offsets = [-2.10, 2.10], waterY = .495;
  const still = P.surface.plane({ id: 'still', origin: [-w / 2, waterY, -h / 2], u: [w, 0, 0], v: [0, 0, h] });
  const water = P.motion.shallowWater({ width: 36, height: 30, cell: [w / 36, h / 30], origin: [-w / 2, -h / 2],
    terrain: (x, z) => .024 * Math.cos(x * 2.7 + z * 2.3), initial(x, z) {
      const swirl = Math.exp(-.75 * (x * x + z * z));
      return { depth: .23 - .025 * Math.cos(x * 2.7 + z * 2.3),
        velocity: [-.9 * z * swirl + .19 * Math.sin(z * 2.8), .9 * x * swirl + .13 * Math.cos(x * 1.8)] };
    }
  }).step(.28, { friction: .12 });
  const settings = { charts: [{ id: 'bed', width, height, carrier: still }], feed: ({ uv: [u] }) => .029 + .012 * u, kill: .059 };
  const reference = P.growth.grayScott.create(settings), current = P.growth.grayScott.create(settings);
  for (const [u, v, radius] of [[.30, .34, 4], [.55, .61, 4], [.70, .31, 3.2], [.37, .75, 3.1]])
    reference.brush({ chart: 'bed', at: [u, v], radius, falloff: 'flat', values: { u: .47, v: .31 } });
  reference.step(170);
  current.restore(reference.checkpoint());
  const velocity = ({ p }) => {
    const [x, z] = water.sample(p[0], p[2])?.velocity ?? [0, 0];
    return [.039 * x, 0, .039 * z];
  };
  const frames = Array.from({ length: count }, (_, i) => {
    const tick = Math.round(i * 233 / (count - 1)), steps = tick + 170 - reference.tick;
    if (steps) { reference.step(steps); current.step(steps, { flow: velocity }); }
    return { tick, fields: [reference.frame('bed'), current.frame('bed')] };
  });
  box([0, -.12, .035], [4.29, .24, 2.27], steel, .123, .152);
  const views = offsets.map((cx, i) => {
    box([cx, .19, 0], [1.91, .24, 1.64], i ? teal : stone, .092, .123);
    for (const side of [-1, 1]) {
      box([cx + side * 1.83, .444, 0], [.084, .084, 1.57], brass, .070, .05);
      box([cx, .444, side * 1.55], [1.85, .084, .088], brass, .070, .05);
      for (let j = 0; j < 6; j++) S.ball([cx - 1.64 + .655 * j, .53, side * 1.55], .025, teal, { res: .028 });
    }
    const tile = sprites.reserve(width * 2, height * 2);
    sprites.faceRegion([cx - w / 2, waterY, h / 2], [w, 0, 0], [0, 0, -h], tile);
    return { tile, colors: spectra.water, moving: Boolean(i) };
  });
  box([0, .178, -1.99], [3.14, .165, .19], stone, .092, .082);
  label(font, sprites, 'SHEAR FLUME', [-1.66, .423, -1.852], 3.28, [0, 0, -1], 0xf4dbab);
  for (const [i, cx] of offsets.entries()) {
    box([cx, .174, 1.94], [1.47, .121, .177], stone, .073, .073);
    label(font, sprites, i ? 'WATER CURRENT' : 'STILL CONTROL', [cx - 1.26, .378, 2.041], 2.47, [0, 0, -1], i ? 0xb4ded0 : 0xf4dbab);
  }
  const ports = [[-1.46, -.99], [-1.51, .57], [1.30, -.55], [1.18, .90]];
  for (const [x, z] of ports) S.ball([x + offsets[1], .49, z], [.033, .022, .033], brass, { res: .028 });
  const light = (draw, frame) => {
    for (const [x, z] of ports) {
      const hit = water.sample(x, z);
      const [dx, dz] = hit.velocity;
      for (let j = 0; j < 13; j++) {
        const rate = (j / 13 + (frame.tick / 68) % 1) % 1;
        draw.point([offsets[1] + x + dx * rate, waterY + .066 + Math.sin(rate * Math.PI) * .023, z + dz * rate],
          { width: .012 + .008 * rate, rgb: [.58, .92, .85], density: Math.sin(rate * Math.PI) * .55, emissive: true, depth: true });
      }
    }
  };
  return finish(K, SpriteSurface, set, views, frames,
    { target: [0, .17, .56], dist: 10.73, fov: .61, yaw: -.11, pitch: .91, sway: 0 }, light);
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'reaction-diffusion-brushing', name: 'Seam Garden and Shear Flume', seed: 31,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'seam';
    if (!['seam', 'water'].includes(study)) throw new RangeError('Choose seam or water');
    const set = setup(K, makeBuilder, makeSculpt, SpriteSurface, seed);
    return (study === 'seam' ? glazeGarden : shearFlume)(K, SpriteSurface, set);
  }
});
