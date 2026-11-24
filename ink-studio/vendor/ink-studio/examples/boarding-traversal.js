/* A cart takes a detour when its passenger cannot fit under a low beam. */
const { KIT } = require('..').load();

function runExample() {
  const run = KIT.world.runtime.create({
    id: 'cart-crossing',
    systems: {
      rig: { kind: 'mechanics', config: { bodies: {
        floor: { fixed: true, position: [0, -0.5, 10], half: [10, .5, 15] },
        beam: { fixed: true, position: [0, 2.32, 2], half: [1, .12, .035] }
      } } },
      routes: { kind: 'navigation', config: {
        bounds: { min: [-5, -1, -2], max: [5, 4, 23] }, support: 'rig/support', clearance: 'rig/clearance'
      } }
    }
  });
  const query = run.query();
  const world = KIT.world.boarding.fromQuery(query, { bodies: 'rig/bodies', support: 'rig/support' });
  const boarding = KIT.world.boarding.create({ carriers: {
    cart: {
      collider: { kind: 'box', half: [.55, .4, .8] },
      seats: { front: { at: [0, 1.2, 0], exits: [[1.25, -.4, 0], [-1.25, -.4, 0]] } }
    }
  } });
  const actor = { id: 'carpenter', radius: .2, height: 1.6, position: [1.25, .8, 0], inventory: ['chisel'] };
  const start = { position: [0, .4, 0], yaw: 0 }, end = { position: [0, .4, 18], yaw: 0 };
  const target = [1.25, .8, 20];
  const choice = boarding.plan({
    actor, to: target, walkSpeed: 1.25, walk: (from, to) => query.trace('routes/route', from, { to }).value,
    offers: [{ id: 'cart-detour', carrier: 'cart', seat: 'front',
      boardAt: actor.position, leaveAt: [1.25, .8, 18], rideSeconds: 6 }]
  }).choice;

  const boarded = boarding.board({ carrier: 'cart', seat: 'front', actor, pose: start, world });
  const direct = boarding.move({ carrier: 'cart', from: start, to: end, world });
  if (boarded.status !== 'boarded' || direct.status !== 'blocked') throw Error('Expected an occupied cart blocked by the beam');
  let pose = start;
  let passenger = { ...actor, ...boarded.pose };
  for (const to of [{ position: [-2, .4, 0] }, { position: [-2, .4, 18] }, end]) {
    const result = boarding.move({ carrier: 'cart', from: pose, to, world });
    if (result.status !== 'ready') throw Error('Expected the cart detour to be clear');
    pose = result.pose;
    passenger = { ...passenger, ...result.occupants[0].pose };
  }
  const exit = boarding.dismount({ rider: passenger.id, pose, world });
  if (exit.status !== 'dismounted') throw Error('Expected a supported landing beside the cart');
  passenger = { ...passenger, ...exit.pose };
  return { route: choice.type, obstacle: direct.obstacle.solid, affectedRider: direct.obstacle.rider,
    dismount: passenger.position, inventory: passenger.inventory };
}

module.exports = runExample;
if (require.main === module) console.log(JSON.stringify(runExample(), null, 2));
