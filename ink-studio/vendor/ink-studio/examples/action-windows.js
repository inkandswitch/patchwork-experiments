/* Render a calibration arm and a landing-powered workshop. */
const studio = require('..');
const { KIT: K, makeBuilder, makeSculpt } = studio.load();
const { actionWindows, runtime } = K.world;
const { V } = K;
const sensors = { left: [-.68, .8, .58], right: [.63, .8, .58] };

function calibrate() {
  const graph = K.anim.animationGraph.create({
    clips: { cycle: { dur: 1.2, tracks: {
      'probe.pos': [[0, [-1.65, .8, .58], 'linear'], [.32, [-1.65, .8, .58], 'linear'],
        [.7, [1.68, .8, .58], 'linear'], [1.2, [1.68, .8, .58]]]
    }, events: [{ name: 'prime', time: 0 }, { name: 'extend', time: .32 }, { name: 'retract', time: .7 }] } },
    layers: [{ id: 'arm', entry: 'cycle', states: [{ id: 'cycle', clip: 'cycle' }] }]
  });
  const clock = actionWindows.create({
    recipes: { calibrate: { phases: [
      { id: 'windup', until: 'extend', cue: 'amber' },
      { id: 'active', until: 'retract', onContact: [{ kind: 'sweep', emit: 'calibrated' }] },
      { id: 'recovery', duration: .4, flags: ['access'] }
    ] } },
    assign: { arm: { actions: ['calibrate'], markers: { prime: 'calibrate' }, receive: [
      { kind: 'inspect', during: { action: 'calibrate', phase: 'recovery' }, emit: 'service' }
    ] } }
  });
  let state = clock.initial(), previous = [-1.65, .8, .58];
  const hits = new Set(), panels = [];
  for (let i = 1; i <= 54; i++) {
    const time = i / 60, frame = graph.advance(time - state.time), pose = graph.pose().probe.pos;
    const result = clock.step(state, {
      to: time, commands: actionWindows.markers('arm', frame.events),
      sweeps: Object.entries(sensors).map(([target, point]) => ({ source: 'arm', target, kind: 'sweep',
        probe: { from: previous, to: pose, radius: .115 }, targetBody: { from: point, half: [.22, .22, .2] } })),
      contacts: i === 47 ? [{ source: 'tester', target: 'arm', kind: 'inspect' }] : []
    });
    state = result.state;
    previous = pose;
    for (const event of result.outcomes) if (event.signal === 'calibrated') {
      if (hits.has(event.target)) throw new Error('Calibration sensor received a duplicate outcome');
      hits.add(event.target);
    }
    if ([13, 38, 47].includes(i)) panels.push({
      kind: result.active.arm.phase, tip: pose, hits: [...hits], access: result.flags['arm.access'],
      serviced: result.outcomes.some(event => event.signal === 'service')
    });
  }
  if (panels[0].kind !== 'windup' || panels[1].hits.length !== 2 || !panels[2].serviced)
    throw new Error('The calibration demo missed a phase or target');
  return panels;
}

function landing() {
  const run = runtime.create({
    systems: {
      gravity: { kind: 'gravity', config: { frame: { kind: 'uniform', acceleration: [0, -14, 0] } } },
      rig: { kind: 'mechanics', config: {
        bodies: {
          base: { fixed: true, position: [0, -.10, 0], half: [2.05, .12, .95] },
          plate: { fixed: true, position: [-1, .58, 0], half: [.66, .11, .68] },
          slab: { fixed: true, position: [1, .58, 0], half: [.70, .11, .68] }
        },
        fractureOn: { slab: { parts: 3, omit: [1], minSpeed: 4, impactMass: 2 } }
      } },
      people: { kind: 'characters', config: {
        gravity: 'gravity/frame', clearance: 'rig/clearance', support: 'rig/ray', landingContacts: true,
        characters: {
          left: { position: [-1, 2.72, 0], tuning: { height: .92 } },
          right: { position: [1, 2.72, 0], tuning: { height: .92 } }
        }
      } },
      actions: { kind: 'action-windows', config: { assign: {
        plate: { receive: [{ kind: 'landing', minSpeed: 4, emit: 'press' }] },
        slab: { receive: [{ kind: 'landing', minSpeed: 4, emit: 'break', once: true }] }
      } } },
      lock: { kind: 'puzzle', config: {
        inputs: { press: 'event' }, nodes: { latched: { op: 'latch', set: 'press' } }, outputs: { open: 'latched' }
      } }
    },
    connections: [
      { from: 'people/landings', to: 'actions/contacts' },
      { from: 'actions/signal.press', to: 'lock/press' },
      { from: 'actions/signal.break', to: 'rig/fracture-contacts' }
    ]
  });
  run.advance(58);
  const q = run.query(), bodies = q.probe('rig/bodies').value, actors = q.probe('people/actors').value;
  const open = q.trace('lock/why').value.active;
  if (bodies.slab || !bodies['slab.0'] || !open) throw new Error('The landing demo missed a switch or fracture');
  return { kind: 'landing', bodies, actors, open };
}

function run() {
  return [...calibrate(), landing()];
}

const palette = [
  0x172030, 0x27374a, 0x38546a, 0x547488, 0x8da9ae,
  0x563e48, 0x8e5c4e, 0xc78c62, 0xf1b876, 0xffde94,
  0x254953, 0x387772, 0x60ad96, 0xa3dfb5, 0xe0f7c4,
  0x463c59, 0x73577e, 0xb17e9b, 0xe4acc0, 0xfff0af
];

function render(panel) {
  const B = makeBuilder(157, palette), S = K.sculpt(makeSculpt(B));
  const frame = { r: [1, 2, 3, 4] }, enamel = { r: [5, 6, 7, 8] }, brass = { r: [6, 7, 8, 9, 19] };
  const jade = { r: [10, 11, 12, 13, 14] }, signal = { r: [11, 12, 13, 14, 19] }, cloth = { r: [15, 16, 17, 18] };
  const box = (at, half, material = frame, res = .061, options = {}) => S.box(at, half, material, { res, ...options });
  const ball = (at, half, material, res = .035) => S.ball(at, half, material, { res });
  const tube = (path, width, material) => S.tube(path, width, width, material, { res: .045 });
  const base = () => {
    box([0, -.10, 0], [2.06, .13, .96]);
    for (let i = -5; i <= 5; i++) box([i * .347, .022, 0], [.171, .020, .92], enamel);
    for (const x of [-1.85, 1.85]) for (const z of [-.78, .78])
      box([x, -.26, z], [.13, .09, .13], frame);
  };
  base();
  if (panel.kind !== 'landing') {
    box([0, .21, -.58], [.42, .21, .30], frame);
    box([0, .47, -.58], [.31, .115, .27], enamel);
    ball([0, .64, -.58], [.19, .18, .19], brass);
    const elbow = V.mad([0, 1.02, -.27], V.sub(panel.tip, [0, .8, .58]), .40);
    tube([[0, .65, -.58], elbow, panel.tip], .093, frame);
    ball(elbow, [.123, .108, .125], brass);
    ball(panel.tip, [.155, .137, .145], panel.kind === 'windup' ? brass : signal);
    for (const [name, at] of Object.entries(sensors)) {
      box([at[0], .14, at[2]], [.27, .11, .28], frame);
      box([at[0], .43, at[2]], [.09, .29, .086]);
      box(at, [.235, .206, .21], panel.hits.includes(name) ? jade : enamel);
      ball(V.add(at, [0, .092, .217]), [.082, .082, .033], panel.hits.includes(name) ? signal : brass);
    }
    for (const x of [-1.76, 1.76]) box([x, .07, .57], [.032, .023, .31], brass);
    if (panel.kind === 'windup') {
      for (let i = 0; i < 13; i++) {
        const a = i * 2 * Math.PI / 13;
        ball([panel.tip[0] + .27 * Math.cos(a), .89 + .28 * Math.sin(a), panel.tip[2]],
          [.038, .038, .038], brass, .029);
      }
    } else if (panel.kind === 'active') {
      for (let i = 0; i < 16; i++) {
        const x = -1.58 + i * .16;
        if (x < panel.tip[0] - .17) ball([x, .80, .85], [.042, .032, .034], jade, .030);
      }
    } else if (panel.access) {
      box([0, .55, -.252], [.19, .125, .031], jade);
      for (let i = -1; i <= 1; i++) ball([i * .104, .58, -.207], [.04, .035, .025], signal, .028);
      box([.30, .52, -.262], [.073, .14, .030], brass);
      if (panel.serviced) {
        for (const [x, y] of [[0, 1.24], [-.11, 1.13], [.11, 1.13], [0, 1.02]])
          ball([x, y, -.30], [.031, .030, .029], signal, .026);
        tube([[.86, .32, -.04], [.66, .54, -.11], [.36, .54, -.19]], .035, cloth);
        ball([.87, .31, -.04], [.087, .073, .067], cloth);
      }
    }
  } else {
    for (const [id, body] of Object.entries(panel.bodies)) {
      if (id === 'base') continue;
      const material = id === 'plate' ? jade : enamel;
      box(body.position, body.half, material);
      for (const n of [-1, 1]) box(V.add(body.position, [n * body.half[0] * .67, body.half[1] + .01, 0]),
        [.034, .015, body.half[2] - .055], id === 'plate' ? signal : brass);
    }
    box([-.99, .19, -.74], [.13, .16, .096], frame);
    box([-.99, .40, -.74], [.093, .077, .081], panel.open ? signal : enamel);
    for (const actor of Object.values(panel.actors)) {
      const [x, y, z] = actor.position;
      ball([x, y + .07, z], [.17, .24, .15], cloth);
      ball([x, y + .32, z], [.131, .146, .129], brass);
      box([x, y + .43, z], [.142, .048, .13], jade, .037);
      for (const sign of [-1, 1]) {
        ball([x + sign * .173, y + .09, z + .05], [.095, .079, .072], jade);
        box([x + sign * .081, y - .28, z + .03], [.063, .129, .092], frame, .039);
      }
    }
  }
  S.bake();
  const scene = B.finish({ cam: { yaw: panel.kind === 'recovery' ? 1.08 : .3, pitch: .34, dist: 6.58,
    target: [0, .66, 0], ortho: true }, radius: 5, look: { pixelSize: 1 }, outline: { c: 1, edge: .047 } });
  return studio.render(scene, { w: 360, h: 244, px: 1, dither: 0 });
}

function capture(path, panels) {
  const { grid } = require('../cli/render.js'), png = require('../cli/png.js');
  const { font, chars, per } = K.ascii.atlas();
  const names = ['WINDUP CUE', 'SWEPT CONTACT WINDOW', 'RECOVERY ACCESS', 'LANDING SWITCH AND FLOOR'];
  const frames = panels.map(render);
  frames.forEach(({ rgb, w }, i) => [...names[i]].forEach((ch, j) => {
    const glyph = chars.indexOf(ch), u = glyph % per * 6, v = Math.floor(glyph / per) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) {
      if (font.data[(v + y) * font.w + u + x]) rgb.set([198, 214, 219], ((14 + y) * w + 13 + j * 7 + x) * 3);
    }
  }));
  const figure = grid(frames, 2);
  png.write(path, figure.w, figure.h, figure.rgb);
}

module.exports = run;
if (require.main === module) {
  const panels = run();
  if (process.argv[2]) capture(process.argv[2], panels);
  console.log(JSON.stringify(panels.map(({ kind, hits, serviced, open, bodies }) =>
    ({ kind, hits, serviced, open, ...(bodies && { fragments: Object.keys(bodies).filter(id => id.startsWith('slab.')) }) })), null, 2));
}
