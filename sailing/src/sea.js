// The sea (DESIGN.md, "Play"; water/WATER.md, "Water bodies"): a behaviour
// put on a water body. `sailing.sea: { seed, scale }` is an object trait; on
// an object with the water package's `water` trait it makes that body's
// waves, as the water's answer to the world's wind, and gives them away as
// data (`water.waves`, the water package's convention, keyed by body). It
// draws nothing and runs no crew, sim or HUD, so a harbour with a sea and
// no ships holds no sailing machinery. On an object without water it makes
// nothing, and says so once.
//
// The waves come from the world's `wind` ambient in this stage's frame
// (sea-view.js meanWindHere), so a pond and the bay under one wind agree and
// a basin in a dry room is calm (no wind, flat water). The components are
// in the doc's root frame for every body, open or bounded. The wind is read
// during the ambient flush, so the world's water settles one flush after its
// wind: when the wind it built from differs (by value) from the wind now, it
// asks the stage for a reflush (api.schedule), and the settle ends.
//
// Pure but for create().

import { seaWaves } from "./ocean.js";
import { SEA, WATER_TRAIT, WIND_AMBIENT } from "./traits.js";
import { meanWindHere } from "./sea-view.js";

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
const STILL = Object.freeze({ hs: 0, peakPeriod: 0, peakWavelength: 0, whitecaps: 0 });

/** The sea trait with its defaults filled in (index.js describes them): { seed, scale }. */
export function seaParams(trait) {
  const t = trait ?? {};
  return { seed: num(t.seed, 1), scale: Math.max(0, num(t.scale, 1)) };
}

/**
 * A sea's waves under a wind (plain numbers in the doc's frame, or null:
 * none, flat water): the components ocean.js's spectrum makes, and what
 * only the wave maker knows of them (seed, stats). Plain JSON. Pure.
 * @returns {{ components: object[], look: { seed: number, stats: object } }}
 */
export function seaWavesFor(trait, wind) {
  const p = seaParams(trait);
  if (!wind || !(wind.speed > 0)) return { components: [], look: { seed: p.seed, stats: { ...STILL } } };
  const o = seaWaves({ wind: { speed: wind.speed, from: wind.from }, seed: p.seed, scale: p.scale });
  return { components: o.components, look: { seed: o.seed, stats: { ...o.stats } } };
}

/** The bodies a doc's seas make waves for: { [objectId]: waves } over its objects with both a sea and water. Pure. */
export function seaBodies(objects, wind) {
  const out = {};
  for (const id of Object.keys(objects ?? {}).sort()) {
    const t = objects[id]?.traits;
    if (t?.[SEA] && t[WATER_TRAIT]) out[id] = seaWavesFor(t[SEA], wind);
  }
  return out;
}

export default {
  create(api) {
    let key;
    let windKey; // the wind (by value) the last waves were built from
    let offer;
    const said = new Set();
    return {
      get "water.waves"() {
        const objects = api.scene?.()?.objects ?? api.doc()?.objects ?? {};
        const a = api.ambient(WIND_AMBIENT);
        const wind = a ? meanWindHere(a.value, a.frame) : null;
        const wk = wind ? `${wind.speed},${wind.from}` : "none";
        const seas = Object.keys(objects).filter((id) => objects[id]?.traits?.[SEA]);
        for (const id of seas) {
          if (objects[id].traits[WATER_TRAIT] || said.has(id)) continue;
          said.add(id);
          api.use("notices")?.notify(`A sea needs water: add Water to “${objects[id].name ?? id}”`, "info");
        }
        const k = JSON.stringify([wk, seas.map((id) => [id, seaParams(objects[id].traits[SEA]), !!objects[id].traits[WATER_TRAIT]])]);
        if (k !== key) {
          key = k;
          offer = { bodies: seaBodies(objects, wind) };
          // built on a wind the flush hadn't settled on yet: once more, so the world's water follows its wind
          if (wk !== windKey) {
            windKey = wk;
            api.schedule?.(() => {});
          }
        }
        return Object.keys(offer.bodies).length ? offer : undefined;
      },
    };
  },
};
