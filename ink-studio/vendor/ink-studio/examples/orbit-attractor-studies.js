const frame = [0x131924, 0x202b3a, 0x2e4151, 0x425969, 0x63828a, 0x8ba5aa];
const brass = [0x3c2b34, 0x64413d, 0x956748, 0xbd905e, 0xe1bd85, 0xffe5a5];
const fire = [0x492841, 0x81394e, 0xb25250, 0xd77b52, 0xf1ac66, 0xffde98, 0xfff5ca];
const water = [0x22435b, 0x2c637e, 0x348f9c, 0x5db7b3, 0x8dd6c2, 0xc2e9d0];
const mint = [0x142825, 0x1f463f, 0x306452, 0x478767, 0x6bb388, 0xade1ab, 0xe3f1bc];
const orchid = [0x231b33, 0x382a4c, 0x564066, 0x805980, 0xb57595, 0xe89eac, 0xfde0bc];
const palette = [...frame, ...brass, ...fire, ...water, ...mint, ...orchid];
const cap = n => Math.min(1, Math.max(0, n));
const shade = (colors, value) => colors[Math.min(colors.length - 1, Math.floor(cap(value) * colors.length))];
const hex = rgb => '#' + rgb.toString(16).padStart(6, '0');
const screen = 0x131e2b;
const panels = [
  { family: 'lorenz', title: 'LORENZ', caption: 'XZ / FLOW SPEED', ramp: fire, axis: 2, steps: 2750 },
  { family: 'rossler', title: 'ROSSLER', caption: 'XY / FLOW SPEED', ramp: water, axis: 1, steps: 3250 },
  { family: 'clifford', title: 'CLIFFORD', caption: 'XY / VISIT DENSITY', ramp: mint, axis: 1, steps: 240000 },
  { family: 'deJong', title: 'DE JONG', caption: 'XY / VISIT DENSITY', ramp: orchid, axis: 1, steps: 280000 }
];

function label(font, sprite, x, y, z, message, width, ink) {
  const glyphs = [...message].map(char => font.get(char)), px = message.length * 6 + 4;
  sprite.face([x - width / 2, y, z], [width, 0, 0], [0, width * 10 / px, 0], px, 10, (u, v) => {
    const i = u - 2, j = v - 1;
    if (i >= 0 && j >= 0 && j < 7 && glyphs[Math.floor(i / 6)]?.[j * 6 + i % 6]) return ink;
  });
}

function plot(K, style, w, h) {
  const orbit = K.procedural.attractors.trace({ family: style.family, steps: style.steps });
  const { min, max } = orbit.bounds, axis = style.axis, cx = (min[0] + max[0]) / 2, cy = (min[axis] + max[axis]) / 2,
    scale = Math.min((w - 38) / (max[0] - min[0]), (h - 33) / (max[axis] - min[axis]));
  const ground = (x, y) => x === w / 2 || y === h / 2 ? 0x2a3a49 :
    (x - w / 2) % 23 === 0 && (y - h / 2) % 23 === 0 ? 0x425969 : screen;
  if (orbit.kind === 'map') {
    const grid = orbit.density({ resolution: [w, h], exposure: .53,
      bounds: { min: [cx - w / (2 * scale), cy - h / (2 * scale)], max: [cx + w / (2 * scale), cy + h / (2 * scale)] }
    });
    return (x, y) => {
      const { density } = grid.bin(x, h - y - 1);
      return density ? shade(style.ramp, .18 + .87 * density ** .72) : ground(x, y);
    };
  }
  const projected = orbit.points.map(p => [w / 2 + (p[0] - cx) * scale, h / 2 - (p[axis] - cy) * scale]);
  const reference = orbit.speeds.slice().sort((a, b) => a - b)[Math.floor(orbit.speeds.length * .93)];
  const draw = projected.slice(1).map((p, i) => {
    const t = cap((orbit.speeds[i] + orbit.speeds[i + 1]) / (2 * reference));
    return { type: 'path', points: [projected[i], p], width: .67 + t * .46, color: hex(shade(style.ramp, .14 + .86 * t ** .8)) };
  });
  const settings = K.frameComposite.prepare({ layers: [{ draw }] }, w, h);
  const ink = K.frameComposite.layers(settings, {}, 0)[0].data;
  return (x, y) => {
    const i = 4 * (x + w * y), a = ink[i + 3] / 255, color = ground(x, y);
    if (!a) return color;
    let out = 0;
    for (let j = 0; j < 3; j++) {
      const shift = (2 - j) * 8, bg = color >> shift & 255;
      out |= Math.min(255, Math.round(ink[i + j] + (1 - a) * bg)) << shift;
    }
    return out;
  };
}

function atlas(K, B, S, sprite, font) {
  const metal = { r: [0, 1, 2, 3, 4] }, trim = { r: [6, 7, 8, 9] };
  const box = (at, half, mat, res = .1, rd = .045) => S.box(at, half, mat, { res, rd });
  box([0, 3.68, -.35], [4.89, 3.62, .26], metal, .13, .13);
  box([0, 6.95, -.07], [4.65, .237, .15], metal);
  label(font, sprite, 0, 6.852, .15, 'ATTRACTOR ATLAS', 3.38, 0xffe5a5);
  for (const [i, style] of panels.entries()) {
    const x = i % 2 ? 2.33 : -2.33, bottom = i < 2 ? 3.76 : .43;
    const size = [4.25, 2.72], [w, h] = size;
    box([x, bottom + h / 2, -.095], [w / 2 + .087, h / 2 + .075, .157], trim, .085);
    sprite.face([x - w / 2, bottom, .12], [w, 0, 0], [0, h, 0], 424, 272, plot(K, style, 424, 272));
    const screws = { r: [7, 8, 9, 10, 11] };
    for (const side of [-1, 1]) S.ball([x + side * 2.07, bottom - .18, .087], .033, screws, { res: .036 });
    label(font, sprite, x - 1.04, bottom - .35, .121, style.title, style.title.length * .157 + .14, 0xffe5a5);
    label(font, sprite, x + .91, bottom - .33, .121, style.caption, style.caption.length * .102, style.ramp.at(-2));
  }
  S.bake();
  return B.finish({ spriteSurfaces: sprite.finish(),
    cam: { target: [0, 3.68, -.03], yaw: -.016, pitch: .022, dist: 13.75, fov: .59 },
    detail: 24, radius: 6.4, dither: .08, look: { pixelSize: 1, splatCoverage: 'continuous' }
  });
}

function current(K, B, S, sprite, font) {
  const { trace } = K.procedural.attractors;
  const orbit = trace({ family: 'lorenz', steps: 1100,
    pose: { scale: [.118, .047, .118], rotation: [-Math.PI / 2, 0, 0], position: [0, -.28, 0] }
  });
  const tube = orbit.path({ maxPoints: 255 }), metal = { r: [0, 1, 2, 3, 4] },
    trim = { r: [6, 7, 8, 9, 10] }, signal = { r: [19, 20, 21, 22], em: true };
  const box = (p, h, mat, res = .10, rd = .055) => S.box(p, h, mat, { res, rd });
  box([0, .02, 0], [2.91, .25, 1.63], metal, .115, .12);
  box([0, .275, 0], [2.72, .086, 1.48], trim, .094);
  box([0, .36, 0], [2.54, .048, 1.36], metal, .090);
  for (const side of [-1, 1]) {
    const x = side * 2.48;
    box([x, .51, -.63], [.21, .16, .26], trim, .073);
    S.tube([[x, .62, -.65], [x, 4.22, -.65], [side * 2.19, 4.77, -.65]], .041, .041, metal, { res: .052 });
    for (let i = 0; i < 21; i++) {
      const y = .73 + i * .167;
      S.tube([[x, y, -.61], [x - side * (i % 5 === 0 ? .18 : .074), y, -.61]],
        .014, .014, i % 5 === 0 ? signal : trim, { res: .031 });
    }
  }
  box([0, .13, 1.59], [1.45, .125, .10], metal, .062, .028);
  label(font, sprite, 0, .128, 1.718, 'STRANGE CURRENT', 2.25, 0xffe5a5);
  label(font, sprite, 0, .042, 1.718, 'LORENZ / LIVE ORBIT', 1.78, 0x8dd6c2);
  S.tube(tube.points, .019, .019, { r: [0, 2, 3, 4, 5] }, { res: .029, objectId: 'lorenz-tube' });
  S.bake();

  const front = ([x, y, z], rise) => [x, y, z + rise];
  const guide = orbit.points.filter((_, i) => i % 3 === 0);
  for (const [i, point] of guide.entries()) {
    const next = guide[i + 1];
    if (!next) break;
    const delta = K.V.sub(next, point), speed = orbit.speeds[i * 3],
      gain = cap(speed / 18), color = shade(water, .14 + .65 * gain);
    B.stick(...front(K.V.lerp(point, next, .5), .033), K.V.norm(delta), K.V.len(delta) * .53,
      .012 + .005 * gain, B.P[palette.indexOf(color)], .34, { nd: true, em: true });
  }
  const period = 5, tau = Math.PI * 2,
    phase = time => (1 - Math.cos(tau * (time % period) / period)) * .5,
    flight = (time, shift = 0) => orbit.at(.86 + 8.45 * phase(time) + shift),
    field = orbit.density({ resolution: [65, 65, 27], exposure: .42 });
  const swarm = K.frameSplats(B, 174, (draw, _dt, time) => {
    for (let stream = 0; stream < 3; stream++) {
      const delay = stream * .48, hero = flight(time, delay), hot = cap(hero.speed / 19),
        primary = stream === 0 ? [1, .76, .38] : [.36, .85, .99],
        core = stream === 0 ? [1, .96, .73] : [.77, 1, .96];
      draw.point(front(hero.p, .083), { rgb: primary, width: .073 + .031 * hot, density: .51 });
      draw.point(front(hero.p, .083), { rgb: core, width: .030 + .015 * hot, density: 1.18 + .5 * hot });
      for (let j = 1; j <= 56; j++) {
        const lead = flight(time - j * .0032, delay), tail = flight(time - (j + .9) * .0032, delay),
          fade = (1 - j / 57) ** 1.32, speed = cap(lead.speed / 19), gather = field.sample(...lead.p);
        draw.streak(front(tail.p, .065), front(lead.p, .065), { rgb: j % 6 === 0 ? core : primary,
          width: .015 + .017 * fade + .009 * gather, density: fade * (.35 + 1.11 * speed) });
      }
    }
  });
  const volume = K.atmosphere.field({ field, density: 1.92, step: .055, color: '#487890',
    emissive: '#2c5a73', emissiveGain: .16, anisotropy: .12 });
  const world = B.finish({ spriteSurfaces: sprite.finish(), atmosphere: [volume],
    volumeQuality: { scale: 2, steps: 98, jitter: 'blue-noise' },
    volumeLighting: { ambient: .55, point: { color: '#ffc480', radius: .84, castsShadow: false,
      at: time => flight(time).p, intensity: time => 4.5 + 6 * cap(flight(time).speed / 19) } },
    cam: { target: [0, 2.39, 0], dist: 11.2, yaw: -.10, pitch: .12, fov: .58 },
    detail: 26, radius: 5.8, dither: .075, look: { pixelSize: 1, splatCoverage: 'continuous' }
  });
  K.stage(world).add(swarm);
  const surveying = orbit.path({ from: 1.35, to: 2.59, maxPoints: 45 }).points
    .map(([x, y, z]) => [x * .628 - .6, 2.92 + y * .39, 11.92 + z * .52]);
  K.cameraRig.bind(world, K.cameraRig.compile({
    rails: { survey: { points: surveying, curve: .5 } },
    shots: { live: { target: [0, 2.39, 0], rail: 'survey', fov: .58,
      progress: [{ time: 0, value: 0, ease: 'in-out-sine' }, { time: 2.5, value: 1, ease: 'in-out-sine' }, { time: 5, value: 0 }] } },
    duration: period
  }));
  return world;
}

module.exports = ({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) => ({
  id: 'orbit-attractor-studies',
  name: 'Attractor Atlas and Strange Current',
  seed: 37,
  build(seed, { controls } = {}) {
    const study = controls?.study ?? 'atlas';
    if (!['atlas', 'current'].includes(study)) throw new RangeError('Use atlas or current');
    const B = makeBuilder(seed, [...palette, screen]), S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .42, sky: .25, sunK: .67, sun: K.V.norm([-.49, .75, .62]) });
    const sprite = SpriteSurface.make(1024), font = K.inspection.font({});
    return study === 'atlas' ? atlas(K, B, S, sprite, font) : current(K, B, S, sprite, font);
  }
});
