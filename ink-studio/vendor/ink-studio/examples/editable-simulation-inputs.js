const duration = 6.4, dt = .1, width = 41, height = 17;
const palette = [
  0x0d1923, 0x142533, 0x1b3440, 0x254550, 0x326271, 0x44868b,
  0x43a49b, 0x75c6ad, 0xafdfbe, 0xd9ebcb, 0xffecb6,
  0x352e3f, 0x57394a, 0x8e4f58, 0xc77564, 0xefaa76, 0xffcf91
];
const dim = [.14, .29, .33], teal = [.33, .84, .69], ivory = [1, .94, .70], copper = [.87, .43, .32];
const at = (x, y) => [-4.44 + (x + .5) * .216, .56 + (y + .5) * .153, 0];
const wall = y => [[19, y], [20, y]];
const pins = [[5, 7], [5, 8], [5, 9]];

function authoredMarks() {
  return [
    { id: 'sluice', kind: 'obstacle', tick: 0, cells: Array.from({ length: height }, (_, y) => wall(y)).flat() },
    { id: 'pinned-source', kind: 'pin', tick: 0, cells: pins, value: 1 },
    { id: 'brush', kind: 'brush', tick: 4, value: 1,
      stroke: { points: [at(9, 4), at(10, 7), at(12, 8), at(10, 10), at(9, 12)], radius: .13 } },
    { id: 'lift-gate', kind: 'obstacle', tick: 22, enabled: false,
      cells: Array.from({ length: 5 }, (_, y) => wall(y + 6)).flat() },
    { id: 'wake', kind: 'inject', tick: 26, mode: 'replace', value: 1, cells: [[23, 8], [24, 7], [24, 9]] },
    { id: 'echo', kind: 'inject', tick: 37, mode: 'replace', value: 1, cells: [[9, 8], [9, 9]] },
    { id: 'release-source', kind: 'pin', tick: 43, enabled: false, cells: pins }
  ];
}

module.exports = ({ KIT: K, makeBuilder, SpriteSurface }) => ({
  id: 'editable-simulation-inputs', name: 'Pulse at the Sluice', seed: 40, duration,
  build(seed, { simulationInputs } = {}) {
    const I = K.simulationInputs, D = K.cellular.domain, V = K.V;
    const domain = D.image({ width, height, origin: [-4.44, .56], spacing: [.216, .153], units: 'world' });
    const build = seed => I.domain(D.create({ domain, seed, dt, timeUnit: 's',
      initial: ({ cell, random }) => cell.address[0] < 3 && random() < .18 ? 1 : 0,
      rule: K.cellular.graph.rules.pulse({ refractory: 11 }) }));
    const run = simulationInputs?.channel ? I.open(simulationInputs.channel, { build }) :
      I.create({ seed, build, marks: authoredMarks() });
    const B = makeBuilder(seed, palette), sprites = SpriteSurface.make(1024), font = K.inspection.font({});
    function label(text, x, y, scale, color) {
      const glyphs = [...text].map(letter => font.get(letter)), w = glyphs.length * 6;
      sprites.face([x, y, -.59], [w * scale, 0, 0], [0, 7 * scale, 0], w, 7,
        (i, j) => glyphs[Math.floor(i / 6)]?.[j * 6 + i % 6] ? color : null);
    }
    sprites.face([-4.85, .01, -.71], [9.70, 0, 0], [0, 3.68, 0], 380, 148, (x, y) => {
      if (!x || x === 379 || !y || y === 147) return 0x44868b;
      if (y === 12 || y === 131) return 0x254550;
      return x % 8 === 0 && y % 8 === 0 ? 0x1b3440 : 0x142533;
    });
    label('PULSE AT THE SLUICE', -4.72, 3.89, .056, 0xffecb6);
    label('PINNED SOURCE / BRUSH', -4.63, .15, .026, 0xafdfbe);
    label('GATE / TIMED PULSE', 1.32, .15, .026, 0xffcf91);

    const cells = domain.cells;
    const particles = K.frameSplats(B, cells.length * 2 + 256, (draw, _delta, time) => {
      const t = time - duration * Math.floor(time / duration), frame = run.seekTime(t);
      for (const cell of cells) {
        const p = cell.position, state = frame.get(cell.id);
        if (frame.isBlocked(cell.id)) {
          draw.streak(V.add(p, [-.055, 0, .015]), V.add(p, [.055, 0, .015]), {
            width: .036, rgb: copper, density: 1.32, depth: true });
          continue;
        }
        const shine = state ? (1 - (state - 1) / 12) ** 2.4 : 0;
        const held = frame.isLocked(cell.id);
        draw.point(p, { width: .040 + .018 * shine, rgb: V.lerp(dim, state === 1 || held ? ivory : teal, shine),
          density: .32 + 1.45 * shine, depth: true });
        if (state === 1 || held) draw.point(p, { width: .084, rgb: held ? [1, .62, .36] : teal,
          density: held ? .76 : .47, depth: true });
      }
      for (const { kind, tick, stroke } of run.record().marks) {
        if (kind !== 'brush' || !stroke) continue;
        const fade = 1 - (frame.tick - tick) / 6;
        if (fade <= 0 || fade > 1) continue;
        for (let i = 1; i < stroke.points.length; i++) {
          const a = V.add(stroke.points[i - 1], [0, 0, .07]), b = V.add(stroke.points[i], [0, 0, .07]);
          draw.streak(a, b, { width: .011, rgb: ivory, density: fade * .88, depth: true });
        }
      }
    });
    particles.post = (_dt, _t, stage) => {
      for (let i = particles.first; i < particles.first + particles.count; i++) {
        const o = i * 16, data = stage.D;
        if (!data[o + 3] && (data[o] || data[o + 2])) {
          data[o] = data[o + 2] = 0;
          stage.touch(i);
        }
      }
    };
    const world = B.finish({ spriteSurfaces: sprites.finish(), simulationInputs: { channel: run },
      cam: { target: [0, 2.04, 0], dist: 11.4, fov: .52, yaw: 0, pitch: 0, sway: 0 },
      detail: 27, radius: 7, dither: .032, look: { pixelSize: 1, splatCoverage: 'continuous' } });
    const stage = K.stage(world);
    stage.stateful = false;
    stage.add(particles);
    stage.update(0, 0);
    return world;
  }
});
