// The "terrain.sky" scene extension: a place's own sky. An object with the
// `terrain.sky` trait (a place puts it on its terrain) offers the world's
// `atmosphere` ambient (scene STAGE.md, "Ambients"): its sky, fog, sun and
// exposure, plain data in the trait, so the inspector shows and edits them.
//
// Why it wins over the weather's bright day (sailing.weather also offers an
// atmosphere): ambients stack in running order, a later offer winning
// whole, and activation runs a doc's scene-trait extensions first and its
// object-trait extensions after them (scene activation.js activeSet). The
// weather is a scene trait, this is an object trait: so where both are,
// the place's sky is the world's. A hidden object offers nothing; of
// several, the lowest id's. No scene change: one more provider of an
// ambient the stage already merges.
//
// It also gives its stage's parts the contribution `water.shore` (water's
// convention: WATER.md, "The shore in the water"): the shore's shape round
// an eye, as the water mirrors it (horizon.js), read from the place's own
// GLB (api.content(id).extras.terrain: its heights and its canopy), made
// again only when the eye has moved 25 m or its height by a fifth. With it,
// the water's shelter (WATER.md, "Shelter"): how open each spot of the
// place's water is to the wind's fetch (exposure.js), made again only when
// the wind turns a degree or the GLB or its place changes.
//
// And it dresses the place's ground (STAGE.md: dressing, for an object that
// carries its trait): the grain at the eye (grain.js), on the materials of
// the meshes whose GLB gives them the grain, put back when it stops.

import { decodeTerrain } from "./terrain-sample.js";
import { horizonProfile, stillServes, azimuthDir, SHORE } from "./horizon.js";
import { dressGrain } from "./grain.js";
import { exposureFor } from "./exposure.js";

/** The atmosphere a trait's data makes (only its sky, fog, sun, exposure and clouds), or null. Pure. */
export function skyOffer(trait) {
  if (!trait || typeof trait !== "object") return null;
  const out = {};
  for (const k of ["sky", "fog", "sun", "exposure", "clouds"]) if (trait[k] != null) out[k] = JSON.parse(JSON.stringify(trait[k]));
  return Object.keys(out).length ? out : null;
}

/** The object the scene's sky comes from: the lowest id among shown objects that have the trait, or null. Pure. */
export function skyObject(doc) {
  const ids = Object.keys(doc?.objects ?? {}).sort();
  for (const id of ids) {
    const o = doc.objects[id];
    if (o?.traits?.["terrain.sky"] && o.visible !== false) return id;
  }
  return null;
}

/** The trait the scene's sky comes from: the lowest id's among shown objects that have one. Pure. */
export function skyTrait(doc) {
  const id = skyObject(doc);
  return id == null ? null : doc.objects[id].traits["terrain.sky"];
}

/**
 * The shore's profile round `eye` (the stage's frame) for a terrain decoded
 * from its extras (`t`) whose world matrix is `M` (column-major; level: its
 * turn about the vertical and its shift are undone, any tilt ignored).
 * Pure.
 */
export function shoreProfile(t, M, eye) {
  const m = M ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // the land's x and z axes in the stage, unit length
  const lx = Math.hypot(m[0], m[2]) || 1, lz = Math.hypot(m[8], m[10]) || 1;
  const xa = [m[0] / lx, m[2] / lx], za = [m[8] / lz, m[10] / lz];
  const toLand = (x, z) => [(x - m[12]) * xa[0] + (z - m[14]) * xa[1], (x - m[12]) * za[0] + (z - m[14]) * za[1]];
  const dirOf = (a) => {
    const [dx, dz] = azimuthDir(a);
    return [dx * xa[0] + dz * xa[1], dx * za[0] + dz * za[1]];
  };
  return horizonProfile((x, z) => t.surfaceAt(x, z), [eye[0], eye[1] - m[13], eye[2]], { level: t.seaLevel ?? 0, toLand, dirOf });
}

export default {
  create(api) {
    let key;
    let offer = null;
    // the shore for the water's mirror: the terrain decoded once per GLB, the profile once per eye that serves
    let decoded = null; // { extras, t }
    let made = null; // { eye, key, data }
    let count = 0;
    const shore = {
      v: 1,
      ...SHORE,
      /** The profile round `eye` ([x, y, z] in this stage), { key, eye, data } (horizon.js), or null where the place's GLB isn't here. */
      profile(eye) {
        // (the water asks every frame: the place's GLB may have arrived since the last flush)
        dress();
        const id = skyObject(api.doc());
        const ex = id == null ? null : api.content?.(id)?.extras?.terrain;
        if (!ex) return null;
        if (decoded?.extras !== ex) {
          try {
            decoded = { extras: ex, t: decodeTerrain(ex) };
          } catch {
            decoded = null;
            return null;
          }
          made = null;
        }
        const e = [eye[0], eye[1], eye[2]];
        if (made && stillServes(made.eye, e)) return made;
        made = { eye: e, key: ++count, data: shoreProfile(decoded.t, api.worldOf?.(id) ?? null, e) };
        return made;
      },
      /** The water's exposure to a wind from `from` degrees (exposure.js exposureFor, with a key), or null where the place's GLB isn't here. */
      exposure(from) {
        const id = skyObject(api.doc());
        const ex = id == null ? null : api.content?.(id)?.extras?.terrain;
        if (!ex) return null;
        if (decoded?.extras !== ex) {
          try {
            decoded = { extras: ex, t: decodeTerrain(ex) };
          } catch {
            decoded = null;
            return null;
          }
          made = null;
        }
        const M = api.worldOf?.(id) ?? null;
        const k = `${Math.round(Number(from) || 0)}|${M ? Array.from(M, (v) => v.toFixed(3)).join(",") : "-"}`;
        if (sheltered?.decoded === decoded && sheltered.k === k) return sheltered.grid;
        sheltered = { decoded, k, grid: { key: ++count, ...exposureFor(decoded.t, M, Math.round(Number(from) || 0)) } };
        return sheltered.grid;
      },
    };
    let sheltered = null; // { decoded, k, grid }
    // the ground's grain: dressed once the place's GLB is here (a new GLB, a new root: dressed again), looked for at every update, flush and frame the water asks for the shore
    let dressed = null; // { root, undo }
    function dress() {
      const id = skyObject(api.doc());
      const c = id == null ? null : api.content?.(id);
      const root = c?.loaded ? c.root : null;
      if (dressed?.root === root) return;
      dressed?.undo();
      dressed = null;
      if (!root) return;
      const d = dressGrain(root);
      dressed = { root, undo: d.undo };
      if (d.count) api.invalidate?.();
    }
    return {
      get "water.shore"() {
        return shore;
      },
      update() {
        dress();
      },
      dispose() {
        dressed?.undo();
        dressed = null;
      },
      ambient() {
        dress();
        const t = skyTrait(api.doc());
        const k = t ? JSON.stringify(t) : null;
        if (k !== key) {
          key = k;
          const a = skyOffer(t);
          offer = a ? { atmosphere: a } : null;
        }
        return offer;
      },
    };
  },
};
