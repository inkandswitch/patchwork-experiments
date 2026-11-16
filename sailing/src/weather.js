// The weather (water/WATER.md, "Water bodies", Decision 48): a scene trait,
// `sailing.weather: { wind: { speed, from }, seed? }`, and an extension that
// offers it to the world as ambients (scene STAGE.md, "Ambients"). Wind and
// sky belong to a world, not to a body of water, so a doc with a bay and a
// pond offers one wind, and a dry island can have one.
//
//   - `wind`: the world's wind as plain numbers ({ speed, from, seed,
//     gustiness }: wind.js makes it a wind), which every boat's physics reads
//     (sea-view.js), every sea builds its waves from (sea.js), and the water
//     package's surface reads for its roughness and foam: one copy of one
//     fact.
//   - `atmosphere`: a bright maritime day.
//
// Where this doc is the outermost, they are the world's. Pure but for create().

import { WEATHER } from "./traits.js";
import { GUSTINESS } from "./wind.js";

/** A bright maritime day: blue overhead, a pale horizon the far sea hazes into, the sun high to one side. */
export const ATMOSPHERE = Object.freeze({
  sky: Object.freeze({ top: "#2f6db5", horizon: "#cfe2ee", bottom: "#a9c6d8" }),
  fog: Object.freeze({ color: "#cfe2ee", near: 300, far: 9000 }),
  sun: Object.freeze({ direction: Object.freeze([0.55, 0.7, -0.45]), color: "#fff3df", intensity: 2.2, shadows: true }),
  exposure: 1,
});

/** The ambient name of a world's wind (sailing/DESIGN.md, "Conventions"; STAGE.md names it): { speed (m/s), from (degrees), seed, gustiness (0..1) }. */
export const WIND_AMBIENT = "wind";

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

/** The weather trait with its defaults filled in (index.js describes them): { wind: { speed, from }, seed }. */
export function weatherParams(trait) {
  const t = trait ?? {};
  return { wind: { speed: Math.max(0, num(t.wind?.speed, 7)), from: num(t.wind?.from, 45) }, seed: num(t.seed, 1) };
}

/** What a weather trait offers: the wind and the sky, plain JSON. null for no trait. */
export function weatherOffer(trait) {
  if (!trait) return null;
  const p = weatherParams(trait);
  return { [WIND_AMBIENT]: { speed: p.wind.speed, from: p.wind.from, seed: p.seed, gustiness: GUSTINESS }, atmosphere: ATMOSPHERE };
}

export default {
  create(api) {
    let key;
    let offer = null;
    return {
      ambient() {
        const trait = api.doc()?.traits?.[WEATHER] ?? null;
        const k = trait ? JSON.stringify(weatherParams(trait)) : null;
        if (k !== key) {
          key = k;
          offer = weatherOffer(trait);
        }
        return offer;
      },
    };
  },
};
