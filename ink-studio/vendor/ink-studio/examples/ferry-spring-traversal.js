/* Walk on a moving deck, jump with its momentum, and bounce off a dock spring. */
const { KIT } = require('..').load();

function runExample() {
  const { characters, colliders } = KIT.world;
  const dt = 1 / 60, rotation = KIT.M.id(), velocity = [1.8, 0, 0];
  const controller = characters.create({ tuning: {
    height: .82, radius: .14, stepUp: .22, walkSpeed: 2, jumpSpeed: 3.9
  } });
  const ferry = { id: 'ferry', half: [1.05, .2, .8], rotation, velocity, position: [0, .15, 0] };
  const dock = { id: 'dock', half: [1.5, .25, 1.2], rotation, position: [4.3, -.25, 0] };
  const spring = { id: 'spring', half: [.55, .08, .7], rotation, position: [3.55, .08, 0] };
  const surfaceResponse = characters.surfaces({ bySupport: { spring: { launch: { speed: 5.2 } } } });
  let actor = controller.state({ position: [0, .76, 0], mode: 'ground', inventory: ['lantern'] });
  let liftOff, launch;
  let deckWalk = 0;
  for (let tick = 0; tick < 140; tick++) {
    const deck = { ...ferry, position: KIT.V.mad(ferry.position, velocity, tick * dt) };
    const solids = [deck, dock, spring];
    const world = {
      supports: (x, z, low, high) => solids.flatMap(body => colliders.columns(body, x, z, low, high)),
      clearance: (point, radius, exclude) => solids.reduce((d, body) =>
        body.id === exclude ? d : Math.min(d, colliders.distance(body, point)), Infinity),
      surfaceMotion: id => id === deck.id ? deck : null,
      surfaceResponse
    };
    const input = tick < 24 ? { move: [0, .5] } : tick < 39 ? {} : { move: [1, 0], jump: tick === 39 };
    const result = controller.step(actor, input, dt, world);
    actor = result.actor;
    if (tick === 38) {
      if (result.support?.support !== 'ferry') throw Error('Expected the traveler to stay on the deck');
      deckWalk = actor.position[2];
    }
    if (result.events.some(event => event.type === 'jump')) liftOff = actor.velocity;
    launch = result.events.find(event => event.type === 'surface-launch');
    if (launch) break;
  }
  if (!liftOff || !launch) throw Error('Expected a ferry jump and a spring landing');
  return { deckWalk, liftOff, spring: launch.support, impactSpeed: launch.impact,
    rebound: launch.velocity, inventory: actor.inventory };
}

module.exports = runExample;
if (require.main === module) console.log(JSON.stringify(runExample(), null, 2));
