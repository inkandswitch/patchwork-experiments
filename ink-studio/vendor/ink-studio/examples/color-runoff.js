const studio = require('..');
const { write } = require('../cli/png.js');

const TAU = Math.PI * 2;
const WIDTH = 360;
const HEIGHT = 300;
const SEED = 23;
const PERIOD = 3;
const FRAME_OPTIONS = { w: WIDTH, h: HEIGHT, px: 1, lockCamera: true };
const CAMERA = { target: [.18, -.05, 0], dist: 7.3, pitch: .18, yaw: -.28, fov: .72 };
const COLORS = [0x000000, 0x090d18, 0x162034, 0x26334e, 0x415371, 0x687e9b, 0x9aacc3, 0xe1eef4];
const SPECTRUM = [
  [246, 35, 88], [255, 119, 30], [244, 227, 49], [96, 242, 65],
  [24, 217, 182], [34, 135, 248], [126, 63, 253], [245, 62, 187]
];
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function buildShell({ KIT: K, makeBuilder, makeSculpt }, seed) {
  const B = makeBuilder(seed, COLORS);
  const S = K.sculpt(makeSculpt(B));
  Object.assign(S, { amb: .21, sky: .19, sun: K.V.norm([-.58, .73, .45]) });
  const core = { r: [1, 2, 3, 4, 5], fat: .45 };
  const crystal = S.regular('d8', [0, 0, 0], .53, core, { hold: true });
  const stretch = ([x, y, z]) => [x * .88, y * 1.64 + .03, z * .88];
  S.warp(crystal, { map: {
    fwd: stretch,
    inv: ([x, y, z]) => [x / .88, (y - .03) / 1.64, z / .88],
    lip: 1.64
  } }, { res: .033 });
  S.bake();

  function trace(point, color, radius, steps) {
    for (let i = 0; i < steps; i++) {
      const u = i / (steps - 1);
      const p = point(u);
      const direction = K.V.norm(K.V.sub(point(Math.min(1, u + .004)), point(Math.max(0, u - .004))));
      B.stick(...p, direction, radius * 1.8, radius, B.P[color(u)], 2.6);
    }
  }

  function shell(u, azimuth) {
    const envelope = Math.pow(Math.sin(Math.PI * u), .77);
    const radius = envelope * (.82 + .45 * u) * (1 + .14 * Math.sin(azimuth * 3 + u * 3));
    const angle = azimuth + 1.35 * (u - .47);
    return [
      .19 * Math.sin(u * Math.PI * 1.9) + radius * Math.cos(angle),
      -1.82 + 3.88 * u,
      .82 * radius * Math.sin(angle)
    ];
  }

  for (let rib = 0; rib < 9; rib++) {
    const azimuth = rib * TAU / 9;
    const rail = u => shell(.019 + .955 * u, azimuth);
    trace(rail, u => 4 + Math.round((1 + Math.sin(azimuth + .95)) * 1.15 + .45 * Math.sin(u * 6)), .014, 230);
    if (rib % 2 === 0) {
      trace(u => shell(.12 + .74 * u, azimuth + .14), () => 4, .008, 145);
    }
  }

  for (const [index, height] of [.19, .32, .46, .59, .73, .86].entries()) {
    trace(t => {
      const angle = (t + index * .051) * (TAU - .65);
      return shell(height + .064 * Math.sin(angle - index * .55), angle);
    }, u => 4 + Math.floor(2.85 * Math.pow((1 + Math.cos(u * TAU - .4)) / 2, 2)), .012, 230);
  }

  for (const { c, n, r } of crystal.faces) {
    const center = stretch(c);
    const along = K.V.norm([n[2], 0, -n[0]]);
    for (let notch = 0; notch < 3; notch++) {
      const p = K.V.mad(center, along, (notch - 1) * r * .2);
      const q = K.V.mad(p, n, .014);
      B.stick(...q, [0, 1, 0], .024 + (notch === 1 ? .012 : 0), .0085, B.P[6], 2.8);
    }
  }

  return B.finish({ cam: CAMERA, radius: 4, detail: 45, dither: .055,
    look: { splatCoverage: 'continuous' } });
}

// Pick bright contour samples and their outward normals at the native art resolution.
function contourSamples(image, seed) {
  const { w, h, rgb } = image;
  const luma = Float32Array.from({ length: w * h }, (_, i) => {
    const offset = i * 3;
    return (.24 * rgb[offset] + .67 * rgb[offset + 1] + .09 * rgb[offset + 2]) / 255;
  });
  const contours = [];
  const cells = new Map();
  function random(index) {
    let value = Math.imul(index ^ seed, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const brightness = luma[i];
      if (brightness < .22) continue;
      const dx = luma[i - 1] - luma[i + 1];
      const dy = luma[i - w] - luma[i + w];
      const edge = Math.hypot(dx, dy);
      if (edge < .135) continue;
      const nx = dx / edge;
      const ny = dy / edge;
      const sample = { x, y, nx, ny, edge, brightness, key: random(i + 27), variant: random(i + 8129) };
      contours.push(sample);
      const open = luma[i + Math.round(nx * 2) + w * Math.round(ny * 2)];
      if (open > .17) continue;
      const cell = Math.floor(y / 13) * w + Math.floor(x / 13);
      const score = edge * .38 + sample.key * .56 + (1 - open) * .06;
      if (score > (cells.get(cell)?.score ?? 0)) cells.set(cell, { ...sample, score });
    }
  }
  return { contours, roots: [...cells.values()].filter(sample => sample.variant < .61) };
}

function makeRunoff(image, seed) {
  const { contours, roots } = contourSamples(image, seed);
  return ({ w, h, time }) => {
    const rgba = new Uint8Array(w * h * 4);
    const progress = time / PERIOD % 1;
    const phase = TAU * progress;
    const hueShift = progress * SPECTRUM.length * 2;
    function writePixel(x, y, hue, strength) {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      const alpha = strength > .92 ? 251 : strength > .65 ? 220 : strength > .4 ? 151 : strength > .22 ? 94 : 48;
      if (alpha < rgba[i + 3]) return;
      const color = SPECTRUM[((Math.floor(hue) % SPECTRUM.length) + SPECTRUM.length) % SPECTRUM.length];
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = alpha;
    }
    for (const { x, y, nx, ny, edge, brightness } of contours) {
      const wave = Math.sin(.063 * x + .09 * y - phase * 2) +
        .54 * Math.sin(.19 * y - .036 * x + phase);
      const hue = .09 * y + .034 * x - hueShift + 1.4 * wave;
      const offset = 1 + .78 * (1 + Math.sin(.045 * y - phase));
      writePixel(x + nx * offset + .58 * wave, y + ny * offset, hue, .51 + .45 * edge);
      if (brightness > .36 && wave > -.29) {
        writePixel(x + nx * (offset + 2.4) + wave, y + ny * (offset + 1), hue + 2.7, .28 + .31 * edge);
      }
    }

    for (const { x, y, nx, ny, key, variant } of roots) {
      const swing = phase + key * TAU;
      const fromCenter = x >= w * .46 ? 1 : -1;
      const polarity = variant < .27 ? -1 : 1;
      const launch = Math.atan2(ny, nx);
      const length = 13 + 40 * key ** 2.15 + 8 * Math.sin(swing);
      const strandCount = variant < .40 ? 2 : 1;
      for (let strand = 0; strand < strandCount; strand++) {
        const reach = length * (strand === 0 ? 1 : .79);
        const curl = polarity * (3.3 + 4.7 * variant);
        let px = x + nx;
        let py = y + ny;
        for (let distance = 0; distance < reach; distance += .61) {
          const u = distance / reach;
          const angle = launch + curl * u + .78 * Math.sin(swing + u * 5) * u + strand * .21;
          const drift = clamp(u * 3) * (.22 + .26 * key);
          px += .61 * (Math.cos(angle) + fromCenter * drift + .26 * key);
          py += .61 * (Math.sin(angle) + drift * 1.08);
          const pulse = Math.sin(distance * .43 - phase * 3 + key * TAU + strand * .7);
          const strength = (.64 + .34 * pulse) * (1 - .64 * u) * (strand ? .71 : 1);
          const hue = y * .095 + x * .034 + u * (3.7 + key * 5) - hueShift + strand * 1.7;
          if (u < .7 || pulse > -.04 + u * .44) writePixel(px, py, hue, strength);
          if (u < .4 && strand === 0 && key > .73 && pulse > .58) {
            writePixel(px - Math.sin(angle), py + Math.cos(angle), hue + 1, strength * .55);
          }
        }
      }
    }
    return { w, h, rgba };
  };
}

const descriptor = toolkit => ({
  id: 'color-runoff-study',
  name: 'Prism shell',
  seed: SEED,
  build(seed, { controls } = {}) {
    const world = buildShell(toolkit, seed);
    if (controls?.runoff === false) return world;
    // This study uses a fixed camera so the contour source stays registered with the scene.
    const plate = studio.render(world, FRAME_OPTIONS);
    world.look = {
      ...world.look,
      composite: {
        world: { resolution: [WIDTH, HEIGHT] },
        layers: [{ resolution: [WIDTH, HEIGHT], source: makeRunoff(plate, seed) }]
      }
    };
    return world;
  }
});

module.exports = descriptor;

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node examples/color-runoff.js <frame-directory>');
  fs.mkdirSync(directory, { recursive: true });
  const scene = descriptor(studio.load());
  const plain = scene.build(SEED, { controls: { runoff: false } });
  const world = scene.build(SEED);
  const base = studio.render(plain, FRAME_OPTIONS);
  write(path.join(directory, 'base.png'), base.w, base.h, base.rgb);
  for (let frame = 0; frame < 48; frame++) {
    const image = studio.render(world, { ...FRAME_OPTIONS, t: frame / 16 });
    write(path.join(directory, 'runoff-' + String(frame).padStart(3, '0') + '.png'), image.w, image.h, image.rgb);
  }
}
