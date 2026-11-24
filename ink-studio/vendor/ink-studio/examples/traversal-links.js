/* Four scenes driven by the same character traversal API. */
const studio = require('..');
const { KIT, makeBuilder, makeSculpt } = studio.load();
const { V } = KIT, { colliders, characters, traversalLinks } = KIT.world;
const dt = 1 / 60;
const controller = characters.create({ tuning: { height: .82, radius: .14, gravity: 6, airAcceleration: 1.2 } });
const board = { id: 'lower-landing', position: [.92, .40, 0], half: [.66, .27, .76] };
const platforms = {
  rail: [{ position: [-1.76, .22, .72], half: [.65, .23, .68] }],
  ring: [{ position: [-1.50, .13, 0], half: [.78, .17, .64] }, { position: [1.87, .27, 0], half: [.63, .32, .70] }],
  fan: [{ position: [0, .12, 0], half: [.82, .15, .78] }],
  lift: [board, { position: [1.12, 2.48, 0], half: [.86, .26, .72] }]
};
const world = blocks => {
  const solids = blocks.map((body, i) => ({ id: 'platform-' + i, rotation: KIT.M.id(), ...body }));
  return {
    supports: (x, z, low, high) => solids.flatMap(body => colliders.columns(body, x, z, low, high)),
    clearance: p => solids.reduce((d, body) => Math.min(d, colliders.distance(body, p)), Infinity)
  };
};
const rail = [[-1.80, 1.18, .62], [1.88, 1.18, .62]];
const branch = [[0, 1.18, .62], [.56, 1.34, .10], [1.48, 1.78, -.96]];
const ring = [-.43, 1.13, 0];
const liftPath = [[0, 1.08, 0], [0, 3.15, 0]];
const lift = KIT.anim.route(KIT.anim.path(liftPath), {
  mode: 'pingpong', speed: 1.65, acceleration: 3.4,
  stops: [{ at: 0, duration: .48 }, { at: 2.07, duration: .55 }]
});

function simulate(kind, links, position, velocity, time, duration, controls) {
  const net = traversalLinks.create({ controller, links }), env = world(platforms[kind]);
  let actor = net.state({ position, velocity, inventory: ['lantern'] });
  const samples = [position], events = [];
  for (let i = 0; i < Math.round(duration / dt); i++) {
    const at = time + i * dt;
    const out = net.step(actor, controls(i, actor), dt, env, { time: at });
    actor = out.actor;
    events.push(...out.events);
    if (i % 5 === 4 && V.dist(samples.at(-1), actor.position) > .075) samples.push(actor.position);
  }
  return { kind, actor, time: time + duration, samples, events };
}

function run() {
  const states = [
    simulate('rail', {
      main: { kind: 'route', path: rail, motion: { speed: 2.55 }, switches: [{ at: 1.8, link: 'branch', radius: .16 }] },
      branch: { kind: 'route', path: branch, motion: { speed: 2.45 }, exit: { boost: [0, 1.7, 0] } }
    }, rail[0], [0, 0, 0], 0, 1.14, i => ({ traverse: i < 2 ? 'main' : 'branch' })),
    simulate('ring', { boost: { kind: 'impulse', entry: { at: ring, radius: .53, normal: [1, 0, 0] },
      velocity: [5.6, 2.8, 0] } }, [-1.36, 1.30, 0], [4.1, 0, 0], 0, .48, () => ({})),
    simulate('fan', { updraft: { kind: 'flow', volume: { min: [-.5, .62, -.46], max: [.5, 2.75, .46] },
      acceleration: [0, 15.5, 0], speedLimit: 3.8 } }, [0, .76, 0], [0, 0, 0], 0, .63, () => ({})),
    simulate('lift', { elevator: { kind: 'scheduled', route: lift, exit: { offset: [1.0, 0, 0] } } },
      [.59, 1.08, 0], [0, 0, 0], 1.07, lift.period - 1.07 + 1.46, i => i === 0 ? { traverse: 'elevator' } : {})
  ];
  const expected = [['rail', 'switch'], ['ring', 'exit'], ['fan', 'enter'], ['lift', 'wait'], ['lift', 'enter']];
  for (const [kind, event] of expected) {
    if (!states.find(s => s.kind === kind).events.some(row => row.type === 'traversal-' + event))
      throw new Error('Missing ' + event + ' in the ' + kind + ' demo');
  }
  return states;
}

const palette = [
  0x171c30, 0x283044, 0x37485b, 0x516478, 0x83909a,
  0x4b3a48, 0x755452, 0xa07761, 0xcfa17c, 0xffd195,
  0x294957, 0x397a7b, 0x61aaaa, 0xa6ddc9, 0xd5f5da,
  0x4b3360, 0x80538b, 0xc584b7, 0xe7aed0, 0xffefbd
];

function picture(state) {
  const { kind, actor, samples, time } = state;
  const B = makeBuilder(7, palette), S = KIT.sculpt(makeSculpt(B));
  const basalt = { r: [1, 2, 3, 4] }, tile = { r: [5, 6, 7, 8] }, gold = { r: [6, 7, 8, 9, 19] };
  const aqua = { r: [10, 11, 12, 13, 14] }, violet = { r: [15, 16, 17, 18] };
  const box = (p, half, material = basalt, res = .066) => S.box(p, half, material, { res });
  const ball = (p, half, material, res = .038) => S.ball(p, half, material, { res });
  const tube = (points, radius, material) => S.tube(points, radius, radius * .9, material, { res: .045 });
  for (const { position: p, half: h } of platforms[kind]) {
    box(p, h);
    box(V.add(p, [0, h[1] - .035, 0]), [h[0] + .04, .038, h[2] + .04], tile);
    for (const x of [-h[0] + .13, h[0] - .13])
      box(V.add(p, [x, h[1] + .007, 0]), [.020, .015, h[2] - .04], gold);
  }

  if (kind === 'rail') {
    for (const [path, material] of [[rail, gold], [branch, aqua]]) {
      tube(path.map(p => V.add(p, [0, -.43, 0])), .059, material);
      for (const p of path) {
        box([p[0], (p[1] - .45) * .48 - .11, p[2]], [.080, (p[1] - .45) * .52 + .11, .080]);
        box([p[0], -.13, p[2]], [.24, .09, .20], tile);
      }
    }
    ball([0, .75, .62], [.125, .09, .125], gold);
  } else if (kind === 'ring') {
    const arms = Array.from({ length: 25 }, (_, i) => {
      const a = i * 2 * Math.PI / 24;
      return [ring[0], ring[1] + .64 * Math.cos(a), ring[2] + .64 * Math.sin(a)];
    });
    tube(arms, .072, gold);
    for (const p of arms.filter((_, i) => i % 4 === 1)) ball(p, [.087, .087, .087], aqua);
    for (const z of [-.43, .43]) {
      box([ring[0], .30, z], [.088, .42, .09], basalt);
      box([ring[0], -.10, z], [.18, .09, .17], tile);
    }
  } else if (kind === 'fan') {
    const disc = Array.from({ length: 25 }, (_, i) => {
      const a = i * 2 * Math.PI / 24;
      return [.57 * Math.cos(a), .38, .57 * Math.sin(a)];
    });
    tube(disc, .082, aqua);
    ball([0, .37, 0], [.19, .105, .19], gold);
    for (let blade = 0; blade < 5; blade++) {
      const a = blade * 2 * Math.PI / 5;
      tube([[.10 * Math.cos(a), .37, .10 * Math.sin(a)], [.46 * Math.cos(a + .25), .37, .46 * Math.sin(a + .25)]], .068, basalt);
    }
    for (let k = 0; k < 3; k++) {
      const stream = Array.from({ length: 9 }, (_, i) => {
        const a = k * 2.1 + i * .25;
        return [.51 * Math.cos(a), .60 + i * .245, .51 * Math.sin(a)];
      });
      for (const p of stream) ball(p, [.027, .052, .027], aqua, .027);
    }
  } else {
    const p = lift.vehicle(time).p, top = p[1] - .42;
    for (const z of [-.66, .66]) {
      box([-.58, 1.55, z], [.068, 1.66, .065], basalt);
      box([-.58, -.09, z], [.22, .12, .18], tile);
      box([-.52, 1.56, z], [.019, 1.57, .022], gold);
    }
    box([-.58, 3.18, 0], [.087, .078, .76], basalt);
    box([0, top - .09, 0], [.44, .093, .52], basalt);
    box([0, top, 0], [.465, .022, .53], gold);
    for (const z of [-.48, .48]) box([-.39, top + .24, z], [.046, .24, .042], aqua);
    box([-.39, top + .47, 0], [.042, .034, .51], aqua);
    box([.79, .95, -.58], [.055, .29, .055], basalt);
    ball([.79, 1.25, -.58], [.115, .105, .09], aqua);
  }

  for (const p of samples.slice(0, -1)) ball(p, [.037, .037, .037], kind === 'fan' ? violet : aqua, .030);
  const [x, y, z] = actor.position;
  ball([x, y + .046, z], [.159, .224, .135], aqua);
  ball([x + .012, y + .301, z + .010], [.127, .145, .115], gold);
  ball([x - .017, y + .401, z - .018], [.140, .066, .125], violet);
  for (const side of [-1, 1]) {
    const leg = kind === 'rail' || kind === 'ring' ? side * .112 : side * .072;
    box([x + leg, y - .222, z], [.057, .144, .071], basalt, .039);
    box([x + leg, y - .361, z + .05], [.064, .051, .106], gold, .037);
    ball([x + side * .182, y + .08 + (kind === 'fan' ? .09 : .01), z + side * .058],
      [.112, .065, .061], violet, .037);
  }
  tube([[x - .05, y + .19, z - .08], [x - .21, y + .24, z - .13], [x - .37, y + .19, z - .17]], .037, violet);
  S.bake();
  const cam = kind === 'lift' ? { target: [.21, 1.60, 0], dist: 6.38, yaw: .06, pitch: .22 } :
    { target: [0, kind === 'fan' ? 1.35 : 1.04, 0], dist: kind === 'fan' ? 5.55 : 7.0, yaw: .27, pitch: .28 };
  const scene = B.finish({ cam: { ...cam, ortho: true }, radius: 5,
    look: { pixelSize: 1 }, outline: { c: 1, edge: .046 } });
  return studio.render(scene, { w: 352, h: 256, px: 1, dither: 0 });
}

function capture(file, states) {
  const { grid } = require('../cli/render.js'), png = require('../cli/png.js');
  const { font, chars, per } = KIT.ascii.atlas();
  const labels = ['RAIL SWITCH', 'BOOST RING', 'FAN UPDRAFT', 'TIMED LIFT'];
  const images = states.map(picture);
  for (const [i, text] of labels.entries()) for (const [j, ch] of [...text].entries()) {
    const image = images[i], n = chars.indexOf(ch), u = n % per * 6, v = Math.floor(n / per) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) {
      if (font.data[(v + y) * font.w + u + x]) image.rgb.set([198, 214, 219], ((15 + y) * image.w + 15 + j * 7 + x) * 3);
    }
  }
  const mosaic = grid(images, 2);
  png.write(file, mosaic.w, mosaic.h, mosaic.rgb);
}

module.exports = run;
if (require.main === module) {
  const states = run();
  if (process.argv[2]) capture(process.argv[2], states);
  console.log(JSON.stringify(states.map(({ kind, actor, events }) => ({ kind, position: actor.position,
    events: events.filter(event => event.type.startsWith('traversal-')).map(({ type, time }) => ({ type, time })) })), null, 2));
}
