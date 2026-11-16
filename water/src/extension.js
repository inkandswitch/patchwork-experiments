// The water extension (WATER.md, "Water bodies"): it runs wherever a scene
// has an object with the `water` trait. Water is a shape: an object whose
// extent says whether it is weather or a thing (bodies.js). Nothing here
// reads another doc's code or data but the ambients.
//
//   - Open water is weather. The doc's open body (one per doc, the lowest
//     id) is offered as the `water` ambient: plain JSON in the doc's root
//     frame on its world time, { v, level, components, look?, current? },
//     its waves whatever this stage's extensions contribute for it as
//     `water.waves` (sailing's sea; none is flat water), the current's
//     frequency shift already in them. A stage reads the outermost offer
//     on its own path (scene's ambient rule): a host's open water wins, and
//     a contained doc's open body is silent under it; under a host with
//     none, a doc's own open water is its own.
//   - Bounded water is a thing. Each bounded body counts for its own doc
//     wherever that doc is drawn, in its doc's frame and on its doc's clock,
//     and is never offered: no other doc reads it, not even when its doc is
//     the outermost.
//   - It gives its own stage's parts the contribution `water`: { at(p, {
//     not }) → reader | null }, which water a point in this stage's frame is
//     in (choose.js), as sailing's ocean shape (convert.js for the world's
//     open water, bounded.js for a body of this doc), or null.
//   - It draws the open surface where its own open water is the one its
//     stage reads (the ambient's `mine`: around the camera, lit by the
//     atmosphere and roughened by the wind its stage reads), and a finite patch over each bounded body in every stage that
//     draws its doc (acting, mirror, pin), and sets the stage's extent to the
//     union of what it draws.
//
// Waves are a function of time, so it registers a process with no state (a
// reason for time to pass) where its own open water is the one its stage reads
// and has waves, or where any of its own bounded bodies has waves; the stage holds
// it only where the stage acts for the doc (never in a mirror or a pin).

import { createOceanSurface } from "./material.js";
import { createTiming, latch, levelOf, readerFor, VERSION } from "./convert.js";
import { amplitudeBound, bodiesOf, boxOf, clipToSpan, currentOf, CURRENT, isLevel, rigidVelocity, scaleOf, shiftByCurrent, TRAIT } from "./bodies.js";
import { boundedReader } from "./bounded.js";
import { choose } from "./choose.js";

export { TRAIT, CURRENT };
/** The convention a wave maker contributes in the water's stage: { bodies: { [objectId]: { components, look? } } }. */
export const WAVES = "water.waves";
/** The world's wind, an ambient whoever makes the weather offers (sailing's weather): { speed (m/s), from (degrees) }. */
export const WIND = "wind";
const CALM = Object.freeze({ speed: 0, from: 0 });
const STILL = Object.freeze({ v: Object.freeze([0, 0, 0]), w: Object.freeze([0, 0, 0]) });
/** How far the open water reaches across (m): past the fog, where it's drawn to. */
export const WATER_REACH = 20_000;

/**
 * Each body's waves from the stage's `water.waves` contributions ([{ id,
 * value }] in running order): per body, the last contributor's whole. Pure.
 * @returns {{ [bodyId: string]: { components: object[], look?: object } }}
 */
export function wavesByBody(contributions = []) {
  const out = {};
  for (const c of contributions ?? []) {
    const bodies = c?.value?.bodies;
    if (!bodies || typeof bodies !== "object") continue;
    for (const [id, w] of Object.entries(bodies)) if (Array.isArray(w?.components)) out[id] = w;
  }
  return out;
}

/**
 * The open water a doc offers: its level, its waves (shifted by its current)
 * and what only the wave maker knows of them, and the current. Plain JSON.
 * Pure.
 * @param {number} level  @param {{ components: object[], look?: object } | null | undefined} waves  @param {number[]} [U]
 */
export function waterValue(level, waves, U = [0, 0]) {
  const moving = U[0] !== 0 || U[1] !== 0;
  return {
    v: VERSION,
    level: Number.isFinite(level) ? level : 0,
    components: shiftByCurrent(waves?.components ?? [], U),
    ...(waves?.look ? { look: waves.look } : {}),
    ...(moving ? { current: [U[0], U[1]] } : {}),
  };
}

/**
 * The open water as the stage's near plane must not cut it (api.extent): a
 * slab WATER_REACH across, as high and deep as every wave's amplitude
 * together and 0.5 m more, about the level. Pure.
 */
export function waterExtent(components, level = 0) {
  const h = amplitudeBound(components);
  return { min: [-WATER_REACH, level - h, -WATER_REACH], max: [WATER_REACH, level + h, WATER_REACH] };
}

/** A bounded body's slab: its footprint's corners in the stage's frame, the band A about its level. Pure. */
export function patchExtent(box, A) {
  const [w, , l] = box.size;
  const M = box.M;
  const min = [Infinity, box.level - A, Infinity];
  const max = [-Infinity, box.level + A, -Infinity];
  for (const u of [-w / 2, w / 2])
    for (const v of [-l / 2, l / 2]) {
      const x = M[0] * u + M[8] * v + M[12];
      const z = M[2] * u + M[10] * v + M[14];
      min[0] = Math.min(min[0], x);
      max[0] = Math.max(max[0], x);
      min[2] = Math.min(min[2], z);
      max[2] = Math.max(max[2], z);
    }
  return { min, max };
}

/** The union of boxes (nulls left out), or null for none. Pure. */
export function unionOf(boxes) {
  let out = null;
  for (const b of boxes) {
    if (!b) continue;
    if (!out) out = { min: [...b.min], max: [...b.max] };
    else
      for (let i = 0; i < 3; i++) {
        out.min[i] = Math.min(out.min[i], b.min[i]);
        out.max[i] = Math.max(out.max[i], b.max[i]);
      }
  }
  return out;
}

/** Is `id` the object `root` or attached anywhere under it, in a snapshot's resolved tree? */
export function isUnder(scene, id, root) {
  if (root == null) return false;
  for (let at = id, n = 0; at != null && n < 64; at = scene?.parents?.get?.(at) ?? null, n++) if (at === root) return true;
  return false;
}

/** A frame's identity for rebuilding a reader: its matrix's numbers. */
const frameKey = (frame) => (frame?.matrix ? frame.matrix.join(",") : "I");
/** A body's heading in the stage's frame: its +Z column's yaw. */
const yawOf = (M) => Math.atan2(M[8], M[10]);

export default {
  create(api) {
    // ─── the world's open water, as this stage reads it ───
    const timing = createTiming(false);
    let world = null; // the reader (convert.js), or null
    let worldFrom = null; // { value, key, mine } it was made for
    let worldHere = null; // { level, A } in this stage's frame, for the choice
    let refused = false; // said once: no water here (tilted frame, another version)

    /** The reader for the world's open water as it is now (made again only when the value, the frame or `mine` changed). */
    function refreshWorld() {
      const a = api.ambient(TRAIT);
      if (!a) {
        world = null;
        worldFrom = null;
        worldHere = null;
        return null;
      }
      const key = frameKey(a.frame);
      if (!worldFrom || worldFrom.value !== a.value || worldFrom.key !== key || worldFrom.mine !== a.mine) {
        timing.mine = a.mine;
        if (!a.mine && !timing.latched) latch(timing, a.clock, api.clock.t());
        world = readerFor(a.value, a.frame, timing);
        worldFrom = { value: a.value, key, mine: a.mine };
        const f = world ? levelOf(a.frame) : null;
        worldHere = f ? { level: ((Number(a.value.level) || 0) - f.ty) / f.s, A: amplitudeBound(a.value.components) / f.s } : null;
        if (!world && !refused) {
          refused = true;
          api.notify?.(a.value?.v !== VERSION ? "This world's water is from another version of the water package: nothing floats here" : "Tilted: no water here", "info");
        } else if (world) refused = false;
      }
      return a;
    }

    // ─── this doc's bounded bodies ───
    const bodies = new Map(); // id → { cell: { box, rv }, key, reader, A, prev, prevT, components, look }
    let order = []; // the bounded ids shown, lowest first
    const said = new Set(); // notices given, by key
    const sayOnce = (key, text) => {
      if (said.has(key)) return;
      said.add(key);
      api.notify?.(text, "info");
    };

    /** Each bounded body's box (its drawn pose), its rigid velocity since the last frame, and its reader (made again only when its waves change). */
    function refreshBodies() {
      const sc = api.scene?.() ?? null;
      const found = bodiesOf(sc?.objects);
      for (const id of found.extra) sayOnce(`extra:${id}`, `Only one open water counts in a scene: “${sc.objects[id]?.name ?? id}” is left out`);
      for (const id of found.invalid) sayOnce(`invalid:${id}`, `Water's size is three positive numbers (width, depth, length): “${sc.objects[id]?.name ?? id}” holds none`);
      const waves = found.bounded.length ? wavesByBody(api.collect(WAVES)) : {};
      const t = api.clock.t();
      const seen = new Set();
      order = [];
      for (const { id, size } of found.bounded) {
        const W = api.worldOf(id);
        if (!W) continue;
        seen.add(id);
        order.push(id);
        let b = bodies.get(id);
        if (!b) bodies.set(id, (b = { cell: { box: null, rv: null }, key: null, reader: null, A: 0.5, prev: null, prevT: t, components: [], look: null }));
        const box = boxOf(size, Array.from(W));
        b.cell.box = box;
        const dt = t - b.prevT;
        b.cell.rv = dt > 0 ? rigidVelocity(b.prev, box.M, dt) : { ...STILL, o: [box.M[12], box.M[13], box.M[14]] };
        b.prev = box.M;
        b.prevT = t;
        const U = currentOf(sc.objects[id]?.traits?.[CURRENT]);
        const w = waves[id] ?? null;
        const components = clipToSpan(shiftByCurrent(w?.components ?? [], U), box.span);
        const key = JSON.stringify([components, U, w?.look ?? null]);
        if (key !== b.key) {
          b.key = key;
          b.components = components;
          b.look = w?.look ?? null;
          b.reader = boundedReader({ id, components, U, look: w?.look }, b.cell);
          b.A = amplitudeBound(components);
        }
      }
      for (const id of [...bodies.keys()]) if (!seen.has(id)) bodies.delete(id);
      return sc;
    }

    let frame = 0;
    let freshAt = -1; // the frame refresh last ran in
    let scene = null;
    function refresh() {
      if (freshAt === frame) return;
      freshAt = frame;
      refreshWorld();
      scene = refreshBodies();
    }

    /** Which water p (this stage's frame; p[1] null: from above) is in, leaving out what `not` carries: a reader, or null. */
    function at(p, { not = null } = {}) {
      refresh();
      const list = order.map((id) => {
        const b = bodies.get(id);
        return { id, box: b.cell.box, A: b.A, carried: isUnder(scene, id, not) };
      });
      const c = choose(p, world ? worldHere : null, list);
      if (!c) return null;
      return c.kind === "open" ? world : bodies.get(c.id).reader;
    }
    const contribution = Object.freeze({ at });

    // a reason for time to pass (no state, nothing saved)
    let process = null;
    function needTime(a) {
      let want = !!a?.mine && a.value.components?.length > 0;
      for (const b of bodies.values()) want ||= b.components.length > 0;
      if (want && !process) process = api.clock.process({ step() {} }) ?? (() => {});
      else if (!want && process) {
        process();
        process = null;
      }
    }

    // ─── drawing ───
    const group = api.world();
    let surface = null; // the open surface: only where this doc's open water is the one its stage reads (mine)
    let drawn = null; // the reader it was made for
    let drawnWind; // and the wind ambient's value
    const patches = new Map(); // id → { surface, key, wind }
    let extentKey = null;

    const lookOf = (components, look, wind) => ({
      components,
      seed: look?.seed ?? 1,
      stats: look?.stats ?? { hs: 0, peakPeriod: 0, peakWavelength: 0, whitecaps: 0 },
      wind: wind ? { speed: Number(wind.speed) || 0, from: Number(wind.from) || 0 } : CALM,
    });

    function drawOpen(a, wind, atm) {
      if (!a?.mine || !world) return undrawOpen();
      if (drawn !== world || drawnWind !== wind) {
        drawn = world;
        drawnWind = wind;
        // the surface's look: the waves, and the world's wind for their fine detail, roughness and foam
        const sea = { ...world, wind: wind ? { speed: Number(wind.speed) || 0, from: Number(wind.from) || 0 } : CALM };
        if (surface) surface.setSea(sea);
        else {
          surface = createOceanSurface(api.THREE, sea);
          group.add(surface.object);
        }
        api.invalidate();
      }
      const cam = api.camera.get()?.position;
      if (cam) surface.update(a.clock.t, cam, atm ? (atm.sun ?? null) : undefined, atm?.sky);
      // around the camera, at the world's level
      surface.object.position.y = world.level;
      return waterExtent(world.components, world.level);
    }
    function undrawOpen() {
      if (!surface) return null;
      surface.dispose();
      surface = null;
      drawn = null;
      drawnWind = undefined;
      api.invalidate();
      return null;
    }

    function drawPatches(wind, atm) {
      const t = api.clock.t();
      const out = [];
      for (const id of order) {
        const b = bodies.get(id);
        const box = b.cell.box;
        const s = scaleOf(box.M);
        const w = box.size[0] * s, l = box.size[2] * s, yaw = yawOf(box.M);
        let p = patches.get(id);
        if (!p) {
          p = { surface: createOceanSurface(api.THREE, lookOf(b.components, b.look, wind), { patch: { w, l, yaw } }), key: b.key, wind };
          group.add(p.surface.object);
          patches.set(id, p);
          api.invalidate();
        } else if (p.key !== b.key || p.wind !== wind) {
          p.surface.setSea(lookOf(b.components, b.look, wind));
          p.key = b.key;
          p.wind = wind;
          api.invalidate();
        }
        p.surface.setPatch(w, l, yaw);
        p.surface.update(t, [box.M[12], box.M[13], box.M[14]], atm ? (atm.sun ?? null) : undefined, atm?.sky);
        out.push(patchExtent(box, b.A));
      }
      for (const [id, p] of [...patches]) {
        if (bodies.has(id)) continue;
        p.surface.dispose();
        patches.delete(id);
        api.invalidate();
      }
      return out;
    }

    function setExtent(box) {
      const key = box ? JSON.stringify(box) : null;
      if (key === extentKey) return;
      extentKey = key;
      api.extent?.(box);
    }

    const off = api.loop(() => {
      frame++;
      refresh();
      const a = api.ambient(TRAIT);
      // after every clock has ticked: the offset the next frame's reads use (convert.js)
      if (a && !a.mine) latch(timing, a.clock, api.clock.t());
      needTime(a);
      const wind = api.ambient(WIND)?.value ?? null;
      const atm = api.ambient("atmosphere")?.value ?? null;
      const open = drawOpen(a, wind, atm);
      const own = drawPatches(wind, atm);
      setExtent(unionOf([open, ...own]));
    });
    refresh();
    needTime(api.ambient(TRAIT));

    return {
      /** which water a point is in, as a reader in this stage's frame and on its clock: { at(p, { not }) } */
      water: contribution,
      ambient() {
        const sc = api.scene?.() ?? null;
        const id = bodiesOf(sc?.objects).open;
        if (!id) return null;
        const M = sc.world?.(id) ?? null;
        if (M && !isLevel(M)) {
          sayOnce(`tilted:${id}`, "Tilted: no water here");
          return null;
        }
        const waves = wavesByBody(api.collect(WAVES))[id];
        return { [TRAIT]: waterValue(M ? M[13] : 0, waves, currentOf(sc.objects[id]?.traits?.[CURRENT])) };
      },
      dispose() {
        off?.();
        bodies.clear();
        order = [];
        needTime(null);
        undrawOpen();
        for (const p of patches.values()) p.surface.dispose();
        patches.clear();
        if (extentKey !== null) api.extent?.(null);
        api.invalidate();
      },
      // for probes: what is drawn here
      debug: {
        get surface() {
          return surface;
        },
        get patches() {
          return [...patches.keys()];
        },
        bodies: () => [...order],
        timing,
      },
    };
  },
};
