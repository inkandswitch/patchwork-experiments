// The sea in play (DESIGN.md, "Play"): the drawn ocean and the sky. ctx.sea
// is what the other parts read: the ocean and wind they float and sail on,
// and the time to ask them at.
//
// The sea's time is the doc's world time, api.clock.t() (scene TOOLS.md
// §7): the computing view's own, and every other view's following it at the
// moment whose held poses it's drawing, so a hull sits on the waves drawn
// under it. Paused, or with nobody computing, the sea stands still.
//
// drawSea is the part both activities draw (edit.js shares it): the ocean
// built from the scene's sailing.sea trait, its surface following the
// camera, and the atmosphere the surface is lit to match. A scene with no
// sea trait gets neither.

import { createOcean } from "./ocean.js";
import { createWind } from "./wind.js";
import { createOceanSurface } from "./ocean-material.js";
import { SEA } from "./traits.js";

/** A bright maritime day: blue overhead, a pale horizon the far sea hazes into, the sun high to one side. */
export const ATMOSPHERE = Object.freeze({
  sky: Object.freeze({ top: "#2f6db5", horizon: "#cfe2ee", bottom: "#a9c6d8" }),
  fog: Object.freeze({ color: "#cfe2ee", near: 300, far: 9000 }),
  sun: Object.freeze({ direction: Object.freeze([0.55, 0.7, -0.45]), color: "#fff3df", intensity: 2.2, shadows: true }),
  exposure: 1,
});

// ─── the sea from the doc (pure) ────────────────────────────────────────────

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

// ─── drawing (stage side) ───────────────────────────────────────────────────

/**
 * The sea as both activities draw it: the ocean and wind from the doc's
 * sailing.sea trait (rebuilt when it changes), and its surface in a world
 * group; nothing, and no atmosphere, while the scene has no sea trait. The
 * owner runs the loop: draw(t) once a frame.
 * @param {any} api
 */
export function drawSea(api) {
  let key = null;
  let ocean = null;
  let wind = null;
  let surface = null;
  const group = api.world();

  function build(trait) {
    if (!trait) {
      if (key === null) return;
      key = null;
      ocean = wind = null;
      surface?.dispose();
      surface = null;
      api.extent?.(null);
      api.invalidate();
      return;
    }
    const p = seaParams(trait);
    const k = JSON.stringify(p);
    if (k === key) return;
    key = k;
    ocean = createOcean(p);
    api.extent?.(waterExtent(ocean));
    wind = createWind({ ...p.wind, seed: p.seed });
    if (surface) surface.setSea(ocean);
    else {
      surface = createOceanSurface(api.THREE, ocean, { sun: ATMOSPHERE.sun, sky: ATMOSPHERE.sky });
      group.add(surface.object);
    }
    api.invalidate();
  }
  build(api.doc()?.traits?.[SEA]);

  return {
    get ocean() {
      return ocean;
    },
    get wind() {
      return wind;
    },
    atmosphere: () => (ocean ? ATMOSPHERE : null),
    update(scene) {
      build(scene?.traits?.[SEA]);
    },
    /** The surface at time t, around the camera. */
    draw(t) {
      surface?.update(t, api.camera.object.position, ATMOSPHERE.sun, ATMOSPHERE.sky);
    },
    dispose() {
      surface?.dispose();
      surface = null;
      if (key !== null) api.extent?.(null);
    },
  };
}

/** How far the water reaches across (m): past the fog, where it's drawn to. */
export const WATER_REACH = 20_000;

/**
 * The water as the stage's near plane must not cut it (api.extent): a slab
 * WATER_REACH across, as high and deep as every wave's amplitude together (no
 * crest or trough can pass that), and 0.5 m more. The surface is drawn in a
 * world group the stage doesn't measure, its waves in the shader. Pure.
 */
export function waterExtent(ocean) {
  let h = 0.5;
  for (const c of ocean?.components ?? []) h += Math.abs(c.amp) || 0;
  return { min: [-WATER_REACH, -h, -WATER_REACH], max: [WATER_REACH, h, WATER_REACH] };
}

/**
 * ctx.sea: the sea in play. play.js ticks it first each frame, to draw it at
 * the doc's world time.
 * @param {any} api
 */
export function createSeaView(api) {
  const sea = drawSea(api);

  return {
    get ocean() {
      return sea.ocean;
    },
    get wind() {
      return sea.wind;
    },
    /** the sea's time: the doc's world time (s) */
    clock: () => api.clock.t(),
    atmosphere: sea.atmosphere,
    update(scene) {
      sea.update(scene);
    },
    /** One frame: the surface drawn at the doc's world time. */
    tick() {
      const t = api.clock.t();
      sea.draw(t);
      return t;
    },
    dispose() {
      sea.dispose();
    },
  };
}
