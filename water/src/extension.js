// The water extension (WATER.md): it runs wherever a scene has the `water`
// trait, and does three things, none of which reads another doc's code.
//
//   - It offers the world's water as an ambient (scene STAGE.md,
//     "Ambients"): plain JSON in its doc's root frame on its world time,
//     { v, level, components, look }, the waves being whatever its own
//     stage's extensions contribute as `water.waves` (sailing's sea does;
//     none is flat water at `level`), and `look` what only the wave maker
//     knows of them (seed, stats). The stage takes the outermost doc's.
//   - It gives its own stage's parts a reader of the world's water, as the
//     contribution `water` (api.collect("water")): sailing's ocean shape, in
//     this stage's frame and on this stage's clock (convert.js), or null where
//     the world has none, the frame is tilted, or the version isn't this one.
//   - Only in the outermost stage, it draws the one surface (material.js),
//     around the camera, lit by the world's atmosphere ambient and roughened
//     by the world's wind ambient (`wind`: { speed, from, ... }, sailing's
//     sea offers it; none is calm), and sets the stage's extent to hold it.
//
// Waves are a function of the world's time, so where its doc is the world
// and its water has waves, it registers a process with no state: a reason
// for that time to pass, even in a harbour that holds only water and links.
// A contained doc's reader runs on the world's clock, and flat water doesn't
// move, so neither registers one (they'd take a clock claim for nothing).

import { createOceanSurface } from "./material.js";
import { createTiming, latch, readerFor, VERSION } from "./convert.js";

export const TRAIT = "water";
/** The convention a wave maker contributes in the water's stage: { components, look? }. */
export const WAVES = "water.waves";
/** The world's wind, an ambient whoever makes the weather offers (sailing's sea): { speed (m/s), from (degrees) }. */
export const WIND = "wind";
const CALM = Object.freeze({ speed: 0, from: 0 });
/** How far the water reaches across (m): past the fog, where it's drawn to. */
export const WATER_REACH = 20_000;

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * The water a doc offers, from its trait and its stage's `water.waves`
 * contributions ([{ id, value }] in running order: the last one's waves,
 * whole). Plain JSON. Pure.
 */
export function waterValue(trait, contributions = []) {
  const waves = [...contributions].reverse().find((c) => Array.isArray(c?.value?.components))?.value ?? null;
  return {
    v: VERSION,
    level: num(trait?.level, 0),
    components: waves ? waves.components : [],
    ...(waves?.look ? { look: waves.look } : {}),
  };
}

/**
 * The water as the stage's near plane must not cut it (api.extent): a slab
 * WATER_REACH across, as high and deep as every wave's amplitude together
 * (no crest or trough can pass that) and 0.5 m more, about the level. Pure.
 */
export function waterExtent(components, level = 0) {
  let h = 0.5;
  for (const c of components ?? []) h += Math.abs(c.amp) || 0;
  return { min: [-WATER_REACH, level - h, -WATER_REACH], max: [WATER_REACH, level + h, WATER_REACH] };
}

/** A frame's identity for rebuilding a reader: its matrix's numbers. */
const frameKey = (frame) => (frame?.matrix ? frame.matrix.join(",") : "I");

export default {
  create(api) {
    const timing = createTiming(false);
    let reader = null;
    let readFrom = null; // { value, key, mine } the reader was made for
    let refused = false; // said once: no water here (tilted, or another version)

    // a reason for the world's time to pass (no state, nothing saved): held
    // only where this doc is the world and its water has waves
    let process = null;
    function needTime(a) {
      const want = !!a?.mine && a.value.components?.length > 0;
      if (want && !process) process = api.clock.process({ step() {} }) ?? (() => {});
      else if (!want && process) {
        process();
        process = null;
      }
    }

    /** The reader for the world's water as it is now (made again only when the value, the frame or `mine` changed). */
    function refresh() {
      const a = api.ambient(TRAIT);
      const key = a ? frameKey(a.frame) : null;
      if (!a) {
        reader = null;
        readFrom = null;
        return null;
      }
      if (!readFrom || readFrom.value !== a.value || readFrom.key !== key || readFrom.mine !== a.mine) {
        timing.mine = a.mine;
        if (!a.mine && !timing.latched) latch(timing, a.clock, api.clock.t());
        reader = readerFor(a.value, a.frame, timing);
        readFrom = { value: a.value, key, mine: a.mine };
        if (!reader && !refused) {
          refused = true;
          api.notify?.(a.value?.v !== VERSION ? "This world's water is from another version of the water package: nothing floats here" : "Tilted: no water here", "info");
        } else if (reader) refused = false;
      }
      return a;
    }

    // ─── drawing: the outermost's only ───
    const group = api.world();
    let surface = null;
    let drawn = null; // the reader the surface was made for
    let drawnWind; // and the wind ambient's value
    function draw(a) {
      if (!reader) return undraw();
      const wind = api.ambient(WIND)?.value ?? null;
      if (drawn !== reader || drawnWind !== wind) {
        drawn = reader;
        drawnWind = wind;
        // the surface's look: the waves, and the world's wind for their fine detail, roughness and foam
        const sea = { ...reader, wind: wind ? { speed: Number(wind.speed) || 0, from: Number(wind.from) || 0 } : CALM };
        if (surface) surface.setSea(sea);
        else {
          surface = createOceanSurface(api.THREE, sea);
          group.add(surface.object);
        }
        group.position.y = reader.level;
        api.extent?.(waterExtent(reader.components, reader.level));
        api.invalidate();
      }
      const at = api.camera.get()?.position;
      const atm = api.ambient("atmosphere")?.value ?? null;
      // (no atmosphere: the surface's own sun and sky, as the stage's own look has no sky to reflect)
      if (at) surface.update(a.clock.t, at, atm ? (atm.sun ?? null) : undefined, atm?.sky);
    }
    function undraw() {
      if (!surface) return;
      surface.dispose();
      surface = null;
      drawn = null;
      drawnWind = undefined;
      api.extent?.(null);
      api.invalidate();
    }

    const off = api.loop(() => {
      const a = refresh();
      // after every clock has ticked: the offset the next frame's reads use (convert.js)
      if (a && !a.mine) latch(timing, a.clock, api.clock.t());
      needTime(a);
      if (a?.mine) draw(a);
      else undraw();
    });
    needTime(refresh());

    return {
      /** the world's water, in this stage's frame and on its clock (convert.js readerFor), or null */
      get water() {
        if (!readFrom) refresh();
        return reader;
      },
      ambient() {
        const trait = api.doc()?.traits?.[TRAIT];
        return trait ? { [TRAIT]: waterValue(trait, api.collect(WAVES)) } : null;
      },
      dispose() {
        off?.();
        needTime(null);
        undraw();
      },
      // for probes: the surface drawn here, if any
      debug: {
        get surface() {
          return surface;
        },
        timing,
      },
    };
  },
};
