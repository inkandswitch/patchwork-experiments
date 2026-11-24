/* Carry a crate through a portable portal. Pass a PNG path to capture three stages. */
const studio = require('..');
const { KIT, makeBuilder, makeSculpt } = studio.load();
const png = require('../cli/png.js');
const { V } = KIT;
const door = { origin: [0, 1.1, 0] };
const floor = { id: 'floor', position: [0, -.14, 2], half: [2.65, .14, 2.35] };
const bench = { id: 'bench', position: [-1.35, .4, 2.35], half: [.62, .4, .53] };
const yard = { solids: [floor] }, interior = { solids: [floor, bench] };
const item = 'oak-crate', workshop = 'workshop-1', socket = 'hand';
const palette = [0x141823, 0x2a3546, 0x455763, 0x809296, 0x36564d, 0x609577, 0xaacb9d,
  0x553d42, 0x99554b, 0xd58253, 0xf6b971, 0xffdd9a, 0x217b78, 0x46bdb1, 0xf2d9bf];

function picture(actor, crate, inside, held) {
  const B = makeBuilder(71, palette), S = KIT.sculpt(makeSculpt(B));
  const box = (at, half, r, res = .065) => S.box(at, half, { r }, { res });
  box(floor.position, floor.half, inside ? [0, 1, 2, 3] : [1, 4, 5, 6], .10);
  for (let z = .15; z < 4.2; z += .44) {
    box([0, .001, z], [2.55, .008, .014], inside ? [1, 2] : [4, 5], .052);
  }
  for (const x of [-1.11, 1.11]) {
    box([x, 1.17, 0], [.18, 1.17, .25], [1, 2, 3]);
    box([x, 1.14, .26], [.035, .96, .026], [12, 13, 13]);
    box([x, .13, 0], [.30, .10, .30], [0, 1, 2]);
  }
  box([0, 2.32, 0], [1.31, .15, .25], [1, 2, 3]);
  box([0, 2.19, .19], [.93, .025, .055], [12, 13]);
  if (inside) {
    box([-2.53, .63, 2.3], [.12, .63, 2.10], [1, 2, 3], .088);
    box([0, .23, 4.15], [2.48, .23, .12], [1, 2, 3], .088);
    box([bench.position[0], .74, bench.position[2]], [.62, .06, .53], [7, 8, 9, 10], .062);
    for (const x of [-1.80, -.90]) for (const z of [1.99, 2.71])
      box([x, .34, z], [.08, .34, .08], [7, 8, 9]);
    box([-1.32, .58, 4.0], [.63, .05, .14], [7, 8, 9]);
    for (let i = 0; i < 5; i++)
      box([-1.72 + i * .19, .76 + i % 2 * .045, 4.0], [.04, .17 + i % 2 * .045, .035], [9, 10, 11], .034);
  } else {
    for (let i = 0; i < 14; i++) {
      const x = (i % 2 ? -1 : 1) * B.rr(1.65, 2.45), z = B.rr(.78, 3.9);
      S.ball([x, .10, z], [.16, B.rr(.11, .28), .15], { r: [4, 5, 6] }, { res: .071 });
    }
  }
  const [x, y, z] = actor.position;
  S.ball([x, y - .34, z], [.23, .35, .19], { r: [0, 1, 2, 12, 13] }, { res: .041 });
  for (const dx of [-.11, .11])
    box([x + dx, y - .88, z], [.073, .22, .085], [7, 1, 2], .047);
  S.ball([x, y + .068, z], [.157, .17, .15], { r: [7, 9, 14, 14] }, { res: .043 });
  box([x, y + .20, z], [.177, .045, .177], [0, 1, 12, 13], .041);
  if (held) {
    const shoulder = [x, y - .18, z], direction = V.norm(V.sub(crate.position, shoulder));
    const hand = V.mad(crate.position, direction, -.29);
    S.tube([V.mad(shoulder, direction, .16), hand], .075, .059, { r: [1, 12, 13] }, { res: .038 });
    S.ball(hand, [.067, .067, .067], { r: [9, 14, 14] }, { res: .034 });
  }
  box(crate.position, [.27, .27, .27], [7, 8, 9, 10, 11], .044);
  for (const dx of [-.17, .17])
    box(V.add(crate.position, [dx, .272, 0]), [.032, .017, .276], [7, 8, 10, 11], .031);
  for (const dz of [-.274, .274])
    box(V.add(crate.position, [0, 0, dz]), [.10, .032, .016], [11, 14], .026);
  S.bake();
  const W = B.finish({ cam: { target: inside ? [-.38, .80, 1.95] : [0, .85, 1.2],
    dist: inside ? 5.9 : 6.3, yaw: .63, pitch: .34 } });
  return studio.render(W, { w: 600, h: 480, px: 2 });
}

async function run({ capture } = {}) {
  const createRegistry = () => KIT.world.carry.create({ items: [
    { id: item, place: 'yard', pose: [.58, .27, 1.88], collider: { kind: 'box', half: [.27, .27, .27] },
      data: { contents: ['chisel', 'plane'] } }
  ] });
  const sessionFor = carry => KIT.world.portals.create({ carry,
    places: [{ id: 'yard', prepare: () => ({ carryWorld: yard }) }],
    templates: [{ id: 'workbench', anchors: { door }, prepare: () => ({ carryWorld: interior }) }]
  });
  const open = (session, x) => session.openEntrance({
    id: 'workshop-door', at: { origin: [x, 1.1, 0] }, to: { place: workshop, anchor: 'door' },
    returnTo: { position: [x, 1.1, .8], forward: [0, 0, -1] }, aperture: { halfWidth: .95, halfHeight: 1.1 }
  });
  const cross = (session, link, actor) => {
    const { origin, normal } = link.from.at;
    return session.cross(link.id, { previous: V.mad(origin, normal, .20),
      actor: { ...actor, position: V.mad(origin, normal, -.32) } });
  };
  function expect(result, status) {
    if (result?.status !== status) throw Error('Expected ' + status + ', received ' + JSON.stringify(result));
    return result;
  }
  let carry = createRegistry(), session = sessionFor(carry);
  session.registerInstance({ id: workshop, template: 'workbench', seed: 71 });
  await session.enter('yard');
  let actor = { id: 'maker', position: [0, 1.1, 1.5], forward: [0, 0, -1], sockets: { hand: [.52, -.10, -.64] } };
  const carried = expect(carry.pickup({ item, place: 'yard', actor, socket, world: yard }), 'held');
  if (capture) capture(picture(actor, carried.body, false, true));
  const arrival = await cross(session, open(session, 0), actor);
  if (!arrival) throw Error('Expected the carried crate to clear the portal');
  actor = { ...arrival.actor, position: [.24, 1.1, 1.52] };
  expect(carry.move({ place: workshop, from: arrival.actor, to: actor, world: interior }), 'ready');
  const hand = carry.poses(workshop, actor)[0], target = [-1.35, 1.07, 2.35];
  const placed = expect(carry.place({ item, place: workshop, actor, world: interior,
    pose: { position: target, rotation: hand.rotation },
    via: [{ position: V.add(hand.position, [0, .22, 0]), rotation: hand.rotation }] }), 'placed');
  if (capture) capture(picture(actor, placed.body, true));
  session.closeEntrance('workshop-door');
  await cross(session, session.linksFrom(workshop)[0], actor);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  session.dispose();

  carry = createRegistry();
  session = sessionFor(carry);
  await session.restore(saved);
  const again = await cross(session, open(session, 2.4), { ...actor, forward: [0, 0, -1] });
  if (!again) throw Error('Expected the reopened workshop to be accessible');
  actor = { ...again.actor, position: [.24, 1.1, 1.52] };
  const restored = carry.item(item), grip = carry.pickup({ item, place: workshop, actor, socket, world: interior,
    via: [{ position: V.add(restored.pose.position, [0, .22, 0]), rotation: restored.pose.rotation },
      { position: V.add(hand.position, [0, .29, 0]), rotation: restored.pose.rotation }] });
  expect(grip, 'held');
  if (capture) capture(picture(actor, grip.body, true, true));
  session.dispose();
  return { id: item, restoredAt: restored.pose.position, recoveredBy: grip.item.held.carrier, contents: grip.item.data.contents };
}

function writeStrip(file, frames) {
  const gap = 9, { w, h } = frames[0], width = frames.length * w + (frames.length - 1) * gap;
  const data = new Uint8Array(width * h * 3).fill(21);
  frames.forEach((frame, i) => {
    for (let y = 0; y < h; y++) data.set(frame.rgb.subarray(y * w * 3, (y + 1) * w * 3), (y * width + i * (w + gap)) * 3);
  });
  png.write(file, width, h, data);
}

module.exports = run;
if (require.main === module) {
  const output = process.argv[2], frames = [];
  run({ capture: output && (frame => frames.push(frame)) }).then(result => {
    if (output) writeStrip(output, frames);
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
