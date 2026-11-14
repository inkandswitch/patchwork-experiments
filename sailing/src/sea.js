// The sea part (DESIGN.md, "Play"; water/WATER.md): a scene:extension apart
// from the ships, running wherever a scene has the `sailing.sea` trait. It
// makes the sea's waves and wind from the trait and gives them away, as
// data, to whoever reads them; it draws nothing and runs no crew, sim or HUD,
// so a harbour with a sea and no ships holds no sailing machinery.
//
//   - `water.waves` (the water package's convention, collected in this
//     stage): the Gerstner components ocean.js's spectrum makes for the
//     trait, and the look the drawn surface needs (seed, wind, stats). The
//     water package evaluates and draws them.
//   - ambients (scene STAGE.md, "Ambients"): `sailing.wind`, the wind's
//     plain numbers, which every boat in this world reads (sea-view.js); and
//     the atmosphere, a bright maritime day. Where this doc is the outermost,
//     they are the world's.
//
// Pure but for create().

import { createOcean } from "./ocean.js";
import { SEA } from "./traits.js";

/** A bright maritime day: blue overhead, a pale horizon the far sea hazes into, the sun high to one side. */
export const ATMOSPHERE = Object.freeze({
  sky: Object.freeze({ top: "#2f6db5", horizon: "#cfe2ee", bottom: "#a9c6d8" }),
  fog: Object.freeze({ color: "#cfe2ee", near: 300, far: 9000 }),
  sun: Object.freeze({ direction: Object.freeze([0.55, 0.7, -0.45]), color: "#fff3df", intensity: 2.2, shadows: true }),
  exposure: 1,
});

/** The ambient name of a world's wind. */
export const WIND_AMBIENT = "sailing.wind";

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

/** The sea trait with its defaults filled in (index.js describes them): { wind: { speed, from }, seed, scale }. */
export function seaParams(trait) {
  const t = trait ?? {};
  return {
    wind: { speed: Math.max(0, num(t.wind?.speed, 7)), from: num(t.wind?.from, 45) },
    seed: num(t.seed, 1),
    scale: Math.max(0, num(t.scale, 1)),
  };
}

/**
 * What a sea trait gives away: the waves for the water package and the
 * ambients, all plain JSON. null for no trait.
 * @returns {{ waves: { components: object[], look: { seed, wind, stats } }, ambient: object } | null}
 */
export function seaOffer(trait) {
  if (!trait) return null;
  const p = seaParams(trait);
  const o = createOcean(p);
  return {
    waves: { components: o.components, look: { seed: o.seed, wind: { ...o.wind }, stats: { ...o.stats } } },
    ambient: { [WIND_AMBIENT]: { speed: p.wind.speed, from: p.wind.from, seed: p.seed }, atmosphere: ATMOSPHERE },
  };
}

export default {
  create(api) {
    let key = null;
    let offer = null;
    /** The offer for the doc's trait now, made again only when the trait changed. */
    function current() {
      const trait = api.doc()?.traits?.[SEA] ?? null;
      const k = trait ? JSON.stringify(seaParams(trait)) : null;
      if (k !== key) {
        key = k;
        offer = seaOffer(trait);
      }
      return offer;
    }
    return {
      get "water.waves"() {
        return current()?.waves ?? undefined;
      },
      ambient: () => current()?.ambient ?? null,
    };
  },
};
