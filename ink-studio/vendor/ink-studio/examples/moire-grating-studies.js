const TAU = 2 * Math.PI, DURATION = 6.4, FPS = 10, FRAMES = Math.round(DURATION * FPS);
const swatches = [0x111a29, 0x233344, 0x415461, 0x688188, 0xa5b0a3,
  0x362936, 0x67454a, 0xa7755d, 0xd3a475, 0xf0cd92,
  0x06363d, 0x1f5e65, 0x309890, 0x91dbbb, 0xe1f2d5,
  0x29213c, 0xa63f36, 0xcc6550, 0xdb9171, 0xebd9b4];
const iron = { r: [0, 0, 1, 2] }, steel = { r: [1, 2, 3, 4] }, brass = { r: [5, 6, 7, 8, 9] };
const jade = { r: [10, 11, 12, 13] }, diode = { r: [11, 12, 13, 14], em: true };
const clamp = n => Math.max(0, Math.min(1, n));
const mix = (a, b, f) => a.map((value, i) => value + (b[i] - value) * clamp(f));

function studio(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, swatches), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .33, sky: .18, sunK: .82, sun: K.V.norm([-.58, .74, .40]) });
  const box = (p, half, mat, res = .084, rd = .067) => S.box(p, half, mat, { res, rd });
  function label(text, [x, y, z], span, vertical, color) {
    const columns = text.length * 6, height = 7 * span / columns, letters = [...text].map(c => font.get(c));
    sprites.face([x - span / 2, y, z], [span, 0, 0], vertical ? [0, height, 0] : [0, 0, -height], columns, 7,
      (u, v) => letters[Math.floor(u / 6)]?.[v * 6 + u % 6] ? color : undefined);
  }
  function texture(origin, [width, height], [columns, rows], vertical) {
    const region = sprites.reserve(columns, rows), footprint = [width / columns, height / rows];
    sprites.faceRegion(origin, [width, 0, 0], vertical ? [0, height, 0] : [0, 0, -height], region);
    const rgba = new Uint8Array(columns * rows * 4);
    return (write, paint) => {
      for (let y = 0, pixel = 0; y < rows; y++) for (let x = 0; x < columns; x++, pixel += 4) {
        const rgb = paint((x + .5) * footprint[0] - width / 2, height / 2 - (y + .5) * footprint[1], footprint);
        if (rgb) rgba.set(rgb, pixel);
        rgba[pixel + 3] = rgb ? 255 : 0;
      }
      write(region, { w: columns, h: rows, rgba });
    };
  }
  function finish(cam, draw) {
    S.bake();
    const atlas = sprites.finish(), write = (id, image) => SpriteSurface.update(atlas, id, image);
    const world = B.finish({ spriteSurfaces: atlas, cam, radius: 7, detail: 23, dither: .049,
      look: { pixelSize: 1, splatCoverage: 'continuous' } });
    let last = -1;
    const stage = K.stage(world);
    stage.add({ update(_dt, time) {
      const t = (time % DURATION + DURATION) % DURATION;
      const frame = Math.min(FRAMES - 1, Math.floor(t * FPS + 1e-7));
      if (frame === last) return;
      draw(write, TAU * frame / FRAMES);
      last = frame;
    } });
    stage.stateful = false;
    stage.update(0, 0);
    return world;
  }
  return { S, box, label, texture, finish };
}

function press(K, set) {
  const { box, label, texture, finish } = set, make = K.procedural.materials.gratings;
  const cyan = { kind: 'dot', frequency: [17.4, 17.0], angle: .09 };
  const vermilion = { kind: 'dot', frequency: [17.94, 17.7], angle: .136, spin: .037,
    rate: [.18, -.28], phase: [.12, .31] };
  const first = make({ layers: [cyan] }), second = make({ layers: [vermilion] });
  const composite = { layers: [cyan, vermilion], mode: 'product' };
  const overlap = make(composite), envelope = make(composite);
  const paper = [221, 201, 157], blue = [9, 91, 100], red = [182, 52, 40], over = [37, 23, 65];
  const title = 'REGISTRATION PRESS', titleInk = 0xffdaa1;
  box([0, -.03, .02], [4.35, .21, 2.63], steel, .128, .104);
  box([0, .201, .02], [4.25, .063, 2.53], iron, .095, .090);
  box([-.99, .298, -.27], [2.91, .040, 1.83], brass, .094, .086);
  const print = texture([-3.86, .412, 1.51], [5.74, 3.57], [244, 152], false);
  for (const x of [-3.82, 1.84]) for (const z of [-2.065, 1.513]) {
    box([x, .445, z], [.11, .065, .104], brass, .049, .049);
  }
  box([-.99, .321, 1.862], [1.39, .077, .176], iron);
  label(title, [-.99, .467, 2.019], 2.66, false, titleInk);
  const proofs = [
    { z: -1.526, name: 'CYAN', color: 0x99dfce },
    { z: -.286, name: 'VERMILION', color: 0xffaa80 },
    { z: .954, name: 'OVERPRINT', color: titleInk }
  ];
  for (const proof of proofs) {
    box([2.99, .306, proof.z], [1.035, .057, .54], brass, .071, .063);
    proof.paint = texture([2.01, .432, proof.z + .439], [1.96, .85], [92, 40], false);
    box([2.99, .400, proof.z + .455], [.70, .045, .098], iron, .050, .047);
    label(proof.name, [2.99, .493, proof.z + .574], 1.19, false, proof.color);
  }
  for (const x of [-3.9, 3.88]) {
    for (let j = 0; j < 10; j++) box([x + (x > 0 ? -.34 : .34) + (x > 0 ? -.075 : .075) * j, .334, 2.215],
      [.013, .025, j % 3 ? .032 : .056], j % 3 ? steel : brass, .028, .022);
  }
  function draw(write, clock) {
    const t = Math.sin(clock - .39), a = first.frame(t), b = second.frame(t);
    const ab = overlap.frame(t), low = envelope.frame(t);
    print(write, (x, y, footprint) => {
      const radius = Math.hypot((x + .04) / 2.58, (y + .03) / 1.5);
      const wear = .986 + .014 * Math.sin((x + y) * 36) * Math.sin(x * 36);
      const base = paper.map(n => n * wear);
      if (radius > 1.045) {
        const mark = Math.abs(x) > 2.58 && Math.abs(y) > 1.39 &&
          (Math.abs(Math.abs(x) - 2.71) < .015 || Math.abs(Math.abs(y) - 1.49) < .015);
        return mark ? [96, 82, 66] : base;
      }
      if (radius > 1.021 || radius > 1.004 && Math.abs(x) + Math.abs(y) > 1.76) return [76, 64, 58];
      const pixel = { footprint };
      const band = low.sample(x, y, { footprint: .069 });
      const av = a.sample(x, y, pixel), bv = b.sample(x, y, pixel), cross = ab.sample(x, y, pixel);
      const contour = clamp(.63 + .36 * Math.cos(6.1 * radius + 1.25 * x + .64 * Math.sin(2.6 * y)));
      const density = .74 + .26 * contour;
      const rgb = base.map((n, i) => n + density * ((blue[i] - n) * av + (red[i] - n) * bv + (over[i] - blue[i] - red[i] + n) * cross));
      return mix(rgb, over, clamp((band - .037) * 8.8) * (.64 + .27 * contour));
    });
    proofs.forEach(({ paint }, i) => paint(write, (x, y, footprint) => {
      const zoom = i < 2 ? .63 : 1.8;
      const px = zoom * x, py = zoom * y, options = { footprint: footprint.map(size => size * zoom) };
      if (i === 0) return mix(paper, blue, a.sample(px, py, options));
      if (i === 1) return mix(paper, red, b.sample(px, py, options));
      return mix(paper, over, .06 + 4.6 * ab.sample(px, py, options));
    }));
  }
  return finish({ target: [0, .25, .24], dist: 13.43, fov: .55, pitch: 1.06, yaw: -.13, sway: 0 }, draw);
}

function beacon(K, set) {
  const { S, box, label, texture, finish } = set, make = K.procedural.materials.gratings;
  const lens = make({ mode: 'product', layers: [
    { kind: 'polar', frequency: 22.8, spokes: 8, origin: [-.11, .032], sharpness: 2 },
    { kind: 'polar', frequency: 23.52, spokes: 5, origin: [.12, -.08], spin: .49, rate: .24, sharpness: 2 }
  ] });
  const comparison = make({ mode: 'product', layers: [
    { frequency: 58.1, angle: .03, phase: .22 },
    { frequency: 58.9, angle: .089, rate: 1.22 }
  ] });
  box([0, 2.72, -.20], [4.28, 2.65, .28], steel, .124, .119);
  box([0, 2.73, .11], [4.14, 2.52, .12], iron, .095, .097);
  for (const y of [.27, 5.19]) {
    box([0, y, .285], [4.16, .07, .123], steel, .076, .066);
    for (let j = 0; j < 16; j++) box([-3.85 + .511 * j, y, .429], [.031, .026, .013], j % 4 ? jade : diode, .038, .027);
  }
  const cx = -1.55, cy = 2.86, r = 2.02;
  const center = [cx, cy, .346], face = texture([cx - r, cy - r, .397], [2 * r, 2 * r], [194, 194], true);
  for (const [radius, depth, thickness, mat] of [[r + .055, .361, .153, brass], [r + .18, .379, .033, jade], [r + .048, .492, .035, jade]]) {
    S.tube(K.curve.circle([center[0], center[1], depth], radius, 116, [0, 0, 1]), thickness, thickness, mat, { res: .061 });
  }
  for (let i = 0; i < 24; i++) {
    const angle = TAU * i / 24;
    S.ball([cx + (r + .159) * Math.cos(angle), cy + (r + .159) * Math.sin(angle), .468],
      i % 6 ? .035 : .064, i % 6 ? steel : diode, { res: .042 });
  }
  label('INTERFERENCE BEACON', [cx, .418, .483], 2.67, true, 0xffdaa1);
  const readouts = [
    { y: 3.62, name: 'FILTERED', detail: 0, mat: jade, color: 0xa5efd6 },
    { y: 1.89, name: 'SHIMMER', detail: .67, mat: brass, color: 0xffcf92 }
  ];
  for (const d of readouts) {
    box([2.50, d.y, .303], [1.40, .626, .110], d.mat, .079, .071);
    d.paint = texture([1.20, d.y - .538, .488], [2.6, 1.076], [123, 51], true);
    label(d.name, [2.50, d.y - .843, .401], 1.31, true, d.color);
  }
  const dark = [5, 22, 36], teal = [8, 143, 150], mint = [175, 255, 216], rose = [197, 66, 131], amber = [255, 183, 92];
  function draw(write, clock) {
    const t = Math.sin(clock), polar = lens.frame(t), bands = comparison.frame(clock / TAU / 1.22);
    face(write, (x, y, footprint) => {
      const radial = Math.hypot(x, y);
      if (radial > r) return undefined;
      const value = polar.sample(x, y, { footprint: footprint.map(size => size * 1.24) });
      const intensity = clamp((value - .056) * 5.2);
      const angle = Math.atan2(y, x);
      const color = mix(teal, rose, .27 + .31 * Math.sin(angle * 2 + radial * 3.4));
      const highlight = mix(mint, amber, .35 + .32 * Math.sin(angle + radial * 4.5));
      const visible = mix(dark, color, .11 + .78 * Math.sqrt(intensity));
      return mix(visible, highlight, clamp((intensity - .36) * 1.65) + .21 * clamp((radial - (r - .10)) * 15));
    });
    for (const d of readouts) d.paint(write, (x, y, footprint) => {
      const value = bands.sample(x, y, { footprint, detail: d.detail });
      const lit = mix(teal, amber, .25 + .25 * Math.sin(2.7 * y + .44 * x));
      return mix(dark, lit, clamp((value - .085) * 2.73));
    });
  }
  return finish({ target: [-.02, 2.67, .05], dist: 12.63, fov: .53, pitch: .08, yaw: -.125, sway: 0 }, draw);
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'moire-grating-studies', name: 'Registration Press and Interference Beacon', seed: 53, duration: DURATION,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'press';
    if (!['press', 'beacon'].includes(study)) throw new RangeError('Choose press or beacon');
    const set = studio(K, makeBuilder, makeSculpt, SpriteSurface, seed);
    return (study === 'press' ? press : beacon)(K, set);
  }
});
