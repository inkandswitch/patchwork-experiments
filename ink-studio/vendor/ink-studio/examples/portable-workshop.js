/* Open the same room at different entrances. The crate moves with its room, and the traveler returns to each opening site. */
const { KIT, makeBuilder, makeSculpt } = require('..').load();
const door = { origin: [0, 1.25, 0] };
const aperture = { halfWidth: 0.9, halfHeight: 1.2 };
const workshop = { id: 'carpenter-workshop', template: 'workshop', seed: 71 };

function buildWorkshop(instance, crate) {
  const builder = makeBuilder(instance.seed, [0x2d2924, 0x654630, 0xb68653, 0xa94d34]);
  const sculpt = KIT.sculpt(makeSculpt(builder));
  sculpt.box([0, -0.1, 1.5], [2.6, 0.1, 2.5], 0, { res: 0.14 });
  sculpt.box([-1.4, 0.9, 2.5], [0.8, 0.1, 0.42], 2, { res: 0.09 });
  for (const x of [-2, -0.8]) sculpt.box([x, 0.4, 2.5], [0.1, 0.4, 0.13], 1, { res: 0.08 });
  sculpt.box(crate, [0.29, 0.3, 0.29], 3, { res: 0.07 });
  sculpt.bake();
  return builder.finish({ cam: { target: [0, 0.85, 1.55], dist: 7 } });
}

function createSession() {
  return KIT.world.portals.create({
    places: [{ id: 'field', prepare: () => ({}) }],
    templates: [{ id: 'workshop', anchors: { door }, prepare({ instance, state }) {
      let crate = (state?.crate ?? [1.25, 0.3, 1.35]).slice();
      return {
        world: buildWorkshop(instance, crate),
        get crate() { return crate.slice(); },
        moveCrate(position) {
          this.world = buildWorkshop(instance, position);
          crate = position.slice();
        },
        checkpoint: () => ({ crate: crate.slice() })
      };
    } }]
  });
}

function cross(session, link) {
  const { origin, normal } = link.from.at;
  const { mad } = KIT.V;
  return session.cross(link.id, {
    previous: mad(origin, normal, 0.2),
    actor: { position: mad(origin, normal, -0.2), forward: normal.map(axis => -axis) }
  });
}

async function run() {
  const first = createSession();
  first.registerInstance(workshop);
  await first.enter('field');
  const open = (session, x, z) => session.openEntrance({
    id: 'workshop-door', at: { origin: [x, 1.25, z] },
    to: { place: workshop.id, anchor: 'door' }, aperture,
    returnTo: { position: [x, 1.25, z + 0.5], forward: [1, 0, 0] }
  });
  await cross(first, open(first, 4, 8));
  first.current().asset.moveCrate([-0.5, 0.3, 2.3]);
  first.closeEntrance('workshop-door');
  const saved = JSON.parse(JSON.stringify(first.checkpoint()));
  first.dispose();

  const reloaded = createSession();
  await reloaded.restore(saved);
  const firstExit = await cross(reloaded, reloaded.linksFrom(workshop.id)[0]);
  const secondVisit = await cross(reloaded, open(reloaded, 10, 4));
  const { crate } = secondVisit.place.asset;
  const secondExit = await cross(reloaded, reloaded.linksFrom(workshop.id)[0]);
  reloaded.dispose();
  return { crate, firstReturn: firstExit.actor.position, secondReturn: secondExit.actor.position };
}

module.exports = run;
if (require.main === module) run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
