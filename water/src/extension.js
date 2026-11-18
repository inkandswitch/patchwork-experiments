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
//     frequency shift already in them. The stage takes the outermost doc's;
//     a contained doc's open body is silent.
//   - Bounded water is a thing. Each bounded body counts for its own doc
//     wherever that doc is drawn, in its doc's frame and on its doc's clock,
//     and is never offered: no other doc reads it, not even when its doc is
//     the outermost.
//   - It gives its own stage's parts the contribution `water`: { at(p, {
//     not }) → reader | null }, `not` an id or a list of ids (walk leaves out
//     every support's water), which water a point in this stage's frame is
//     in (choose.js), as sailing's ocean shape (convert.js for the world's
//     open water, bounded.js for a body of this doc), or null.
//   - Open water may carry a clip (WATER.md, "Clipped open water"): where the
//     world offers no open water (`ambient("water")` is null) and this stage
//     has flushed once (the first-flush guard: alone, its own offer is the
//     world's from then on), the doc's open body with a valid clip, level in
//     its doc, is the bounded body { id: its own id, size: clip } of its doc.
//     From there it is any bounded body: one path, not a copy.
//   - It draws the open surface where its doc is the world (around the
//     camera, lit by the world's atmosphere and roughened by the world's
//     wind), and a block over each bounded body (its top, skirt and floor)
//     in every stage that draws its doc (acting, pin), and sets the
//     stage's extent to the union of what it draws, floors included.
//   - While a Water object of its doc is selected, it draws a dashed outline
//     of that object's box (its size, or its clip whether or not it is live
//     here), so an author sees how much sea comes with her.
//
// Waves are a function of time, so it registers a process with no state (a
// reason for time to pass) where its doc is the world and its open water has
// waves, or where any of its own bounded bodies has waves; the stage holds
// it only where the stage acts for the doc (never in a pin).

import { createOceanSurface } from "./material.js";
import { createTiming, latch, levelOf, readerFor, VERSION } from "./convert.js";
import { amplitudeBound, applyDir, applyPoint, bodiesOf, boxOf, clipBody, clipToSpan, colourOf, currentOf, CURRENT, isLevel, rigidVelocity, scaleOf, shapeOf, shiftByCurrent, TRAIT } from "./bodies.js";
import { boundedReader } from "./bounded.js";
import { choose } from "./choose.js";

/** The sky a surface reflects, from the world's atmosphere: its sky's colours and its cloud deck (scene CONVENTIONS.md, "Atmosphere"), or undefined (keep what was set). */
const skyOf = (atm) => (atm?.sky ? { ...atm.sky, clouds: atm.clouds ?? null } : undefined);

export { TRAIT, CURRENT };
/** The convention a wave maker contributes in the water's stage: { bodies: { [objectId]: { components, look? } } }. */
export const WAVES = "water.waves";
/**
 * The convention a part contributes for the shore's shape round an eye, as
 * the water mirrors it (WATER.md, "The shore in the water"): { v, azimuths,
 * bins, near, reach, profile(eye) → { key, eye, data } | null, and
 * optionally exposure(from) → { key, n, data, origin, u, v, size } | null:
 * how open the water is to a wind from `from` degrees, for shelter }.
 * Terrain gives it for its places.
 */
export const SHORE = "water.shore";
/** The world's wind, an ambient whoever makes the weather offers (the weather package's, weather/WEATHER.md): { speed (m/s), from (degrees), seed, gustiness }; the water reads speed and from. */
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

/** A body's heading in the stage's frame: its +Z column's yaw. */
const yawOf = (M) => Math.atan2(M[8], M[10]);

/**
 * How a bounded body's block is drawn (material.js patchGrid): its
 * footprint w × l (scaled), turned by its heading, level at its origin, and
 * its floor plane relative to the level, [f0, fx, fz] (the floor's height at
 * offset (dx, dz) from the origin is f0 + fx·dx + fz·dz): the body's
 * y = -depth, wherever it is turned. Pure.
 */
export function patchGeometry(box) {
  const M = box.M;
  const s = scaleOf(M);
  const o = applyPoint(M, [0, -box.size[1], 0]);
  const n = applyDir(M, [0, 1, 0]);
  const ny = n[1];
  const f0 = o[1] - M[13] - (Math.abs(ny) < 1e-12 ? 0 : (n[0] * (M[12] - o[0]) + n[2] * (M[14] - o[2])) / ny);
  const floor = Math.abs(ny) < 1e-12 ? [o[1] - M[13], 0, 0] : [f0 + 0, -n[0] / ny + 0, -n[2] / ny + 0];
  return { w: box.size[0] * s, l: box.size[2] * s, yaw: yawOf(M), floor };
}

/**
 * A bounded body's slab: its drawn footprint's corners in the stage's frame,
 * widened by the band A (a crest's sideways throw is within it), from the
 * band above its level down to its floor (or A below the level, whichever is
 * lower), so a camera inside a block isn't cut by the near plane. Pure.
 */
export function patchExtent(box, A) {
  const { w, l, yaw, floor } = patchGeometry(box);
  const M = box.M;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const min = [Infinity, box.level - A, Infinity];
  const max = [-Infinity, box.level + A, -Infinity];
  for (const u of [-w / 2, w / 2])
    for (const v of [-l / 2, l / 2]) {
      const dx = u * c + v * sn, dz = -u * sn + v * c;
      min[0] = Math.min(min[0], M[12] + dx - A);
      max[0] = Math.max(max[0], M[12] + dx + A);
      min[2] = Math.min(min[2], M[14] + dz - A);
      max[2] = Math.max(max[2], M[14] + dz + A);
      min[1] = Math.min(min[1], box.level + floor[0] + floor[1] * dx + floor[2] * dz);
    }
  return { min, max };
}

/** The twelve edges of a box `size` hanging from the origin of M (column-major, the stage's frame), as 24 points flattened: the selection outline. Pure. */
export function outlineSegments(size, M) {
  const [w, d, l] = size;
  const P = (x, y, z) => applyPoint(M, [x, y, z]);
  const c = [];
  for (const y of [0, -d]) for (const [x, z] of [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]]) c.push(P(x, y, z));
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return edges.flatMap(([a, b]) => [...c[a], ...c[b]]);
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
/** The world's time as an ambient's `use` gives it (its outermost's "clock"), as latch() reads it. */
const worldTime = (a, c = a.use("clock")) => ({ t: c.t(), running: c.running() });

export default {
  create(api) {
    const clock = api.use("clock");
    // ─── the world's open water, as this stage reads it ───
    const timing = createTiming(false);
    let world = null; // the reader (convert.js), or null
    let worldFrom = null; // { value, key, mine } it was made for
    let worldHere = null; // { level, A } in this stage's frame, for the choice
    let refused = false; // said once: no water here (tilted frame, another version)

    /** The reader for the world's open water as it is now (made again only when the value, the frame or `mine` changed). */
    function refreshWorld(a) {
      if (!a) {
        world = null;
        worldFrom = null;
        worldHere = null;
        return null;
      }
      const key = frameKey(a.frame);
      if (!worldFrom || worldFrom.value !== a.value || worldFrom.key !== key || worldFrom.mine !== a.mine) {
        timing.mine = a.mine;
        if (!a.mine && !timing.latched) latch(timing, worldTime(a), clock.t());
        world = readerFor(a.value, a.frame, timing);
        worldFrom = { value: a.value, key, mine: a.mine };
        const f = world ? levelOf(a.frame) : null;
        worldHere = f ? { level: ((Number(a.value.level) || 0) - f.ty) / f.s, A: amplitudeBound(a.value.components) / f.s } : null;
        if (!world && !refused) {
          refused = true;
          api.use("notices")?.notify(a.value?.v !== VERSION ? "This world's water is from another version of the water package: nothing floats here" : "Tilted: no water here", "info");
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
      api.use("notices")?.notify(text, "info");
    };

    // the first-flush guard (WATER Decision 107): a clip is never live before this
    // stage has been asked for its ambients once, so alone its own offer is the world's
    let flushed = false;
    let clipLive = null; // the open body whose clip is a bounded body here now, or null

    /**
     * Each bounded body's box (its drawn pose), its rigid velocity since the
     * last frame, and its reader (made again only when its waves change); with
     * the open body's clip among them where the world offers no open water
     * (`dry`) and this stage has flushed.
     */
    function refreshBodies(dry) {
      const sc = api.scene?.() ?? null;
      const found = bodiesOf(sc?.objects);
      const name = (id) => sc.objects[id]?.name ?? id;
      for (const id of found.extra) sayOnce(`extra:${id}`, `Only one open water counts in a scene: “${name(id)}” is left out`);
      for (const id of found.invalid) sayOnce(`invalid:${id}`, `Water's size is three positive numbers (width, depth, length): “${name(id)}” holds none`);
      for (const id of found.badClip) sayOnce(`clip:${id}`, `Water's clip is three positive numbers (width, depth, length): “${name(id)}” keeps no box, and stays open water`);
      for (const id of found.clipIgnored) sayOnce(`clipped:${id}`, `“${name(id)}” has a size, so its clip does nothing: a box of water is always its doc's`);
      const list = [...found.bounded];
      clipLive = null;
      if (dry && flushed && found.open && found.openClip) {
        const M = sc.world?.(found.open) ?? null;
        if (!M || isLevel(M)) {
          list.push(clipBody(found.open, found.openClip));
          list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          clipLive = found.open;
        }
      }
      const waves = list.length ? wavesByBody(api.collect(WAVES)) : {};
      const t = clock.t();
      const seen = new Set();
      order = [];
      for (const { id, size } of list) {
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
    let freshFor = undefined; // and the world's water value it ran for
    let freshFlushed = false; // and whether this stage had flushed
    let scene = null;
    /**
     * Once a frame, and again whenever the world's water value changes or this
     * stage first flushes: so no step reads a clip after the outermost's
     * offer arrives, even before this stage's next loop (W31).
     */
    function refresh() {
      const a = api.ambient(TRAIT);
      const value = a?.value ?? null;
      if (freshAt === frame && freshFor === value && freshFlushed === flushed) return;
      freshAt = frame;
      freshFor = value;
      freshFlushed = flushed;
      refreshWorld(a);
      scene = refreshBodies(a === null);
    }

    /** Which water p (this stage's frame; p[1] null: from above) is in, leaving out what `not` carries (an object id, or a list of them): a reader, or null. */
    function at(p, { not = null } = {}) {
      refresh();
      const roots = Array.isArray(not) ? not : [not];
      const list = order.map((id) => {
        const b = bodies.get(id);
        return { id, box: b.cell.box, A: b.A, carried: roots.some((r) => isUnder(scene, id, r)) };
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
      if (want && !process) process = clock.process({ step() {} }) ?? (() => {});
      else if (!want && process) {
        process();
        process = null;
      }
    }

    // ─── drawing ───
    const group = api.world();
    let surface = null; // the open surface: the outermost's only
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

    /**
     * The shore in the water for a camera at `cam` and a body's colour: where
     * the body has a shore tint and this stage's parts give the shore's shape
     * (the contribution `water.shore`, the last one's: its profile(eye)), that
     * profile and the tint; else nothing. [profile, tint] for setShore.
     */
    function shoreFor(cam, colour) {
      if (!cam || !colour?.shore) return [null, null];
      const eye = Array.isArray(cam) ? cam : [cam.x, cam.y, cam.z];
      const s = api.collect?.(SHORE)?.at(-1)?.value;
      const profile = typeof s?.profile === "function" ? s.profile(eye) : null;
      return profile ? [{ ...profile, azimuths: s.azimuths, bins: s.bins, near: s.near, reach: s.reach }, colour.shore] : [null, null];
    }

    /**
     * Shelter for the world's wind: where this stage's parts give the
     * water's exposure (the contribution `water.shore`'s exposure(from), the
     * last one's), its grid for a wind from `wind.from`; else null.
     */
    function exposureFor(wind) {
      const s = api.collect?.(SHORE)?.at(-1)?.value;
      if (typeof s?.exposure !== "function") return null;
      return s.exposure(Number(wind?.from) || 0) ?? null;
    }

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
      // the doc's open body's own colour, if it has one (its trait's `colour`)
      const open = bodiesOf(scene?.objects).open;
      const colour = colourOf(open ? scene.objects[open]?.traits?.[TRAIT] : null);
      surface.setColour(colour);
      const cam = api.camera.get()?.position;
      if (cam) surface.update(worldTime(a).t, cam, atm ? (atm.sun ?? null) : undefined, skyOf(atm));
      surface.setShore(...shoreFor(cam, colour));
      surface.setExposure(exposureFor(wind));
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
      const t = clock.t();
      const out = [];
      for (const id of order) {
        const b = bodies.get(id);
        const box = b.cell.box;
        const { w, l, yaw, floor } = patchGeometry(box);
        let p = patches.get(id);
        if (!p) {
          p = { surface: createOceanSurface(api.THREE, lookOf(b.components, b.look, wind), { patch: { w, l, yaw, floor } }), key: b.key, wind };
          group.add(p.surface.object);
          patches.set(id, p);
          api.invalidate();
        } else if (p.key !== b.key || p.wind !== wind) {
          p.surface.setSea(lookOf(b.components, b.look, wind));
          p.key = b.key;
          p.wind = wind;
          api.invalidate();
        }
        p.surface.setPatch(w, l, yaw, floor);
        const colour = colourOf(scene?.objects?.[id]?.traits?.[TRAIT]);
        p.surface.setColour(colour);
        p.surface.update(t, [box.M[12], box.M[13], box.M[14]], atm ? (atm.sun ?? null) : undefined, skyOf(atm));
        p.surface.setShore(...shoreFor(api.camera.get()?.position, colour));
        p.surface.setExposure(exposureFor(wind));
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

    // ─── the selection outline: a selected Water object's box (size, or clip) ───
    let outline = null;
    let outlineKey = null;
    function drawOutline() {
      const sel = api.view?.get?.()?.selected ?? null;
      const o = typeof sel === "string" ? scene?.objects?.[sel] : null;
      const sh = o?.traits?.[TRAIT] !== undefined ? shapeOf(o.traits[TRAIT]) : null;
      const size = sh?.kind === "bounded" ? sh.size : sh?.kind === "open" ? sh.clip : null;
      const M = size ? api.worldOf(sel) : null;
      if (!M) return undrawOutline();
      const key = JSON.stringify([sel, size, Array.from(M)]);
      if (key === outlineKey) return;
      outlineKey = key;
      const T = api.THREE;
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(new Float32Array(outlineSegments(size, Array.from(M))), 3));
      const dash = Math.max(0.05, (Math.min(size[0], size[2]) * scaleOf(M)) / 24);
      if (outline) {
        outline.geometry.dispose();
        outline.geometry = g;
        outline.material.dashSize = dash;
        outline.material.gapSize = dash * 0.6;
      } else {
        outline = new T.LineSegments(g, new T.LineDashedMaterial({ color: 0xffffff, dashSize: dash, gapSize: dash * 0.6, transparent: true, opacity: 0.85 }));
        outline.name = "water-outline";
        outline.frustumCulled = false;
        outline.userData.noPick = true;
        outline.raycast = () => {};
        group.add(outline);
      }
      outline.computeLineDistances?.();
      api.invalidate();
    }
    function undrawOutline() {
      if (!outline) return;
      outline.geometry.dispose();
      outline.material.dispose();
      outline.removeFromParent?.();
      outline = null;
      outlineKey = null;
      api.invalidate();
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
      if (a && !a.mine) latch(timing, worldTime(a), clock.t());
      needTime(a);
      const wind = api.ambient(WIND)?.value ?? null;
      const atm = api.ambient("atmosphere")?.value ?? null;
      const open = drawOpen(a, wind, atm);
      const own = drawPatches(wind, atm);
      drawOutline();
      setExtent(unionOf([open, ...own]));
    });
    refresh();
    needTime(api.ambient(TRAIT));

    return {
      /** which water a point is in, as a reader in this stage's frame and on its clock: { at(p, { not }) } */
      water: contribution,
      ambient() {
        // the stage is asking for its ambients: it has flushed (the first-flush guard)
        flushed = true;
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
        undrawOutline();
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
        /** the open body whose clip is a bounded body here now, or null */
        clip: () => clipLive,
        get outline() {
          return outline;
        },
        timing,
      },
    };
  },
};
