const period = 6.4, dt = .1;
const palette = [
  0x0d1622, 0x142334, 0x1d3043, 0x2b4558, 0x4f687c, 0x8ba6b4, 0xc8dce0,
  0x174742, 0x287d70, 0x4ab495, 0x7fd7ae, 0xceefc6, 0xffedba,
  0x302744, 0x4b3d66, 0x7e6da8, 0xaba0e2, 0xd2ccff,
  0x593541, 0x96504c, 0xcb785d, 0xf8ae70, 0xffd69a
];
const slate = [.11, .24, .31], mint = [.43, .88, .67], white = [1, .94, .73], iris = [.71, .63, .98], peach = [1, .67, .37];
const PLOT = [16, 11], REPLAY = [24, 17];
const clamp = n => Math.max(0, Math.min(1, n));

function discrete(K) {
  const grid = K.cellular.create({ width: PLOT[0], height: PLOT[1], states: 4, boundary: 'wrap',
    neighborhood: [[-1, 0]], rule: ({ neighbors }) => neighbors[0], initial({ x, y }) {
      const ridge = Math.abs(y - 5);
      if (x === 1 + ridge || x === 8 + ridge && ridge < 4) return 3;
      if (x === ridge || x === 7 + ridge && ridge < 5) return 2;
      return (y === 5 || y === 2 || y === 8) && (x === 2 || x === 12) ? 1 : 0;
    } });
  const retained = [];
  const cycle = K.loopAuthoring.detect({ maxTicks: 80, stateAt(tick) {
    if (tick) grid.step();
    const { cells } = grid.snapshot();
    retained.push(cells);
    return cells;
  } });
  if (!cycle.found) throw Error('Study needs an exact discrete repeat');
  return { frames: retained.slice(cycle.startTick, cycle.endTick), cycle };
}

function growth(K, seed) {
  const C = K.cellular.continuous, I = K.simulationInputs;
  const motion = C.kernel({ taps: [[-1, 0, 6], [-1, -1, 1.4], [-1, 1, 1], [0, 0, 1.1]] });
  const build = () => I.continuous(C.create({ width: REPLAY[0], height: REPLAY[1], dt, boundary: 'empty',
    channels: ['ink'], neighborhoods: { drift: { channel: 'ink', kernel: motion } },
    rule: ({ fields }) => ({ ink: clamp(fields.drift * .987) })
  }));
  const makePulse = (tick, x, y, value, radius) => ({ id: 'pigment-' + tick, tick, kind: 'inject',
    stroke: { points: [[x, y - 2, 0], [x, y, 0], [x - 1, y + 2, 0]], radius, falloff: 'smooth' }, value: { ink: value } });
  const run = I.create({ seed, build, marks: [
    makePulse(0, 3, 8, .9, 3.4), makePulse(13, 4, 5, .84, 3.7), makePulse(30, 4, 12, 1, 3.1),
    makePulse(47, 3, 7, .96, 3.7), makePulse(62, 4, 11, 1, 3.4), makePulse(75, 4, 6, .92, 3.7)
  ] });
  return K.loopAuthoring.fromCheckpoint(run.checkpoint(), {
    open: saved => I.open(saved, { build }), read: solver => solver.frame().data('ink'),
    blend: (a, b, f) => Float32Array.from(a, (value, i) => value + (b[i] - value) * f), periodTicks: 64, overlapTicks: 16
  });
}

module.exports = ({ KIT: K, makeBuilder, SpriteSurface }) => ({
  id: 'loop-authoring-studies', name: 'Loop Studies', seed: 41, duration: period,
  build(seed) {
    const { frames, cycle } = discrete(K), tape = growth(K, seed), V = K.V, TAU = K.TAU;
    const clock = K.loopAuthoring.phaseLock({ period, tracks: {
      cells: { period: frames.length * dt, turns: 4 },
      major: { period: 2.19, turns: 3, phase: .14 }, minor: { period: 3.15, turns: -2, phase: .08 }
    } });
    const B = makeBuilder(seed, palette), sprites = SpriteSurface.make(1024), font = K.inspection.font({});
    function label(text, x, y, scale, color) {
      const glyphs = [...text].map(c => font.get(c)), w = glyphs.length * 6;
      sprites.face([x, y, -.66], [w * scale, 0, 0], [0, 7 * scale, 0], w, 7,
        (i, j) => glyphs[Math.floor(i / 6)]?.[j * 6 + i % 6] ? color : null);
    }
    const cards = [
      ['EXACT CYCLE', cycle.periodTicks + ' TICKS', 0xafdfbe],
      ['PHASE LOCK', '3 TURNS / 2 REVERSE', 0xd2ccff],
      ['CHECKPOINT BLEND', tape.overlapTicks + '-TICK OVERLAP', 0xffd69a]
    ];
    label('LOOP STUDIES', -5.06, 3.46, .058, 0xffedba);
    for (const [n, [title, subtitle, color]] of cards.entries()) {
      const x = -5.15 + n * 3.49, y = .24;
      sprites.face([x, y, -.79], [3.31, 0, 0], [0, 2.94, 0], 136, 116, (i, j) => {
        if (!i || i === 135 || !j || j === 115) return 0x4f687c;
        if (j === 15 || j === 101) return 0x2b4558;
        return i % 7 === 0 && j % 7 === 0 ? 0x1d3043 : 0x142334;
      });
      label(title, x + .19, y + 2.62, Math.min(.035, 2.86 / (6 * title.length)), color);
      label(subtitle, x + .19, y + .14, .027, color);
    }

    const trail = K.frameSplats(B, 1220, (draw, _dt, t) => {
      const phase = clock.sample('cells', t).phase;
      const cells = frames[Math.min(frames.length - 1, Math.floor(phase * frames.length + 1e-9))];
      for (let i = 0; i < cells.length; i++) {
        const x = i % PLOT[0], y = Math.floor(i / PLOT[0]), value = cells[i] / 3;
        draw.point([-3.28 + (x - 7.5) * .169, 1.67 + (y - 5) * .163, .02],
          { width: .037 + .022 * value, rgb: V.lerp(slate, value > .85 ? white : mint, value),
            density: .38 + value * 1.55, depth: true });
      }

      const a = TAU * clock.sample('major', t).phase, b = TAU * clock.sample('minor', t).phase;
      const arm = (phase, r, angle) => [r * Math.cos(phase + angle), 1.67 + r * Math.sin(phase + angle), .07];
      for (const [r, step] of [[.88, 56], [.54, 40]]) for (let j = 0; j < step; j++) {
        const p = arm(TAU * j / step, r, 0);
        draw.point(p, { width: .019, rgb: iris, density: j % 5 === 0 ? .83 : .31, depth: true });
      }
      for (const [phase, r, color, dir] of [[a, .88, iris, 1], [b, .54, mint, -1]]) {
        for (let j = 0; j < 19; j++) {
          const fade = (1 - j / 19) ** 1.45;
          draw.point(arm(phase, r, -dir * j * .044), {
            width: .021 + .038 * fade, rgb: V.lerp(color, white, fade), density: 1.95 * fade, depth: true });
        }
      }
      const from = arm(a, .88, 0), to = arm(b, .54, 0);
      draw.streak(from, to, { width: .015, rgb: white, density: .85, depth: true });
      draw.point(V.lerp(from, to, .43), { width: .059, rgb: white, density: 1.58, depth: true });

      const field = tape.sample(t);
      for (let i = 0; i < field.length; i++) {
        const x = i % REPLAY[0], y = Math.floor(i / REPLAY[0]), value = Math.min(1, field[i] * 1.7) ** .8;
        const p = [3.28 + (x - 11.5) * .113, 1.67 + (y - 8) * .112, .02];
        draw.point(p, { width: .027 + value * .018, rgb: V.lerp(slate, peach, value), density: .35 + 1.95 * value, depth: true });
        if (value > .68) draw.point(p, { width: .056, rgb: white, density: .32 * value, depth: true });
      }
    });
    trail.post = (_dt, _t, stage) => {
      for (let i = trail.first; i < trail.first + trail.count; i++) {
        const o = 16 * i, data = stage.D;
        if (!data[o + 3] && (data[o] || data[o + 2])) {
          data[o] = data[o + 2] = 0;
          stage.touch(i);
        }
      }
    };
    const world = B.finish({ spriteSurfaces: sprites.finish(),
      cam: { target: [0, 1.94, 0], dist: 9.7, fov: .55, yaw: 0, pitch: 0, sway: 0 },
      detail: 28, radius: 8, dither: .029, look: { pixelSize: 1, splatCoverage: 'continuous' } });
    const stage = K.stage(world);
    stage.period = period;
    stage.stateful = false;
    stage.add(trail);
    stage.update(0, 0);
    return world;
  }
});
