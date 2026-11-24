const PERIOD = 6.4, STEPS = 64, TAU = 2 * Math.PI;
const palette = [0x0c1624, 0x1d3040, 0x2d4857, 0x476873, 0x83a19b,
  0x3b2c38, 0x66434c, 0x956456, 0xc18a63, 0xe2b979, 0xffe1a7,
  0x153840, 0x247076, 0x4fa19b, 0xa5d8be,
  0x2d2949, 0x54476c, 0x886c8a, 0xdd9b99];
const steel = { r: [0, 1, 2, 3, 4] }, dark = { r: [0, 0, 1, 11] }, brass = { r: [5, 6, 7, 8, 9] },
  jade = { r: [11, 12, 13, 14] }, bulb = { r: [12, 13, 14], em: true };
const clamp = n => Math.max(0, Math.min(1, n));
const mix = (a, b, at) => a.map((n, i) => n + (b[i] - n) * clamp(at));
const periodTime = time => ((time % PERIOD) + PERIOD) % PERIOD;
const frequencies = [110, 165, 220, 275];
const voices = [.2, 1.61, 3.20, 4.80];

function soundtrack(time) {
  const position = TAU * periodTime(time) / PERIOD;
  return frequencies.reduce((sum, hz, i) => {
    const center = TAU * voices[i] / PERIOD, envelope = .012 + .179 * Math.exp(4.3 * (Math.cos(position - center) - 1));
    return sum + envelope * Math.cos(TAU * hz * time + .23 * i);
  }, 0);
}

function studio(K, makeBuilder, makeSculpt, SpriteSurface, seed) {
  const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B)), sprites = SpriteSurface.make(1024);
  const font = K.inspection.font({});
  Object.assign(S, { pixel: true, amb: .33, sky: .20, sunK: .78, sun: K.V.norm([-.52, .76, .35]) });
  const box = (p, half, mat, res = .086, rd = .060) => S.box(p, half, mat, { res, rd });
  function label(text, position, span, up, color) {
    const cols = text.length * 6, letters = [...text].map(c => font.get(c));
    sprites.face([position[0] - span / 2, position[1], position[2]], [span, 0, 0], up.map(v => v * span * 7 / cols), cols, 7,
      (u, v) => letters[Math.floor(u / 6)]?.[v * 6 + u % 6] ? color : undefined);
  }
  return { B, S, sprites, box, label, SpriteSurface };
}

function finish(K, set, camera, capacity, update) {
  const { B, S, sprites, SpriteSurface } = set;
  S.bake();
  const atlas = sprites.finish(), write = (id, image) => SpriteSurface.update(atlas, id, image);
  const system = K.frameSplats(B, capacity, (draw, _dt, time) => {
    const phase = periodTime(time), i = Math.min(STEPS - 1, Math.floor(phase * 10 + 1e-7));
    update(draw, write, i);
  });
  const world = B.finish({ spriteSurfaces: atlas, cam: camera, radius: 7, detail: 23, dither: .065,
    look: { pixelSize: 1, splatCoverage: 'continuous' } });
  const stage = K.stage(world);
  stage.add(system);
  stage.stateful = false;
  stage.update(0, 0);
  return world;
}

const toast = [223, 160, 103], blue = [57, 135, 146], indigo = [17, 29, 41];
function pigment(frame, size, disk) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i += 4) {
    const u = (x + .5) / size, v = (y + .5) / size;
    const p = disk ? [u * 2 - 1, v * 2 - 1] : [u, v], detail = frame.details(...p);
    if (!detail) continue;
    const value = detail.signed, ratio = disk ? 3.3 : 1.25;
    const scale = Math.floor(clamp(Math.abs(value) * ratio) * 8) / 8;
    const dust = !((x + y) % 13) ? .022 : 0;
    const rgb = mix(indigo, value < 0 ? blue : toast, .06 + .49 * scale + dust);
    rgba.set(rgb, i);
    rgba[i + 3] = 255;
  }
  return { w: size, h: size, rgba };
}

function track(plate, kind, random, amount) {
  const disk = kind === 'disk';
  const points = Array.from({ length: amount }, () => {
    if (!disk) return [.047 + .906 * random(), .047 + .906 * random()];
    const angle = TAU * random(), r = .965 * Math.sqrt(random());
    return [r * Math.cos(angle), r * Math.sin(angle)];
  });
  const frames = [];
  function drive(time) {
    const spin = TAU * time / PERIOD;
    if (disk) return { radial: .48 + .24 * Math.sin(spin), spokes: Math.cos(.83 * spin), turned: Math.sin(.83 * spin) };
    const angle = .78 + .54 * Math.sin(spin - 1.22);
    return { forward: Math.cos(angle), reverse: -Math.sin(angle), overtone: .20 + .18 * Math.sin(spin + .75) };
  }
  for (let i = 0; i < STEPS; i++) {
    const time = i / 10, gains = drive(time), nodal = plate.frame(0, { drive: gains });
    const settling = clamp((time - .30) / .53);
    for (let sub = 0; sub < 3 && settling; sub++) for (const point of points) {
      const move = nodal.towardNodes(point, { limit: disk ? .066 : .042 });
      if (!move) continue;
      point[0] += settling * (.49 * move[0] + (random() - .5) * .0029);
      point[1] += settling * (.49 * move[1] + (random() - .5) * .0029);
      if (disk) {
        const length = Math.hypot(...point);
        if (length > .962) { point[0] *= .962 / length; point[1] *= .962 / length; }
      } else for (let axis = 0; axis < 2; axis++) point[axis] = Math.max(.032, Math.min(.968, point[axis]));
    }
    const texture = plate.frame(time, { drive: gains });
    const lines = nodal.nodalLines({ cell: disk ? .039 : .019 });
    frames.push({ texture, lines, points: points.map(p => p.slice()) });
  }
  return frames;
}

function foundry(K, set) {
  const { B, S, sprites, box, label } = set, F = K.procedural.fields.spectral;
  const hz = 3 / PERIOD, size = 162, width = 3.54, y = .561;
  const square = F.membrane({ edge: 'free', modes: [
    { id: 'forward', m: 3, n: 5, frequency: hz }, { id: 'reverse', m: 5, n: 3, frequency: hz },
    { id: 'overtone', m: 2, n: 4, amplitude: .54, frequency: hz }
  ] });
  const disk = F.membrane({ shape: 'disk', modes: [
    { id: 'spokes', m: 3, n: 2, frequency: hz }, { id: 'turned', m: 3, n: 2, angle: Math.PI / 6, frequency: hz },
    { id: 'radial', m: 0, n: 3, amplitude: .38, frequency: hz }
  ] });
  const plates = [
    { cx: -2.12, disk: false, frames: track(square, 'square', K.grow.dice(56), 1370) },
    { cx: 2.10, disk: true, frames: track(disk, 'disk', K.grow.dice(68), 1150) }
  ];
  box([0, -.06, .09], [4.30, .23, 2.53], steel, .126, .180);
  box([0, .20, .06], [4.13, .084, 2.37], dark, .097, .131);
  box([0, .436, -2.19], [2.57, .103, .187], dark, .078, .098);
  label('NODAL FOUNDRY', [0, .606, -2.008], 3.14, [0, 0, -1], 0xffe1a7);
  for (const plate of plates) {
    const cx = plate.cx;
    if (plate.disk) {
      S.lathe([cx, .282, 0], .175, [1.78, 1.78], brass, { res: .096 });
      const rim = K.curve.circle([cx, .566, 0], 1.788, 76, [0, 1, 0]);
      S.tube(rim, .087, .087, brass, { res: .063 });
      S.tube(K.curve.circle([cx, .612, 0], 1.871, 78, [0, 1, 0]), .028, .028, jade, { res: .054 });
      for (let i = 0; i < 20; i++) {
        const angle = TAU * i / 20;
        S.ball([cx + 1.855 * Math.cos(angle), .646, 1.855 * Math.sin(angle)], .043,
          i % 5 ? jade : bulb, { res: .036 });
      }
    } else {
      box([cx, .373, 0], [1.93, .123, 1.94], brass, .095, .124);
      for (const side of [-1, 1]) {
        box([cx + side * 1.81, .561, 0], [.071, .068, 1.83], brass, .066, .053);
        box([cx, .562, side * 1.81], [1.83, .068, .071], brass, .066, .053);
        for (const other of [-1, 1]) S.ball([cx + side * 1.82, .652, other * 1.81], .055, jade, { res: .039 });
      }
    }
    box([cx, .303, 2.136], [1.58, .095, .163], dark, .081, .067);
    label(plate.disk ? 'FIXED DISK' : 'FREE SQUARE', [cx, .451, 2.283], 2.00, [0, 0, -1], plate.disk ? 0xa5d8be : 0xffe1a7);
    plate.tex = sprites.reserve(size, size);
    sprites.faceRegion([cx - width / 2, y, width / 2], [width, 0, 0], [0, 0, -width], plate.tex);
  }
  for (let i = 0; i < 7; i++) {
    const detail = B.n3(i * .71, 1, 2);
    box([-.012, .34, -1.78 + i * .59], [.045, .03 + .017 * detail, .062], i % 2 ? bulb : brass, .041, .022);
  }
  let previous = -1;
  const update = (draw, write, i) => {
    for (const plate of plates) {
      const frame = plate.frames[i], scale = plate.disk ? width / 2 : width, center = plate.disk ? 0 : .5;
      if (previous !== i) write(plate.tex, pigment(frame.texture, size, plate.disk));
      function point(p, lift) { return [plate.cx + (p[0] - center) * scale, y + lift, (p[1] - center) * scale]; }
      for (const path of frame.lines) for (let j = 1; j < path.points.length; j += 2)
        draw.point(point(path.points[j], .024), { width: .014, density: .35, rgb: [.33, .66, .68], emissive: true, depth: true });
      frame.points.forEach((p, j) => {
        const fraction = (j * 137 % 71) / 70;
        draw.point(point(p, .044 + .021 * fraction), { width: .011 + .016 * fraction,
          density: .50 + .44 * fraction, rgb: mix([.97, .64, .33], [1, .94, .67], fraction), emissive: true, depth: true });
      });
    }
    previous = i;
  };
  return finish(K, set, { target: [-.06, .25, .55], dist: 11.18, fov: .60, yaw: -.14, pitch: .95, sway: 0 }, 4700, update);
}

function hall(K, set) {
  const { S, box, label } = set, F = K.procedural.fields.spectral;
  const wave = F.fourier({ bounds: { min: [-3.68, .93], max: [3.68, 4.68] }, terms: [
    { id: 'low', cycles: [1.52, 1.28], kind: 'standing', frequency: 2 / PERIOD, spatialPhase: -.54 },
    { id: 'fifth', cycles: [2.15, -1.02], frequency: -2 / PERIOD, phase: .78 },
    { id: 'octave', cycles: [3.76, 1.45], frequency: 3 / PERIOD, spatialPhase: .81 },
    { id: 'upper', cycles: [4.30, -1.76], kind: 'standing', frequency: 4 / PERIOD, phase: 1.37 }
  ] });
  const hz = 4096, amount = 512;
  const readings = Array.from({ length: STEPS }, (_, i) => {
    const time = i / 10;
    const samples = Float64Array.from({ length: amount }, (_, j) => soundtrack(time + (j - (amount - 1) / 2) / hz));
    const spectrum = F.analyze(samples, { sampleRate: hz, frequencies });
    const ids = ['low', 'fifth', 'octave', 'upper'];
    const drive = Object.fromEntries(spectrum.map((bin, index) => [ids[index], .18 + 4.3 * bin.amplitude]));
    return { spectrum, wave: wave.frame(time, { drive }) };
  });
  box([0, .14, .00], [4.51, .220, 1.44], dark, .141, .168);
  box([0, .37, .03], [4.33, .090, 1.30], steel, .105, .121);
  box([0, .55, 1.282], [1.63, .162, .087], dark, .074, .074);
  label('HARMONIC PORTICO', [0, .47, 1.409], 3.05, [0, 1, 0], 0xffe1a7);
  const pillarXs = [-3.91, 3.91];
  const archY = x => 2.64 + 1.93 * Math.sqrt(Math.max(0, 1 - (x / 3.89) ** 2));
  for (const x of pillarXs) {
    box([x, .66, .030], [.38, .204, .430], brass, .090, .083);
    box([x, 1.70, .056], [.257, .949, .249], steel, .083, .064);
    box([x, 1.70, .336], [.132, .746, .052], jade, .070, .046);
    for (let j = 0; j < 9; j++) box([x, .99 + .151 * j, .404], [.103, .022, .018], j % 4 ? steel : bulb, .042, .016);
    box([x, 2.692, .061], [.379, .119, .399], brass, .078, .067);
  }
  for (const [yoff, z, r, material] of [[0, .081, .17, brass], [.23, -.113, .078, steel], [.12, .287, .042, jade]]) {
    const arc = Array.from({ length: 68 }, (_, i) => {
      const angle = Math.PI * i / 67;
      return [3.91 * Math.cos(angle), 2.64 + yoff + 1.93 * Math.sin(angle), z];
    });
    S.tube(arc, r, r, material, { res: .087 });
  }
  for (let k = 1; k < 25; k++) {
    const a = Math.PI * k / 25;
    S.ball([3.91 * Math.cos(a), 2.64 + 1.93 * Math.sin(a), .271], k % 3 ? .047 : .077, k % 3 ? jade : brass, { res: .046 });
  }
  const meters = [-2.99, -1.99, 1.99, 2.99];
  for (const [i, x] of meters.entries()) {
    box([x, .61, .976], [.426, .23, .12], dark, .070, .057);
    label(String(frequencies[i]), [x, .570, 1.165], .44, [0, 1, 0], 0xa5d8be);
  }
  const emit = (draw, _write, i) => {
    const state = readings[i];
    for (let j = 0; j < 71; j++) {
      const x = -3.60 + 7.20 * j / 70, stop = archY(x) - .17;
      for (let k = 0; k < 40; k++) {
        const y = .96 + .087 * k;
        if (y > stop) break;
        const { signed, magnitude, phase } = state.wave.details(x, y);
        const lobe = clamp(Math.abs(signed) * .91), glow = clamp(1 - Math.abs(signed) * 9) * clamp(magnitude * 1.7);
        const warm = .5 + .5 * Math.cos(phase - .36), tint = mix([.24, .76, .79], [.98, .55, .31], warm);
        const color = mix(tint, [1, .91, .64], .55 * glow);
        const depth = .069 + .45 * signed + .024 * Math.sin(j * .43 + k * .48);
        draw.point([x, y, depth], { width: .023 + .014 * glow + .008 * lobe,
          rgb: color, density: .40 + .46 * lobe + .13 * glow, emissive: true, depth: true });
      }
    }
    for (const [j, bin] of state.spectrum.entries()) for (let n = 0; n < 12; n++) {
      const range = clamp(bin.amplitude * 5.0) * 12;
      if (range < n) break;
      draw.point([meters[j] + .056 * (n - 5.5), .758, 1.172],
        { width: .027, density: clamp(range - n), rgb: j % 2 ? [.44, .94, .75] : [1, .74, .37], emissive: true, depth: true });
    }
  };
  return finish(K, set, { target: [-.16, 2.225, .02], dist: 11.25, fov: .59, yaw: -.20, pitch: .11, sway: 0 }, 4000, emit);
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'spectral-wave-studies', name: 'Nodal Foundry and Harmonic Portico', seed: 43,
  soundtrack, duration: PERIOD,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'foundry';
    if (!['foundry', 'portico'].includes(study)) throw new RangeError('Choose foundry or portico');
    const set = studio(K, makeBuilder, makeSculpt, SpriteSurface, seed);
    return (study === 'foundry' ? foundry : hall)(K, set);
  }
});
