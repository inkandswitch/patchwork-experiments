// The template's sloop on a fake stage, and a view in play: shared by
// sim.test.js and sim.slow.test.js.
import { layOutShip, headTo } from "../layout.js";
import { createSeaView } from "../sea-view.js";
import { createLooks } from "../looks.js";
import { createSim } from "../sim.js";
import { ANCHOR, SAIL } from "../traits.js";
import { fakeDrop, fakeNode } from "./fakes.js";

export const DIMS = { length: 12, beam: 3.8, draft: 1.9, freeboard: 1.2 };

/** A sloop laid out as the template does, on a beam reach with its anchor up, and the content the stage would show. */
export async function sloop({ yaw = headTo(45 - 90), down = false } = {}) {
  const doc = { objects: {}, order: [], traits: {}, view: {}, dimensions: {}, assets: {} };
  const hull = await layOutShip(
    fakeDrop(doc).ctx,
    { wind: { speed: 7, from: 45 }, seed: 3 },
  );
  doc.objects[hull].transform.rotation = [0, yaw, 0];
  const byName = (name) => Object.keys(doc.objects).find((id) => doc.objects[id].name === name);
  const ids = { hull, rig: byName("Boom and sail"), wheel: byName("Wheel"), windlass: byName("Windlass"), anchor: byName("Anchor"), buoy: byName("Red buoy") };
  doc.objects[ids.windlass].traits[ANCHOR].down = down;
  doc.objects[ids.rig].traits[SAIL].raised = 1; // the template leaves it down
  const content = {
    [hull]: { loaded: true, box: doc.objects[hull].hint.bounds, extras: { ship: DIMS }, root: fakeNode() },
    [ids.rig]: { loaded: true, box: null, extras: {}, root: fakeNode({ Sail: fakeNode() }) },
    [ids.buoy]: { loaded: true, box: null, extras: {}, root: fakeNode() },
  };
  return { doc, ids, content };
}

/** A view in play: the parts play.js joins that this package's sea and ships need, ticked in its order. */
export function play(api) {
  const ctx = {};
  ctx.sea = createSeaView(api);
  ctx.sim = createSim(api, ctx);
  ctx.looks = createLooks(api, ctx);
  ctx.looks.update(api.scene());
  api.loop((dt, now) => {
    ctx.sea.tick(dt, now, ctx.sim.simulating(), ctx.sim.simulator());
    ctx.sim.tick(dt);
    ctx.looks.tick(dt);
  });
  return ctx;
}

export const heldAt = (w, id) => w.holds.get(id)?.transform;

